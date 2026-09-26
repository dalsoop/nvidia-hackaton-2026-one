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


def crowding_mm(case: Case) -> float:
    """Space deficit: sum of crown widths minus the arch length available between the end crowns."""
    arch = case.arch
    ids = case.ids
    w = {i: case.mesiodistal_width(i) for i in ids}
    s = sorted(arch.s_of(case.anchor[i]) for i in ids)
    first, last = ids[0], ids[-1]
    avail = (s[-1] - s[0]) + (w[first] + w[last]) / 2
    return round(sum(w.values()) - avail, 1)


def _expansion_for(arch, need_mm: float) -> tuple[float, float]:
    """Smallest per-side offset (0.5..2.0 mm) whose arch-length gain covers `need_mm`; else the 2 mm limit."""
    best = (MAX_EXPANSION_PER_SIDE, None)
    for offset in np.arange(0.5, MAX_EXPANSION_PER_SIDE + 1e-9, 0.1):
        offset = round(float(offset), 1)
        # gain over the span the crowns occupy (distal contact to distal contact), not over the extrapolated ends
        g = arch.expansion_gain(offset) * 0.8
        best = (offset, g)
        if g >= need_mm:
            break
    return best


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
    arch = case.arch
    ids = case.ids
    width = {i: case.mesiodistal_width(i) for i in ids}
    crowd = crowding_mm(case)

    active = list(ids)
    gain = 0.0
    notes: list[str] = []
    offset = 0.0
    if strategy in ("expansion", "expansion_ipr"):
        # Expand only as much as needed (up to the 2 mm/side limit): arc length grows ~ pi * offset.
        need = max(crowd, 0.0) if strategy == "expansion" else max(crowd - _ipr_gain(ids, ipr_exclude, ipr_limit_mm), 0.0)
        offset, exp_gain = _expansion_for(arch, need)
        gain += exp_gain
        notes.append(f"악궁 편측 {offset:.1f}mm 확장")
    if strategy in ("ipr", "expansion_ipr"):
        surf = 0
        for k, i in enumerate(ids):
            if i in ipr_exclude:
                continue
            n_surf = 2 if 0 < k < len(ids) - 1 else 1
            width[i] -= ipr_limit_mm * n_surf * 0.5   # each surface is shared by two teeth
            surf += n_surf
        gain += surf * ipr_limit_mm * 0.5
        notes.append(f"IPR 면당 {ipr_limit_mm}mm x {surf}면" + (f" (제외 {sorted(ipr_exclude)})" if ipr_exclude else ""))
    if strategy == "extraction":
        rm = [i for i in FIRST_PREMOLARS if i in ids] or sorted(PREMOLARS & set(ids))[:2]
        if set(rm) & set(lock):
            raise ValueError("locked teeth cannot be extracted")
        for i in rm:
            gain += width[i]
            active.remove(i)
        notes.append(f"제1소구치 발치 {rm}")
    deficit = round(max(crowd - gain, 0.0), 2)

    # Order along the arch by current arc-length coordinate (on the offset curve for expansion).
    s_cur = {i: arch.s_of(case.anchor[i], offset) for i in active}
    active.sort(key=lambda i: s_cur[i])
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
        xy = arch.point(float(s_new[k]), offset)
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
    disp = [float(np.linalg.norm(v)) for v in target.values() if v is not None]
    info = {"strategy": strategy, "space_gain_mm": round(gain, 2), "crowding_mm": crowd, "space_deficit_mm": deficit,
            "needed_mm": round(sum(width[i] for i in ids), 1),
            "mean_move_mm": round(float(np.mean(disp)), 2), "max_move_mm": round(float(np.max(disp)), 2),
            "notes": notes, "removed": [i for i in ids if target[i] is None], "locked": sorted(lock),
            "ipr_mm_per_surface": ipr_limit_mm if strategy in ("ipr", "expansion_ipr") else 0.0,
            "ipr_applied_teeth": [i for i in ids if i not in ipr_exclude] if strategy in ("ipr", "expansion_ipr") and ipr_limit_mm > 0 else [],
            "ipr_exclude": sorted(ipr_exclude), "expansion_mm_per_side": round(float(offset), 2),
            "rotation_deg": {i: y for i, y in sorted(target.yaw.items())},
            "vertical_mm": {i: round(v, 2) for i, v in sorted(lift.items())}}
    return target, info


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
            "widths_mm": {i: round(case.mesiodistal_width(i), 1) for i in case.ids},
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
