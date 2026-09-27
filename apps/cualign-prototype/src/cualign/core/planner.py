"""Planning tools: target arch, staging, validation, export. Pure functions over a Case.

propose_target     -> where every crown should end up (per-tooth displacement) for a strategy
plan_stages        -> split current -> target into aligners within the per-aligner limit
validate           -> collisions / move limit / stage cap violations
compare_strategies -> run the loop for several strategies at once (for side-by-side review)
"""
from __future__ import annotations

import math
import os
import zipfile

import numpy as np
import trimesh

from .arch import Arch, symmetric_arch
from .case import MD_WINDOW_DEG, Case
from .constraints import Constraints
from .fdi import label, to_fdi
from .ipr_cut import cut_ipr, surfaces_from_info
from .limits import (ANTERIOR, IPR_PER_SURFACE, MAX_EXPANSION_PER_SIDE, MAX_LINEAR_PER_ALIGNER, MAX_ROTATION_PER_ALIGNER,
                     PREMOLARS, SPACE_DEFICIT_TOLERANCE_MM, STRATEGIES, months_from_stages)

CLEARANCE = 0.05            # mm left between neighbouring crowns in the target
# A pair collides when its hull overlap grows by more than this over where it started. Assumed tolerance: hulls of real
# (concave) crowns already overlap by several mm3 in a well-aligned arch, so an absolute or relative threshold on the
# raw overlap either flags every stage or misses a push into a pair that started overlapped.
NEW_OVERLAP_MM3 = 1.0
# Rotation and vertical corrections (assumed thresholds). A crown is turned when its total yaw — the measured rotation
# of its mesiodistal axis off the arch tangent (incisors only, see case.YAW_MEASURABLE) plus the turn of the tangent
# between where it stands and where it lands on the target arch (every moved crown) — is at least ROTATION_MIN_DEG;
# below that the fit error of the tangent is as large as the correction. A crown is levelled when its top is more than
# VERTICAL_MIN_MM above or below its two neighbours' mean (not a flat plane: canine tips and lateral incisors differ
# by nature; the end molars are left alone).
ROTATION_MIN_DEG = 3.0
VERTICAL_MIN_MM = 1.0
MD_SEARCH_LIMIT_DEG = MD_WINDOW_DEG - 1.0   # a yaw this large hit the edge of the width-axis search


class Moves(dict):
    """{tooth: translation (3,) | None (extracted)} plus .yaw = {tooth: degrees about the crown's vertical axis through
    its centroid}. A plain dict still works everywhere (no rotation)."""

    def __init__(self, *a, yaw: dict | None = None, **k):
        super().__init__(*a, **k)
        self.yaw: dict[int, float] = dict(yaw or {})


def yaw_of(moves: dict, i: int) -> float:
    return float(getattr(moves, "yaw", {}).get(i, 0.0))


SPAN = range(4, 14)         # Universal 4..13: second premolar to second premolar (mesial of the first molars)


DISPLACED_MM = 3.0   # a crown centre this far from the arch the other crowns make: the tooth stands out of the arch
                     # (at 2 mm three teeth of Poseidon 000001, an ordinary irregular arch, were cut out of it)


def _displaced(case: Case, span: list[int]) -> set[int]:
    """Span teeth standing out of the arch (e.g. a blocked-out canine). The crown furthest from the centre arch fitted
    through the others is flagged first, then the arch is refitted without it: judged in one pass, the neighbours of a
    far-out canine look displaced too, because every fit that still holds the canine bends toward it."""
    order = case.arch_order
    ends = {order[0], order[-1]}
    out: set[int] = set()
    while True:
        worst, worst_d = None, DISPLACED_MM
        for i in span:
            if i in out or i in ends:   # nothing beyond an end tooth: the fit without it is extrapolated there
                continue
            others = np.array([case.anchor[j] for j in order if j != i and j not in out])
            if len(others) < 6:
                continue
            curve, _ = Arch(others).samples(0.0)
            d = float(np.min(np.linalg.norm(curve - case.anchor[i][:2], axis=1)))
            if d > worst_d:
                worst, worst_d = i, d
        if worst is None:
            return out
        out.add(worst)


