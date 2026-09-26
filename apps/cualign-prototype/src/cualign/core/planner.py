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

from .arch import Arch
from .case import MD_WINDOW_DEG, Case
from .constraints import Constraints
from .limits import (ANTERIOR, IPR_PER_SURFACE, MAX_EXPANSION_PER_SIDE, MAX_LINEAR_PER_ALIGNER, MAX_ROTATION_PER_ALIGNER,
                     PREMOLARS, SPACE_DEFICIT_TOLERANCE_MM, STRATEGIES, months_from_stages)

FIRST_PREMOLARS = (5, 12)   # one per side, Universal numbering
CLEARANCE = 0.05            # mm left between neighbouring crowns in the target
# A pair collides when its hull overlap grows by more than this over where it started. Assumed tolerance: hulls of real
# (concave) crowns already overlap by several mm3 in a well-aligned arch, so an absolute or relative threshold on the
# raw overlap either flags every stage or misses a push into a pair that started overlapped.
NEW_OVERLAP_MM3 = 1.0
# Rotation and vertical corrections (assumed thresholds). A crown is derotated only when its mesiodistal axis is off the
# arch tangent by at least ROTATION_MIN_DEG: the fitted tangent itself is off by up to ~10° on known arches (golden set
# B), so smaller angles cannot be told apart from fit error. A crown is levelled when its top is more than
# VERTICAL_MIN_MM above or below its two neighbours' mean (not a flat plane: canine tips and lateral incisors differ
# by nature; the end molars are left alone).
ROTATION_MIN_DEG = 10.0
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
    out: set[int] = set()
    while True:
        worst, worst_d = None, DISPLACED_MM
        for i in span:
            if i in out:
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


def _span_available(case: Case) -> tuple[list[int], float, float, dict[int, float]]:
    """(span teeth in arch order, arch length available to them along the contacts, width added for missing end
    molars, contact widths of the span teeth) — see crowding_mm. Cached on the case (it does not change).

    The line of contacts is taken as the arch of the crowns that stand in line (teeth standing out of it left out,
    see _displaced), moved out to where the contacts are: by the median distance of the in-line contacts from it.
    A fit through the contacts themselves would need them all; leaving out a displaced tooth leaves gaps a flexible
    curve overshoots, while the crown-centre arch keeps a dozen points and its shape. The widths are read on the
    same in-line arch: a far-out crown bends the case's arch and tilts its neighbours' axes (+0.9 mm over the span)."""
    cached = getattr(case, "_span_cache", None)
    if cached is not None and cached[0] is case.arch:
        return cached[1]
    order = case.arch_order
    span = [i for i in order if i in SPAN]
    if len(span) < 3:
        span = order
    first, last = order.index(span[0]), order.index(span[-1])
    out = _displaced(case, span)
    base = Arch(np.array([case.anchor[j] for j in order if j not in out]))
    pairs = [(a, b) for a, b in zip(order, order[1:]) if first - 1 <= order.index(a) and order.index(b) <= last + 1
             and a not in out and b not in out]
    offs = []
    for a, b in pairs:
        p = case.contact_point(a, b)
        s0 = base.s_of(p)
        offs.append(float((p[:2] - base.point(s0)) @ base.normal(s0)))
    e = round(float(np.median(offs)), 3) if offs else 0.0
    widths = {i: case.contact_width(i, base) for i in span}
    ends, extra = [], 0.0

    def molar_end(m, side):    # the molar's mesial surface on the contact line, when its neighbour stands out of line
        return base.s_of(case.anchor[m], e) + side * case.contact_width(m, base) / 2

    if first > 0:
        m = order[first - 1]
        ends.append(molar_end(m, 1) if span[0] in out else base.s_of(case.contact_point(m, span[0]), e))
    else:                                     # no molar in front of the span: its first tooth's own width
        ends.append(base.s_of(case.anchor[span[0]], e))
        extra += widths[span[0]] / 2
    if last < len(order) - 1:
        m = order[last + 1]
        ends.append(molar_end(m, -1) if span[-1] in out else base.s_of(case.contact_point(span[-1], m), e))
    else:
        ends.append(base.s_of(case.anchor[span[-1]], e))
        extra += widths[span[-1]] / 2
    result = (span, abs(ends[1] - ends[0]), extra, widths)
    case._span_cache = (case.arch, result)
    return result


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
    """Arc positions (on the curve offset by `offset`) of the mesial contacts of the first molars (3|4 and 13|14)."""
    order = case.arch_order
    a = order[order.index(3) + 1] if order.index(3) + 1 < len(order) else 3
    b = order[order.index(14) - 1] if order.index(14) > 0 else 14
    return (case.arch.s_of(case.contact_point(3, a), offset), case.arch.s_of(case.contact_point(b, 14), offset))


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