class _SpanModel:
    """The clinical span of a case, measured once and shared by the crowding and the layout (they must see the same
    arch): span teeth, teeth standing out of line, the arch of the teeth in line (`base`), the contact line's offset
    from it (`e`), contact widths read on it, and where the span ends on any offset of it.

    The line of contacts is taken as the arch of the crowns that stand in line (teeth standing out of it left out,
    see _displaced), moved out to where the contacts are: by the median distance of the in-line contacts from it.
    A fit through the contacts themselves would need them all; leaving out a displaced tooth leaves gaps a flexible
    curve overshoots, while the crown-centre arch keeps a dozen points and its shape. The widths are read on the
    same in-line arch: a far-out crown bends the case's arch and tilts its neighbours' axes (+0.9 mm over the span)."""

    def __init__(self, case: Case):
        order = case.arch_order
        span = [i for i in order if i in SPAN]
        if len(span) < 3:
            span = order
        self.case, self.order, self.span = case, order, span
        self.first, self.last = order.index(span[0]), order.index(span[-1])
        self.out = _displaced(case, span)
        self.base = base = Arch(np.array([case.anchor[j] for j in order if j not in self.out]))
        pairs = [(a, b) for a, b in zip(order, order[1:])
                 if self.first - 1 <= order.index(a) and order.index(b) <= self.last + 1
                 and a not in self.out and b not in self.out]
        offs = []
        for a, b in pairs:
            p = case.contact_point(a, b)
            s0 = base.s_of(p)
            offs.append(float((p[:2] - base.point(s0)) @ base.normal(s0)))
        self.e = round(float(np.median(offs)), 3) if offs else 0.0
        self.widths = {i: case.contact_width(i, base) for i in span}
        sa, sb = self.ends(self.e)
        self.available = abs(sb - sa)
        # no molar beyond an end of the span: that end tooth's own half width is measured from its centre
        self.extra = (self.widths[span[0]] / 2 if self.first == 0 else 0.0) + \
            (self.widths[span[-1]] / 2 if self.last == len(order) - 1 else 0.0)
        # The target arch form: the in-line arch made left-right symmetric and smoothed (x fifth, y fourth degree),
        # passing through the first molars. The midline is the first molars' perpendicular bisector (they are the
        # anchors and stay: the finished arch is symmetric about them), through the point of the in-line arch
        # halfway between their mesial contacts; the extraction chain is centred on it too (_anchored_layout), so the
        # central incisors' contact lands on the midline and the molars close symmetric amounts. (The current
        # incisors' contact was the midline before: on 000097 it stands 1.35 mm off the arc midpoint, so the target
        # was skewed with the crowding.) The crowding is measured on `base`; the crowns are placed on `target`.
        in_line = [j for j in order if j not in self.out]
        self.target = base
        self.mid: np.ndarray | None = None
        self._target_ends: dict[float, tuple[float, float]] = {}
        if {3, 8, 9, 14} <= set(in_line):
            a3, a14 = case.anchor[3][:2], case.anchor[14][:2]
            across = (a14 - a3) / np.linalg.norm(a14 - a3)
            axis = np.array([-across[1], across[0]])
            if axis @ (case.contact_point(8, 9)[:2] - (a3 + a14) / 2) < 0:
                axis = -axis
            apex = base.point((sa + sb) / 2, self.e)
            centre = (a3 + a14) / 2
            self.mid = centre + axis * float((apex - centre) @ axis)     # the arc midpoint, on the bisector
            self.target = symmetric_arch(base, np.array([case.anchor[j] for j in in_line]), self.mid, axis,
                                         np.array([j in (3, 14) for j in in_line]))

    def midline_s(self, offset: float) -> float | None:
        """Arc position of the midline on the in-line arch (offset by `offset`); None without one."""
        return None if self.mid is None else float(self.base.s_of(self.mid, offset))

    def target_s(self, s: float, offset: float) -> float:
        """Arc position on the target arch (offset by `offset`) of arc position s on the in-line arch: the span's ends
        (the first molars' mesial contacts) map onto their nearest points on the target, linearly in between."""
        if offset not in self._target_ends:
            sa, sb = self.ends(offset)
            self._target_ends[offset] = (sa, sb, self.target.s_of(self.base.point(sa, offset), offset),
                                         self.target.s_of(self.base.point(sb, offset), offset))
        sa, sb, ta, tb = self._target_ends[offset]
        return ta + (s - sa) * (tb - ta) / (sb - sa) if sb != sa else ta

    def ends(self, offset: float) -> tuple[float, float]:
        """Arc positions on the in-line arch offset by `offset` where the span starts and ends: the first molars'
        mesial contacts (their mesial surfaces when the neighbouring tooth stands out of line), else the end teeth's
        centres."""
        case, base, order, span = self.case, self.base, self.order, self.span

        def end(k_molar: int, tooth: int, side: int) -> float:
            if not 0 <= k_molar < len(order):
                return base.s_of(case.anchor[tooth], offset)
            m = order[k_molar]
            if tooth in self.out:
                return base.s_of(case.anchor[m], offset) + side * case.contact_width(m, base) / 2
            return base.s_of(case.contact_point(*((m, tooth) if side > 0 else (tooth, m))), offset)

        return end(self.first - 1, span[0], 1), end(self.last + 1, span[-1], -1)


def _span_model(case: Case) -> _SpanModel:
    """Cached on the case for its current arch."""
    cached = getattr(case, "_span_cache", None)
    if cached is None or cached[0] is not case.arch:
        cached = (case.arch, _SpanModel(case))
        case._span_cache = cached
    return cached[1]


def _span_available(case: Case) -> tuple[list[int], float, float, dict[int, float]]:
    """(span teeth in arch order, arch length available to them along the contacts, width added for missing end
    molars, contact widths of the span teeth) — see crowding_mm and _SpanModel."""
    m = _span_model(case)
    return m.span, m.available, m.extra, m.widths


def crowding_mm(case: Case) -> float:
    """Space deficit the clinical way (arch length discrepancy, #59): widths of the teeth in front of the first molars
    minus the arch length available to them, measured along the contact points from the mesial contact of one first
    molar to the other.

    - span: Universal 4..13 — the first molars are the anchors the space is measured between, not part of it;
    - available: a smooth arch through the interproximal contacts (not through the crown centres, which run inside
      the contacts and shorten the arch by ~2.5–3 mm on real scans);
    - required: Case.contact_width (width at the contacts, not the full outline).
    Poseidon3D with dentist labels (evals/real_scans/dentist_labels.yaml): 000001 needs ~4.0 mm (dentist) → 4.2 mm,
    000131 IPR 1.2 mm → 1.6 mm, the three "no treatment" arches 1.8–4.5 mm, the arches with space left over ≤ 0 (the
    old measure gave 6.5–12.5 mm on the "no treatment" ones). Arches without that span fall back to all teeth.
    """
    span, avail, extra, widths = _span_available(case)
    return round(sum(widths.values()) - avail - extra, 1)


def _expansion_for(arch, need_mm: float) -> tuple[float, float]:
    """Smallest per-side offset (0.5..2.0 mm) whose arch-length gain covers `need_mm`; else the 2 mm limit.
    No space needed → no expansion (it used to widen by 0.5 mm regardless, #59)."""
    if need_mm <= 0:
        return 0.0, 0.0
    best = (MAX_EXPANSION_PER_SIDE, None)
    for offset in np.arange(0.5, MAX_EXPANSION_PER_SIDE + 1e-9, 0.1):
        offset = round(float(offset), 1)
        # gain over the span the crowns occupy (distal contact to distal contact), not over the extrapolated ends
        g = arch.expansion_gain(offset) * 0.8
        best = (offset, g)
        if g >= need_mm:
            break
    return best


def _ipr_reductions(ids, ipr_exclude, ipr_limit_mm) -> dict[int, float]:
    """Width taken off each tooth by IPR on all its contacts (half the per-surface amount per shared contact)."""
    return {i: ipr_limit_mm * (2 if 0 < k < len(ids) - 1 else 1) * 0.5 for k, i in enumerate(ids) if i not in ipr_exclude}


def _span_contacts(case: Case, offset: float) -> tuple[float, float]:
    """Arc positions (on the in-line arch offset by `offset`) of the span's ends, the first molars' mesial contacts."""
    return _span_model(case).ends(offset)


def _span_expansion_for(case: Case, need_mm: float) -> tuple[float, float]:
    """Like _expansion_for, but the gain is the arch length won between the first molars' mesial contacts."""
    if need_mm <= 0:
        return 0.0, 0.0
    sa0, sb0 = _span_contacts(case, 0.0)
    best = (MAX_EXPANSION_PER_SIDE, 0.0)
    for offset in np.arange(0.5, MAX_EXPANSION_PER_SIDE + 1e-9, 0.1):
        offset = round(float(offset), 1)
        sa, sb = _span_contacts(case, offset)
        g = max((sb - sa) - (sb0 - sa0), 0.0) * 0.8
        best = (offset, g)
        if g >= need_mm:
            break
    return best


SHAPE_STEP_MM = 0.2      # more room per round for a pair of neighbours whose crowns still meet in the target
SHAPE_ROUNDS = 12        # at most this many rounds (2.2 mm for one pair)
TARGET_OVERLAP_MM3 = 0.5  # a pair may gain this much overlap in the target (half the validator's NEW_OVERLAP_MM3)
GAP_TOL_MM = 0.1          # a pair whose crowns stand further than CLEARANCE + this apart in the target is pulled together
PATH_ROOM_MAX = 2         # rounds of SHAPE_STEP_MM a pair may get so its crowns clear each other on the way (not only in the target)


def _isotonic(y: list[float]) -> list[float]:
    """Least-squares non-decreasing fit (pool adjacent violators)."""
    blocks = []                                   # [mean, weight]
    for v in y:
        blocks.append([v, 1])
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            v2, w2 = blocks.pop()
            v1, w1 = blocks.pop()
            blocks.append([(v1 * w1 + v2 * w2) / (w1 + w2), w1 + w2])
    out = []
    for v, w in blocks:
        out += [v] * w
    return out


def _anchored_layout(case: Case, active: list[int], width: dict, s_cur: dict, offset: float, extra: dict,
                     lock=frozenset(), close: bool = False,
                     close_sides: tuple[bool, bool] = (True, True),
                     removed=(), closable: tuple[bool, bool] = (True, True), centre: float | None = None
                     ) -> tuple[list, bool, tuple[float, float], float, dict]:
    """Least movement that aligns the span between the anchored first molars, on the in-line arch (_SpanModel.base).

    Returns (arc position per active tooth, None for the anchors; whether the span fit; room left in front of each
    first molar; extraction space left open; slack per neighbour pair: how far beyond its required spacing the pair
    stands - 0 where the crowns are laid contact to contact). Along the arch, each span crown moves only as far as needed so that
    neighbours sit at least contact width apart and the span fits between the first molars' mesial contacts — an
    aligned arch stays put, a crowded one opens where it overlaps (a bounded isotonic fit). Locked span teeth stay: the
    fit runs between them. Across the arch, every crown is brought onto the target arch (the caller places it there).
    Widths are contact widths laid out along the contact line; the crowns are placed on the crown-centre arch, which
    runs inside the contacts and is shorter by the ratio k. When the span does not fit, the missing space is shared out
    as even overlap (the space deficit is reported by the caller). `extra`: more room for a pair of neighbours whose
    crown shapes still meet at contact width (see SHAPE_STEP_MM). `close`: close every space (after an extraction):
    the span becomes one contiguous chain, and the room left is for the molars to close. `centre`: arc position the
    chain's middle (the central incisors' contact) is put on when both molars can close - the midline, so the
    finished arch is symmetric and the two molars close different amounts only as far as the dentition is asymmetric
    now (000097: 16 stands 2.5 mm further back than 26)."""
    model = _span_model(case)
    sa, sb = model.ends(offset)
    sa0, sb0 = model.ends(0.0)
    avail = model.available + (sb - sa) - (sb0 - sa0)   # the expansion lengthens the contact line as much as the centre arc
    k = (sb - sa) / avail if avail > 0 else 1.0
    span = [i for i in active if i in SPAN]
    fixed = [m for m, i in enumerate(span) if i in lock]
    gaps = [k * ((width[a] + width[b]) / 2 + CLEARANCE + extra.get((a, b), 0.0)) for a, b in zip(span, span[1:])]
    lo = sa + k * (width[span[0]] / 2 + CLEARANCE + extra.get((3, span[0]), 0.0))
    hi = sb - k * (width[span[-1]] / 2 + CLEARANCE + extra.get((span[-1], 14), 0.0))
    fits = True
    if not fixed and sum(gaps) > hi - lo and sum(gaps) > 0:   # does not fit: squeeze every gap alike
        gaps = [g * max(hi - lo, 0.0) / sum(gaps) for g in gaps]
        fits = False
    D = np.concatenate([[0.0], np.cumsum(gaps)])
    y = np.array([s_cur[i] - D[m] for m, i in enumerate(span)])
    top = hi - D[-1]
    open_mm = 0.0                    # extraction space left that no molar can close (reported by the validator)
    if close and not fixed:
        # the room left goes to molars that can close it: the extraction side's if they can move, else the other
        # side's; both: centred. The chain closes toward the other side (one-sided extraction moves only one side).
        sides = [i for i in (0, 1) if close_sides[i] and closable[i]] or [i for i in (0, 1) if closable[i]]
        if tuple(sides) == (0,):
            at = top
        elif tuple(sides) == (1,):
            at = lo
        elif centre is not None:
            k8, k9 = (span.index(t) for t in (8, 9)) if {8, 9} <= set(span) else (0, len(span) - 1)
            at = centre - (D[k8] + D[k9]) / 2
        else:
            at = float(np.mean(y))
        t = np.full(len(span), float(np.clip(at, lo, max(lo, top))))
    else:
        t = y.copy()
        cuts = [-1] + fixed + [len(span)]
        for a, b in zip(cuts, cuts[1:]):                      # each free run between locked teeth (or the molars)
            if b - a <= 1:
                continue
            L = t[a] if a >= 0 else lo
            R = t[b] if b < len(span) else top
            fits = fits and L <= R
            at = _closing_position(span, removed, a, b, L, R, y, closable) if close else None
            t[a + 1:b] = np.clip(_isotonic(list(y[a + 1:b])) if at is None else np.full(b - a - 1, at), L, max(L, R))
            if at is not None and not ((a == -1 and at >= R and closable[0]) or (b == len(span) and at <= L and closable[1])):
                open_mm += max(R - L, 0.0)   # the run's slack stays between it and a locked tooth
    pos = {i: float(t[m] + D[m]) for m, i in enumerate(span)}
    room = (float(t[0] - lo), float(top - t[-1]))
    if close and not fixed:
        open_mm += sum(max(r, 0.0) for r, ok in zip(room, closable) if not ok)
    slack = {(a, b): float(pos[b] - pos[a] - g) for (a, b), g in zip(zip(span, span[1:]), gaps)}
    slack[(3, span[0])], slack[(span[-1], 14)] = room
    return [pos.get(i) for i in active], fits, room, open_mm, slack