LATERAL_TOL_MM = 0.75   # a crown this close to the fitted arch is left at its distance from it (natural arches are not
                        # polynomials; pulling every crown onto the curve moved aligned teeth ~1 mm into their neighbours)


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


def _anchored_layout(case: Case, active: list[int], width: dict, s_cur: dict, offset: float,
                     extra: dict | None = None) -> tuple[list, dict]:
    """Least movement that aligns the span between the anchored first molars.

    Returns (arc position per active tooth, None for the anchors; lateral offset kept per span tooth). Along the arch,
    each span crown moves only as far as needed so that neighbours sit at least contact width apart and the span fits
    between the first molars' mesial contacts — an aligned arch stays put, a crowded one opens where it overlaps
    (a bounded isotonic fit). Across the arch, only crowns more than LATERAL_TOL_MM off the fitted arch are brought
    onto it. Widths are contact widths laid out along the contact line; the crowns are placed on the crown-centre arch,
    which runs inside the contacts and is shorter by the ratio k. When the span does not fit, the missing space is
    shared out as even overlap (the space deficit is reported by the caller). `extra`: more room for a pair of
    neighbours whose crown shapes still meet at contact width (see SHAPE_STEP_MM)."""
    arch = case.arch
    sa, sb = _span_contacts(case, offset)
    sa0, sb0 = _span_contacts(case, 0.0)
    _, avail0, _, _ = _span_available(case)
    avail = avail0 + (sb - sa) - (sb0 - sa0)          # the expansion lengthens the contact line as much as the centre arc
    k = (sb - sa) / avail if avail > 0 else 1.0
    extra = extra or {}
    span = [i for i in active if i in SPAN]
    gaps = [k * ((width[a] + width[b]) / 2 + CLEARANCE + extra.get((a, b), 0.0)) for a, b in zip(span, span[1:])]
    lo = sa + k * (width[span[0]] / 2 + CLEARANCE + extra.get((3, span[0]), 0.0))
    hi = sb - k * (width[span[-1]] / 2 + CLEARANCE + extra.get((span[-1], 14), 0.0))
    if sum(gaps) > hi - lo and sum(gaps) > 0:          # does not fit: squeeze every gap alike
        f = max(hi - lo, 0.0) / sum(gaps)
        gaps = [g * f for g in gaps]
    D = np.concatenate([[0.0], np.cumsum(gaps)])
    t = _isotonic([s_cur[i] - D[m] for m, i in enumerate(span)])
    t = np.clip(t, lo, max(lo, hi - D[-1]))
    pos = {i: float(t[m] + D[m]) for m, i in enumerate(span)}
    lateral = {}
    for i in span:
        s0 = arch.s_of(case.anchor[i])
        e = float((case.anchor[i][:2] - arch.point(s0)) @ arch.normal(s0))
        lateral[i] = e if abs(e) < LATERAL_TOL_MM else 0.0
    return [pos.get(i) for i in active], lateral


def _ipr_gain(ids, ipr_exclude, ipr_limit_mm=IPR_PER_SURFACE) -> float:
    surf = sum((2 if 0 < k < len(ids) - 1 else 1) for k, i in enumerate(ids) if i not in ipr_exclude)
    return surf * ipr_limit_mm * 0.5