def _closing_position(span: list, removed, a: int, b: int, L: float, R: float, y,
                      closable: tuple[bool, bool] = (True, True)) -> float | None:
    """Where a free run (span[a+1:b], between locked teeth or the molars) sits as one closed chain after an extraction,
    or None when no extraction space touches it (least movement, as without an extraction). The room left over goes
    where a molar can close it: a run next to a movable molar packs against the locked tooth on its other side (the
    molar closes the rest); next to a locked molar it packs toward that molar. A run between two locked teeth closes
    onto the extraction space (its slack stays open and is reported)."""
    def index(tooth, side):          # index in span of the nearest remaining tooth on that side of an extracted one
        near = [m for m, i in enumerate(span) if (i < tooth if side < 0 else i > tooth)]
        return (max(near) if side < 0 else min(near)) if near else (-1 if side < 0 else len(span))
    inside = left = right = False
    for e in removed:
        ml, mr = index(e, -1), index(e, 1)
        if a < ml and mr < b:
            inside = True
        elif ml == a and a < mr <= b - 1:
            left = True
        elif mr == b and a + 1 <= ml < b:
            right = True
    if not (inside or left or right):
        return None
    if a == -1 and b < len(span):
        return R if closable[0] else L
    if b == len(span) and a >= 0:
        return L if closable[1] else R
    if inside:
        return float(np.mean(y[a + 1:b]))
    return L if left else R


def _ipr_gain(ids, ipr_exclude, ipr_limit_mm=IPR_PER_SURFACE) -> float:
    surf = sum((2 if 0 < k < len(ids) - 1 else 1) for k, i in enumerate(ids) if i not in ipr_exclude)
    return surf * ipr_limit_mm * 0.5


def cut_case(case: Case, info: dict | None) -> Case:
    """The case with a target's IPR cut from its crowns (ipr_cut.py; `info` from propose_target or a plan's info),
    or `case` itself when there is nothing to cut. The target, the stages, the collision check and the exports use
    this dentition (#62); the scan stays as it is. Cached on the case per surface list."""
    if not info or getattr(case, "ipr_cut", None):
        return case
    surfaces, exclude = surfaces_from_info(case, info)
    if not surfaces:
        return case
    key = (tuple(tuple(s) for s in surfaces), tuple(sorted(exclude)))
    cache = case.__dict__.setdefault("_ipr_cut_cache", {})
    if key not in cache:
        cache[key] = cut_ipr(case, surfaces, exclude)
    return cache[key]


def propose_target(case: Case, strategy: str, ipr_exclude: set[int] | frozenset[int] = frozenset(),
                   lock: set[int] | frozenset[int] = frozenset(), constraints: Constraints | None = None,
                   extraction: tuple[int, ...] = ()):
    """Return ({tooth: displacement(3,) | None}, info). None = extracted.

    The extraction strategy removes exactly the prescribed teeth (constraints.extraction, or `extraction` without
    constraints); the app never picks them (#56).

    Crowns are placed in contact along the fitted arch (optionally offset outward for expansion),
    ordered as they are now, centred on their current mean position. Locked teeth anchor the chain.
    """
    if strategy not in STRATEGIES:
        raise ValueError(f"unknown strategy {strategy!r}; use one of {STRATEGIES}")
    if constraints is not None:
        constraints.check_case(case.ids)
        if strategy == "extraction" and not constraints.allow_extraction:
            raise ValueError("extraction is forbidden by confirmed constraints")
        ipr_exclude, lock = set(constraints.ipr_exclude), set(constraints.lock)
        extraction = tuple(constraints.extraction)
    if strategy == "extraction":
        extraction = tuple(sorted(set(extraction)))
        if not extraction:
            raise ValueError("발치 처방(발치할 치아 번호)이 없어 발치안을 만들 수 없습니다.")
        if set(extraction) - set(case.ids):
            raise ValueError(f"처방된 발치 치아가 케이스에 없습니다: {label(sorted(set(extraction) - set(case.ids)))}")
        if set(extraction) - set(PREMOLARS):
            raise ValueError(f"소구치({label(sorted(PREMOLARS))}) 발치만 계획할 수 있습니다: {label(sorted(set(extraction) - set(PREMOLARS)))}")
        if set(extraction) & set(lock):
            raise ValueError("locked teeth cannot be extracted")
    ipr_limit_mm = constraints.ipr_limit_mm if constraints else IPR_PER_SURFACE
    # Contact widths say how much room the teeth need along the arch; the crowns' shapes decide where they actually
    # meet (an incisor is widest labial of its contacts; the contact line runs outside the arch the crowns are placed
    # on, so a spacing that is right on average leaves gaps where the arch bends most and overlap where it is flat).
    # So the layout is repeated with each pair's spacing corrected: a pair whose hulls gain more than
    # TARGET_OVERLAP_MM3 of overlap (measured as the validator measures) gets SHAPE_STEP_MM more room, a pair whose
    # crowns stand more than CLEARANCE + GAP_TOL_MM apart is pulled together by the gap (a finished arch has every
    # contact closed; a pair once pushed apart is not pulled back, so the two do not chase each other). When every
    # contact is settled, the straight-line stages to that target are checked once more: a pair whose crowns clip each
    # other on the way (a blocked-out canine coming into line past its neighbour's corner) gets up to PATH_ROOM_MAX
    # steps of room in the target - a closed contact that cannot be reached is no plan. The expansion is sized for the
    # corrected spacing too; room that cannot be made shows as the collision it leaves.
    extra: dict[tuple[int, int], float] = {}
    pushed: set[tuple[int, int]] = set()
    path_rounds: dict[tuple[int, int], int] = {}
    for _ in range(SHAPE_ROUNDS + PATH_ROOM_MAX):
        target, info, pairs, fits = _place(case, strategy, ipr_exclude, lock, ipr_limit_mm, extra, extraction)
        expandable = strategy in ("expansion", "expansion_ipr") and info["expansion_mm_per_side"] < MAX_EXPANSION_PER_SIDE
        adjust = {}
        cut = cut_case(case, info)        # measured on the crowns with the IPR cut, as the validator measures (#62)
        for (a, b), slack in pairs.items():
            if a in lock and b in lock:
                continue
            ov = cut._overlap(a, b, target[a], target[b], yaw_of(target, a), yaw_of(target, b)) - cut.pair_baseline(a, b)
            if ov > TARGET_OVERLAP_MM3:
                adjust[(a, b)] = SHAPE_STEP_MM
                pushed.add((a, b))
            elif (a, b) not in pushed and slack <= GAP_TOL_MM:    # laid contact to contact, yet the crowns stand apart
                gap = _target_gap(cut, a, b, target)
                if gap > CLEARANCE + GAP_TOL_MM:
                    adjust[(a, b)] = CLEARANCE - gap
        if not fits and not expandable:   # the span is short and cannot be widened: the overlap is what is missing
            adjust = {pr: v for pr, v in adjust.items() if v < 0}      # only gaps are still closed
        if not adjust:
            stages, _ = plan_stages(case, target)
            hit = {tuple(v["teeth"]) for v in validate(cut, stages) if v["type"] == "collision"}
            for pr in pairs:
                if pr in hit and path_rounds.get(pr, 0) < PATH_ROOM_MAX:
                    adjust[pr] = SHAPE_STEP_MM
                    path_rounds[pr] = path_rounds.get(pr, 0) + 1
                    pushed.add(pr)
            if not adjust:
                break
        for pr, v in adjust.items():
            extra[pr] = extra.get(pr, 0.0) + v
    return target, info


def _target_gap(case: Case, a: int, b: int, target: dict) -> float:
    """Closest the crowns of a and b come where the target puts them (mm, vertex to vertex on the scanned meshes;
    0 or a little more when they touch, up to the mesh's vertex spacing over the true surface distance)."""
    from scipy.spatial import cKDTree
    ma = case.placed(a, target[a], yaw_of(target, a))
    mb = case.placed(b, target[b], yaw_of(target, b))
    return float(cKDTree(mb.vertices).query(ma.vertices)[0].min())


def _place(case: Case, strategy: str, ipr_exclude, lock, ipr_limit_mm: float, extra: dict, extraction=()):
    """One layout of propose_target: (target, info, {neighbour pair laid out: slack beyond its spacing}, whether the
    layout fit)."""
    ids = case.ids
    # the same width the space is measured with (at the contacts): the target lays crowns contact to contact, so an
    # arch that is already aligned stays where it is instead of being stretched by the flaring crown corners (#59)
    width = {i: case.contact_width(i) for i in ids}
    width.update(_span_available(case)[3])            # the span teeth exactly as the crowding measured them
    crowd = crowding_mm(case)

    active = list(ids)
    gain = 0.0
    notes: list[str] = []
    offset = 0.0
    # First molars as anchors (the clinical model the crowding is measured in, #59): they stay, the teeth between their
    # mesial contacts are aligned into that space (on the same in-line arch the crowding was measured on), and only
    # space made inside it counts. Arches without both first molars keep the older whole-arch chain.
    anchored = {3, 14} <= set(ids) and sum(1 for i in ids if i in SPAN) >= 3
    arch = _span_model(case).base if anchored else case.arch
    in_scope = (lambda i: i in SPAN) if anchored else (lambda i: True)
    red = {}
    if strategy in ("ipr", "expansion_ipr"):
        # anchored: IPR on the span teeth only, both surfaces of each (the 3|4 and 13|14 contacts included) — stripping
        # a molar does not make room inside the span
        red = {i: ipr_limit_mm for i in ids if i in SPAN and i not in ipr_exclude} if anchored \
            else _ipr_reductions(ids, ipr_exclude, ipr_limit_mm)
    if strategy in ("expansion", "expansion_ipr"):
        # Expand only as much as needed (up to the 2 mm/side limit).
        # room the crowns' shapes need beyond their contact widths; contacts pulled closer than the widths (negative
        # extra) are not credited - the crowding and the expansion stay as the dentist's measure (checked against the
        # labelled scans), the packing only decides where the crowns sit
        shape = sum(max(v, 0.0) for v in extra.values())
        need = max(crowd + shape, 0.0) if strategy == "expansion" else \
            max(crowd + shape - sum(v for i, v in red.items() if in_scope(i)), 0.0)
        offset, exp_gain = _span_expansion_for(case, need) if anchored else _expansion_for(arch, need)
        gain += exp_gain
        notes.append(f"악궁 편측 {offset:.1f}mm 확장" if offset else "공간이 모자라지 않아 확장하지 않음")
    if red:
        for i, r in red.items():
            width[i] -= r
        gain += sum(v for i, v in red.items() if in_scope(i))
        surf = sum(round(r / (ipr_limit_mm * 0.5)) for r in red.values()) if ipr_limit_mm else 0
        notes.append(f"IPR 면당 {ipr_limit_mm}mm x {surf}면" + (f" (제외 {label(sorted(ipr_exclude))})" if ipr_exclude else ""))
    if strategy == "extraction":
        rm = list(extraction)            # as prescribed (checked in propose_target)
        for i in rm:
            gain += width[i]
            active.remove(i)
        notes.append(f"처방대로 {label(rm)} 발치")
    deficit = round(max(crowd - gain, 0.0), 2)       # the clinical deficit; shape room that does not fit shows as collision

    # Order along the arch by current arc-length coordinate (on the offset curve for expansion).
    s_cur = {i: arch.s_of(case.anchor[i], offset) for i in active}
    active.sort(key=lambda i: s_cur[i])
    fits, closing, open_mm = True, (0.0, 0.0), 0.0
    # where the crowns are placed: the symmetric target arch for an anchored case, else the arch itself
    curve, to_curve = (_span_model(case).target, _span_model(case).target_s) if anchored else (arch, lambda s, o: s)
    if anchored:
        sides = (any(i < 9 for i in extraction), any(i >= 9 for i in extraction))
        closable = (not lock & {2, 3}, not lock & {14, 15})
        s_new, fits, room, open_mm, slack = _anchored_layout(
            case, active, width, s_cur, offset, extra, lock, close=strategy == "extraction", close_sides=sides,
            removed=tuple(extraction) if strategy == "extraction" else (), closable=closable,
            centre=_span_model(case).midline_s(offset))
        if strategy == "extraction":     # the molars close what the extraction leaves (unless a tooth of theirs is locked)
            # the molars close whatever room is left on their side (unless one of them is locked): the layout leaves it
            # on the extraction side, or on the other side when a locked tooth keeps the chain from closing there
            closing = tuple(0.0 if lock & blk else max(r, 0.0) for r, blk in zip(room, ({2, 3}, {14, 15})))
            for pr, c in zip(((3, s) for s in [k for k in active if k in SPAN][:1]), closing[:1]):
                slack[pr] = max(slack[pr] - c, 0.0)          # the molar closes the room in front of it
            last = [k for k in active if k in SPAN][-1]
            slack[(last, 14)] = max(slack[(last, 14)] - closing[1], 0.0)
            if any(c > 0.05 for c in closing):
                notes.append(f"남는 발치 공간은 대구치를 앞으로 옮겨 닫음 ({label(3)} 쪽 {closing[0]:.1f}mm, "
                             f"{label(14)} 쪽 {closing[1]:.1f}mm)")
    else:
        gaps = [(width[active[k]] + width[active[k + 1]]) / 2 + CLEARANCE + extra.get((active[k], active[k + 1]), 0.0)
                for k in range(len(active) - 1)]
        chain = np.concatenate([[0.0], np.cumsum(gaps)])          # contact chain, relative
        locked = [i for i in active if i in lock]
        if locked:
            k0 = active.index(locked[0])
            s_new = chain - chain[k0] + s_cur[locked[0]]
            if len(locked) > 1:
                notes.append(f"고정 {label(locked)} 중 {label(locked[0])}을 기준으로 정렬")
        else:
            s_new = chain - chain.mean() + np.mean([s_cur[i] for i in active])

    rot, lift = _corrections(case, active, lock)
    target = Moves()
    for k, i in enumerate(active):
        if i in lock:
            target[i] = np.zeros(3)
            continue
        if s_new[k] is None:    # an anchor: stays, moved outward only by the expansion
            # each side's molars move out as one block (along the first molar's normal), straight outward — not along
            # the longer offset arc, and not each along its own normal, which pushes their corners into each other
            block = 3 if i < 4 else 14
            sm = arch.s_of(case.anchor[block])
            shift = offset * arch.normal(sm) + arch.tangent(sm) * (closing[0] if block == 3 else -closing[1])
            if lock & ({2, 3} if block == 3 else {14, 15}):   # a locked molar holds its side's block
                shift = np.zeros(2)
            target[i] = np.array([shift[0], shift[1], lift.get(i, 0.0)])
            continue
        s_t = to_curve(float(s_new[k]), offset)
        xy = curve.point(s_t, offset)
        p = np.array([xy[0], xy[1], case.anchor[i][2] + lift.get(i, 0.0)])
        target[i] = p - case.anchor[i]
        # the crown turns with the arch: by the angle between the tangent where it stands and the target's tangent
        # where it lands, plus its own measured rotation off the tangent (incisors); small totals are left alone
        t0, t1 = arch.tangent(s_cur[i], offset), curve.tangent(s_t, offset)
        turn = float(np.degrees(np.arctan2(t0[0] * t1[1] - t0[1] * t1[0], t0 @ t1)))
        yaw = rot.get(i, 0.0) + turn
        if abs(yaw) >= ROTATION_MIN_DEG:
            target.yaw[i] = round(yaw, 2)
    for i in ids:
        if i not in target:
            target[i] = None
    for i, y in target.yaw.items():
        notes.append(f"{label(i)} 회전 {y:+.1f}° 보정")
    for i, dz in sorted(lift.items()):
        notes.append(f"{label(i)} 수직 {dz:+.1f}mm 보정")
    shown = {pr: v for pr, v in extra.items() if abs(v) >= 0.1}
    if shown:
        notes.append("치관 모양에 맞춰 접촉 간격 조정 "
                     + ", ".join(f"{to_fdi(a)}-{to_fdi(b)} {v:+.1f}mm" for (a, b), v in sorted(shown.items())))
    disp = [float(np.linalg.norm(v)) for v in target.values() if v is not None]
    info = {"strategy": strategy, "space_gain_mm": round(gain, 2), "crowding_mm": crowd, "space_deficit_mm": deficit,
            "needed_mm": round(sum(width[i] for i in ids), 1),
            "mean_move_mm": round(float(np.mean(disp)), 2), "max_move_mm": round(float(np.max(disp)), 2),
            "notes": notes, "removed": [i for i in ids if target[i] is None], "locked": sorted(lock),
            "extraction": list(extraction) if strategy == "extraction" else [],
            "open_space_mm": round(open_mm, 2),
            "ipr_mm_per_surface": ipr_limit_mm if strategy in ("ipr", "expansion_ipr") else 0.0,
            "ipr_applied_teeth": sorted(red) if ipr_limit_mm > 0 else [],
            # contact surfaces the IPR is cut from (ipr_cut.py): [a, b, mm at that contact], half from each tooth
            # that gets IPR - the list a per-contact prescription (#57) will supply
            "ipr_surfaces": [[a, b, round(ipr_limit_mm / 2 * ((a in red) + (b in red)), 4)]
                             for a, b in case.neighbors() if (a in red or b in red)] if red and ipr_limit_mm > 0 else [],
            "ipr_exclude": sorted(ipr_exclude), "expansion_mm_per_side": round(float(offset), 2),
            "rotation_deg": {i: y for i, y in sorted(target.yaw.items())},
            "vertical_mm": {i: round(v, 2) for i, v in sorted(lift.items())},
            "shape_room_mm": round(sum(extra.values()), 2)}
    laid = [i for i in active if i in SPAN or i in (3, 14)] if anchored else active
    pairs = {(a, b): (slack.get((a, b), 0.0) if anchored else 0.0) for a, b in zip(laid, laid[1:])}
    return target, info, pairs, fits