def propose_target(case: Case, strategy: str, ipr_exclude: set[int] | frozenset[int] = frozenset(),
                   lock: set[int] | frozenset[int] = frozenset(), constraints: Constraints | None = None):
    """Return ({tooth: displacement(3,) | None}, info). None = extracted.

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
    ipr_limit_mm = constraints.ipr_limit_mm if constraints else IPR_PER_SURFACE
    # Contact widths say how much room the teeth need; the crown shapes can need more (an incisor is widest labial of
    # its contacts). Where two neighbours still meet in the target, give that pair more room and lay out again; the
    # expansion is sized for it too; room that cannot be made shows as the collision it leaves.
    extra: dict[tuple[int, int], float] = {}
    for _ in range(SHAPE_ROUNDS):
        target, info, pairs = _place(case, strategy, ipr_exclude, lock, ipr_limit_mm, extra)
        # measured as the validator measures (the meshes are not cut by IPR, #61), so a plan is not built on overlap
        # the validator will reject
        grow = [(a, b) for a, b in pairs
                if case._overlap(a, b, target[a], target[b], yaw_of(target, a), yaw_of(target, b))
                - case.pair_baseline(a, b) > TARGET_OVERLAP_MM3]
        if not grow:
            break
        for pr in grow:
            extra[pr] = extra.get(pr, 0.0) + SHAPE_STEP_MM
    return target, info


def _place(case: Case, strategy: str, ipr_exclude, lock, ipr_limit_mm: float, extra: dict):
    """One layout of propose_target: (target, info, neighbour pairs of the anchored span, empty when not anchored)."""
    arch = case.arch
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
    # mesial contacts are aligned into that space, and only space made inside it counts. Locked teeth keep the older
    # whole-arch chain.
    anchored = not lock and {3, 14} <= set(ids) and sum(1 for i in ids if i in SPAN) >= 3
    in_scope = (lambda i: i in SPAN) if anchored else (lambda i: True)
    red = _ipr_reductions(ids, ipr_exclude, ipr_limit_mm) if strategy in ("ipr", "expansion_ipr") else {}
    if strategy in ("expansion", "expansion_ipr"):
        # Expand only as much as needed (up to the 2 mm/side limit).
        shape = sum(extra.values())
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
        notes.append(f"IPR 면당 {ipr_limit_mm}mm x {surf}면" + (f" (제외 {sorted(ipr_exclude)})" if ipr_exclude else ""))
    if strategy == "extraction":
        rm = [i for i in FIRST_PREMOLARS if i in ids] or sorted(PREMOLARS & set(ids))[:2]
        if set(rm) & set(lock):
            raise ValueError("locked teeth cannot be extracted")
        for i in rm:
            gain += width[i]
            active.remove(i)
        notes.append(f"제1소구치 발치 {rm}")
    deficit = round(max(crowd - gain, 0.0), 2)       # the clinical deficit; shape room that does not fit shows as collision

    # Order along the arch by current arc-length coordinate (on the offset curve for expansion).
    s_cur = {i: arch.s_of(case.anchor[i], offset) for i in active}
    active.sort(key=lambda i: s_cur[i])
    lateral: dict[int, float] = {}
    if anchored:
        s_new, lateral = _anchored_layout(case, active, width, s_cur, offset, extra)
    else:
        gaps = [(width[active[k]] + width[active[k + 1]]) / 2 + CLEARANCE for k in range(len(active) - 1)]
        chain = np.concatenate([[0.0], np.cumsum(gaps)])          # contact chain, relative
        locked = [i for i in active if i in lock]
        if locked:
            k0 = active.index(locked[0])
            s_new = chain - chain[k0] + s_cur[locked[0]]
            if len(locked) > 1:
                notes.append(f"고정 {locked} 중 {locked[0]} 을 기준으로 정렬")
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
            shift = offset * arch.normal(arch.s_of(case.anchor[block]))
            target[i] = np.array([shift[0], shift[1], lift.get(i, 0.0)])
            continue
        xy = arch.point(float(s_new[k]), offset) + arch.normal(float(s_new[k])) * lateral.get(i, 0.0)
        p = np.array([xy[0], xy[1], case.anchor[i][2] + lift.get(i, 0.0)])
        target[i] = p - case.anchor[i]
        if i in rot:   # derotate onto the arch tangent where the crown ends up
            t0, t1 = arch.tangent(s_cur[i], offset), arch.tangent(float(s_new[k]), offset)
            turn = np.degrees(np.arctan2(t0[0] * t1[1] - t0[1] * t1[0], t0 @ t1))
            target.yaw[i] = round(rot[i] + float(turn), 2)
    for i in ids:
        if i not in target:
            target[i] = None
    for i, y in target.yaw.items():
        notes.append(f"치아 {i} 회전 {y:+.1f}° 보정")
    for i, dz in sorted(lift.items()):
        notes.append(f"치아 {i} 수직 {dz:+.1f}mm 보정")
    if extra:
        notes.append(f"치관 모양 때문에 접촉 폭보다 {sum(extra.values()):.1f}mm 더 둠 "
                     + ", ".join(f"{a}-{b}" for a, b in sorted(extra)))
    disp = [float(np.linalg.norm(v)) for v in target.values() if v is not None]
    info = {"strategy": strategy, "space_gain_mm": round(gain, 2), "crowding_mm": crowd, "space_deficit_mm": deficit,
            "needed_mm": round(sum(width[i] for i in ids), 1),
            "mean_move_mm": round(float(np.mean(disp)), 2), "max_move_mm": round(float(np.max(disp)), 2),
            "notes": notes, "removed": [i for i in ids if target[i] is None], "locked": sorted(lock),
            "ipr_mm_per_surface": ipr_limit_mm if strategy in ("ipr", "expansion_ipr") else 0.0,
            "ipr_applied_teeth": [i for i in ids if i not in ipr_exclude] if strategy in ("ipr", "expansion_ipr") and ipr_limit_mm > 0 else [],
            "ipr_exclude": sorted(ipr_exclude), "expansion_mm_per_side": round(float(offset), 2),
            "rotation_deg": {i: y for i, y in sorted(target.yaw.items())},
            "vertical_mm": {i: round(v, 2) for i, v in sorted(lift.items())},
            "shape_room_mm": round(sum(extra.values()), 2)}
    span_ids = [i for i in active if i in SPAN or i in (3, 14)] if anchored else []
    return target, info, list(zip(span_ids, span_ids[1:]))


def _corrections(case: Case, active: list[int], lock) -> tuple[dict[int, float], dict[int, float]]:
    """(derotation deg, vertical move mm) for crowns that are clearly rotated or out of level; locked crowns stay."""
    rot = {i: -case.crown_yaw(i) for i in active
           if i not in lock and case.yaw_measurable(i) and abs(case.crown_yaw(i)) >= ROTATION_MIN_DEG}
    order = sorted(case.ids, key=lambda i: case.arch.s_of(case.anchor[i]))
    lift = {}
    for k, i in enumerate(order):
        # end crowns are skipped: one-sided reference, and the last molars sit lower on the occlusal curve by nature
        if i not in active or i in lock or k in (0, len(order) - 1):
            continue
        nb = [case.crown_top(j) for j in (order[k - 1], order[k + 1])]
        dz = case.crown_top(i) - float(np.mean(nb))
        if abs(dz) > VERTICAL_MIN_MM:
            lift[i] = -dz
    return rot, lift


def unsupported_reasons(case: Case) -> list[str]:
    """Why the core cannot plan this arch at all (empty = in scope). Checked before any strategy is tried, so an
    out-of-scope case ends as "unsupported" with a reason instead of a plan that looks valid but ignores the problem."""
    out = []
    missing = [i for i in range(case.ids[0], case.ids[-1] + 1) if i not in case.ids]
    if missing:
        out.append(f"치아 {missing} 결손: 결손 공간이 있는 악궁은 아직 계획하지 않음 (연속된 치열만 지원)")
    if len(case.ids) < 6:
        out.append(f"치아 {len(case.ids)}개: 악궁을 맞추기에 부족 (6개 이상 필요)")
    for i in case.ids:
        if case.yaw_measurable(i) and abs(case.crown_yaw(i)) >= MD_SEARCH_LIMIT_DEG:
            out.append(f"치아 {i} 회전 {case.crown_yaw(i):+.0f}°: 측정 범위(±{MD_SEARCH_LIMIT_DEG:.0f}°) 끝 — 실제로는 더 돌아 있을 수 있음")
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
    viol: list[dict] = []
    if constraints:
        constraints.check_case(case.ids)
        stage_cap = constraints.stage_cap
        info = target_info or {}
        removed = set(case.ids) - set(stages[-1]) if stages else set(case.ids)
        if removed and not constraints.allow_extraction:
            viol.append({"stage": None, "type": "extraction_forbidden", "teeth": sorted(removed)})
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


def compare_strategies(case: Case, allowed=STRATEGIES, stage_cap: int | None = None,
                       order: str = "simultaneous", constraints: Constraints | None = None) -> list[dict]:
    rows = []
    for s in allowed:
        if constraints and s == "extraction" and not constraints.allow_extraction:
            continue
        target, info = propose_target(case, s, constraints=constraints)
        stages, sinfo = plan_stages(case, target, order=constraints.order if constraints else order)
        viol = validate(case, stages, stage_cap=stage_cap, space_deficit_mm=info["space_deficit_mm"],
                        constraints=constraints, target_info=info)
        rows.append({"strategy": s, "n_stages": sinfo["n_stages"], "months": sinfo["months"],
                     "violations": len(viol), "by_type": summarize(viol), "passed": not viol,
                     "removed": info["removed"], "space_gain_mm": info["space_gain_mm"],
                     "_target": target, "_stages": stages, "_info": info, "_sinfo": sinfo, "_viol": viol})
    return rows