def _corrections(case: Case, active: list[int], lock) -> tuple[dict[int, float], dict[int, float]]:
    """(derotation deg, vertical move mm) for crowns that are clearly rotated or out of level; locked crowns stay."""
    rot = {i: -case.crown_yaw(i) for i in active
           if i not in lock and case.yaw_measurable(i) and abs(case.crown_yaw(i)) >= ROTATION_MIN_DEG}
    order = sorted((i for i in case.ids if i in active), key=lambda i: case.arch.s_of(case.anchor[i]))
    lift = {}
    off = {}                      # how far each crown's top is from its two neighbours' mean
    for k, i in enumerate(order):
        # end crowns are skipped: one-sided reference, and the last molars sit lower on the occlusal curve by nature
        if k in (0, len(order) - 1):
            continue
        nb = [case.crown_top(j) for j in (order[k - 1], order[k + 1])]
        off[i] = case.crown_top(i) - float(np.mean(nb))
        if i not in lock and abs(off[i]) > VERTICAL_MIN_MM:
            lift[i] = -off[i]
    # a crown out of level with its mirror twin (a canine hanging 1.4 mm below the other on 000097) without standing
    # out from its own neighbours: the one further from its neighbours' level is brought to its twin's height
    for i in order:
        j = 17 - i
        if i < j and j in off and i in off and i not in lift and j not in lift:
            zi, zj = case.crown_top(i) + lift.get(i, 0.0), case.crown_top(j) + lift.get(j, 0.0)
            if abs(zi - zj) > VERTICAL_MIN_MM:
                mover, other = (i, j) if abs(off[i]) >= abs(off[j]) else (j, i)
                if mover not in lock:
                    lift[mover] = round(case.crown_top(other) - case.crown_top(mover), 2)
    return rot, lift


def unsupported_reasons(case: Case) -> list[str]:
    """Why the core cannot plan this arch at all (empty = in scope). Checked before any strategy is tried, so an
    out-of-scope case ends as "unsupported" with a reason instead of a plan that looks valid but ignores the problem."""
    out = []
    missing = [i for i in range(case.ids[0], case.ids[-1] + 1) if i not in case.ids]
    if missing:
        out.append(f"{label(missing)} 결손: 결손 공간이 있는 악궁은 아직 계획하지 않음 (연속된 치열만 지원)")
    if len(case.ids) < 6:
        out.append(f"치아 {len(case.ids)}개: 악궁을 맞추기에 부족 (6개 이상 필요)")
    for i in case.ids:
        if case.yaw_measurable(i) and abs(case.crown_yaw(i)) >= MD_SEARCH_LIMIT_DEG:
            out.append(f"{label(i)} 회전 {case.crown_yaw(i):+.0f}°: 측정 범위(±{MD_SEARCH_LIMIT_DEG:.0f}°) 끝 — 실제로는 더 돌아 있을 수 있음")
    return out


def intake_report(case: Case) -> dict:
    """What was read from a scan, for the dentist to confirm before planning: tooth numbers, missing teeth, widths,
    crowding, the rotations and height differences the planner would correct, and whether the case is in scope."""
    from .limits import UPPER
    rot, lift = _corrections(case, list(case.ids), set())
    why = unsupported_reasons(case)
    return {"teeth": case.ids, "n_teeth": len(case.ids),
            "missing": [i for i in UPPER if i not in case.ids and case.ids[0] < i < case.ids[-1]],
            "outside": [i for i in UPPER if i not in case.ids and not case.ids[0] < i < case.ids[-1]],
            "widths_mm": {i: round(case.contact_width(i), 1) for i in case.ids},
            "crowding_mm": crowding_mm(case),
            "rotation_deg": {i: round(-v, 1) for i, v in sorted(rot.items())},
            "vertical_mm": {i: round(-v, 1) for i, v in sorted(lift.items())},
            "scanned_gingiva": getattr(case, "_gum", None) is not None,
            "unsupported": why, "ready": not why}


def plan_stages(case: Case, target: dict, order: str = "simultaneous"):
    """Split current -> target into aligners. order: 'simultaneous' | 'anterior_first' | 'sequential'."""
    moves = {i: t for i, t in target.items() if t is not None}
    if order == "anterior_first":
        groups = [[i for i in moves if i in ANTERIOR], [i for i in moves if i not in ANTERIOR]]
    elif order == "sequential":
        # Anchorage-respecting: posterior to anterior, at most 3 neighbouring teeth per phase.
        ordered = sorted(moves, key=lambda i: (i in ANTERIOR, -abs(i - 8.5)))
        groups = [ordered[k:k + 3] for k in range(0, len(ordered), 3)]
    elif order == "simultaneous":
        groups = [list(moves)]
    else:
        raise ValueError("order must be simultaneous | anterior_first | sequential")
    stages: list[dict[int, np.ndarray]] = []
    done = {i: np.zeros(3) for i in moves}
    per_group = []
    yaw = {i: yaw_of(target, i) for i in moves}
    done_yaw = {i: 0.0 for i in moves}
    for g in groups:
        dmax = max((np.linalg.norm(moves[i]) for i in g), default=0.0)
        ymax = max((abs(yaw[i]) for i in g), default=0.0)
        n = max(int(math.ceil(dmax / MAX_LINEAR_PER_ALIGNER - 1e-9)), int(math.ceil(ymax / MAX_ROTATION_PER_ALIGNER - 1e-9)))
        n = max(n, 1) if dmax > 1e-9 or ymax > 1e-9 else 0
        per_group.append(n)
        for s in range(1, n + 1):
            f = s / n
            st = Moves(done, yaw={i: y for i, y in done_yaw.items() if y})
            for i in g:
                st[i] = moves[i] * f
                if yaw[i]:
                    st.yaw[i] = yaw[i] * f
            stages.append(st)
        for i in g:
            done[i] = moves[i]
            done_yaw[i] = yaw[i]
    if not stages:
        stages = [Moves(done)]
    dmax_all = max(np.linalg.norm(v) for v in moves.values())
    n = len(stages)
    info = {"n_stages": n, "order": order, "stages_per_group": per_group, "max_move_mm": round(float(dmax_all), 2),
            "per_stage_mm": round(float(dmax_all / max(per_group[0], 1)), 3), "months": months_from_stages(n)}
    return stages, info


def _touching_pairs(case: Case, disp: dict) -> list[tuple[int, int]]:
    """Pairs of crowns still in the arch (extracted ones are absent from disp) whose moved hull boxes intersect —
    every pair, not only the original neighbours, so crowns that meet after an extraction are checked too."""
    ids = [i for i in case.ids if i in disp]
    box = {i: case.placed(i, disp[i], yaw_of(disp, i), hull=True).bounds if yaw_of(disp, i)
           else case.hull[i].bounds + np.asarray(disp[i])[None, :] for i in ids}
    out = []
    for k, a in enumerate(ids):
        for b in ids[k + 1:]:
            A, B = box[a], box[b]
            if np.all(A[0] < B[1]) and np.all(B[0] < A[1]):
                out.append((a, b))
    return out


def validate(case: Case, stages: list[dict], stage_cap: int | None = None,
             space_deficit_mm: float | None = None, constraints: Constraints | None = None,
             target_info: dict | None = None) -> list[dict]:
    case = cut_case(case, target_info)      # collisions are checked on the crowns with the IPR cut (#62)
    viol: list[dict] = []
    if constraints:
        constraints.check_case(case.ids)
        stage_cap = constraints.stage_cap
        info = target_info or {}
        removed = set(case.ids) - set(stages[-1]) if stages else set(case.ids)
        if removed and not constraints.allow_extraction:
            viol.append({"stage": None, "type": "extraction_forbidden", "teeth": sorted(removed)})
        elif constraints.allow_extraction and removed != set(constraints.extraction):
            # the plan must extract exactly the prescribed teeth: not others, and not skip them (#56)
            viol.append({"stage": None, "type": "extraction_mismatch", "teeth": sorted(removed ^ set(constraints.extraction)),
                         "prescribed": list(constraints.extraction), "removed": sorted(removed)})
        for si, st in enumerate(stages, 1):
            for tooth in constraints.lock:
                if tooth not in st or np.linalg.norm(st[tooth]) > 1e-6:
                    viol.append({"stage": si, "type": "locked_tooth", "teeth": [tooth]})
        ipr = info.get("ipr_mm_per_surface", 0)
        if ipr > constraints.ipr_limit_mm + 1e-9:
            viol.append({"stage": None, "type": "ipr_limit", "mm": ipr, "limit": constraints.ipr_limit_mm})
        excluded = set(info.get("ipr_applied_teeth", [])) & set(constraints.ipr_exclude)
        if excluded:
            viol.append({"stage": None, "type": "ipr_excluded", "teeth": sorted(excluded)})
        if info.get("open_space_mm", 0.0) > SPACE_DEFICIT_TOLERANCE_MM:
            # extraction space that no molar can close (a locked molar or locked teeth around it): not a finished plan
            viol.append({"stage": None, "type": "extraction_space_open", "mm": info["open_space_mm"],
                         "limit": SPACE_DEFICIT_TOLERANCE_MM})
    if space_deficit_mm is not None and space_deficit_mm > SPACE_DEFICIT_TOLERANCE_MM:
        viol.append({"stage": None, "type": "space_deficit", "mm": round(space_deficit_mm, 2),
                     "limit": SPACE_DEFICIT_TOLERANCE_MM})
    for si, disp in enumerate(stages, 1):
        full = {i: disp.get(i, np.zeros(3)) for i in case.ids}
        for a, b in _touching_pairs(case, disp):
            base = case.pair_baseline(a, b)
            ov = case._overlap(a, b, full[a], full[b], yaw_of(disp, a), yaw_of(disp, b))
            if ov - base > NEW_OVERLAP_MM3:
                viol.append({"stage": si, "type": "collision", "teeth": [a, b],
                             "overlap_mm3": round(ov, 2), "baseline": round(base, 2)})
        for i, v in disp.items():
            prev = stages[si - 2].get(i, np.zeros(3)) if si > 1 else np.zeros(3)
            step = float(np.linalg.norm(v - prev))
            if step > MAX_LINEAR_PER_ALIGNER + 1e-6:
                viol.append({"stage": si, "type": "move_limit", "teeth": [i],
                             "mm": round(step, 3), "limit": MAX_LINEAR_PER_ALIGNER})
            turn = abs(yaw_of(disp, i) - (yaw_of(stages[si - 2], i) if si > 1 else 0.0))
            if turn > MAX_ROTATION_PER_ALIGNER + 1e-6:
                viol.append({"stage": si, "type": "rotation_limit", "teeth": [i],
                             "deg": round(turn, 2), "limit": MAX_ROTATION_PER_ALIGNER})
    if stage_cap and len(stages) > stage_cap:
        viol.append({"stage": None, "type": "stage_cap", "n": len(stages), "limit": stage_cap})
    return viol


def summarize(viol: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for v in viol:
        out[v["type"]] = out.get(v["type"], 0) + 1
    return out


def export_stl(case: Case, stages: list[dict], out: str) -> int:
    os.makedirs(out, exist_ok=True)
    for si, disp in enumerate(stages, 1):
        d = os.path.join(out, f"stage_{si:02d}")
        os.makedirs(d, exist_ok=True)
        for i, v in disp.items():
            case.placed(i, v, yaw_of(disp, i)).export(os.path.join(d, f"{i}.stl"))
    return len(stages)


def export_zip(case: Case, stages: list[dict], zip_path: str) -> str:
    os.makedirs(os.path.dirname(zip_path) or ".", exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for si, disp in enumerate(stages, 1):
            for i, v in disp.items():
                m = case.placed(i, v, yaw_of(disp, i))
                z.writestr(f"stage_{si:02d}/{i}.stl", m.export(file_type="stl"))
    return zip_path


def export_print_models(case: Case, stages: list[dict], zip_path: str, case_id: str) -> dict:
    """Add print_models/<case_id>_U_stage<NN>.stl (one printable arch model per stage) and a README to the zip.
    A case without scanned gingiva gets only the README saying why; the per-tooth files are left as they are."""
    from .print_model import print_models, readme
    files, report = print_models(case, stages, case_id)
    with zipfile.ZipFile(zip_path, "a", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(f"print_models/{name}", data)
        z.writestr("print_models/README.txt", readme(report))
    return report


def strategies_for(allowed, constraints: Constraints | None) -> list[str]:
    """The strategies a prescription allows (#56): with extraction teeth prescribed, only extraction (the other
    strategies would not extract them); without, every allowed strategy but extraction (the app does not pick teeth).
    A prescription whose strategy the caller excluded is an error, not a silent other plan."""
    allowed = list(dict.fromkeys(allowed))
    if constraints is not None and constraints.extraction:
        if "extraction" not in allowed:
            raise ValueError("처방은 발치인데 요청한 전략에 발치가 없습니다.")
        return ["extraction"]
    return [s for s in allowed if s != "extraction"]


def compare_strategies(case: Case, allowed=STRATEGIES, stage_cap: int | None = None,
                       order: str = "simultaneous", constraints: Constraints | None = None) -> list[dict]:
    rows = []
    for s in strategies_for(allowed, constraints):
        target, info = propose_target(case, s, constraints=constraints)
        stages, sinfo = plan_stages(case, target, order=constraints.order if constraints else order)
        viol = validate(case, stages, stage_cap=stage_cap, space_deficit_mm=info["space_deficit_mm"],
                        constraints=constraints, target_info=info)
        rows.append({"strategy": s, "n_stages": sinfo["n_stages"], "months": sinfo["months"],
                     "violations": len(viol), "by_type": summarize(viol), "passed": not viol,
                     "removed": info["removed"], "space_gain_mm": info["space_gain_mm"],
                     "_target": target, "_stages": stages, "_info": info, "_sinfo": sinfo, "_viol": viol})
    return rows
