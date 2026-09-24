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

from .case import Case
from .constraints import Constraints
from .limits import (ANTERIOR, IPR_PER_SURFACE, MAX_EXPANSION_PER_SIDE, MAX_LINEAR_PER_ALIGNER, PREMOLARS,
                     SPACE_DEFICIT_TOLERANCE_MM, STRATEGIES, months_from_stages)

FIRST_PREMOLARS = (5, 12)   # one per side, Universal numbering
CLEARANCE = 0.05            # mm left between neighbouring crowns in the target


def crowding_mm(case: Case) -> float:
    """Space deficit: sum of crown widths minus the arch length available between the end crowns."""
    arch = case.arch
    ids = case.ids
    w = {i: case.mesiodistal_width(i) for i in ids}
    s = sorted(arch.s_of(case.pos0[i]) for i in ids)
    first, last = ids[0], ids[-1]
    avail = (s[-1] - s[0]) + (w[first] + w[last]) / 2
    return round(sum(w.values()) - avail, 1)


def _expansion_for(arch, need_mm: float) -> tuple[float, float]:
    """Smallest per-side offset (0.5..2.0 mm) whose arch-length gain covers `need_mm`; else the 2 mm limit."""
    _, cum0 = arch.samples(0.0)
    best = (MAX_EXPANSION_PER_SIDE, None)
    for offset in np.arange(0.5, MAX_EXPANSION_PER_SIDE + 1e-9, 0.1):
        offset = round(float(offset), 1)
        _, cum1 = arch.samples(offset)
        g = float(cum1[-1] - cum0[-1]) * 0.8
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
    s_cur = {i: arch.s_of(case.pos0[i], offset) for i in active}
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

    target: dict[int, np.ndarray | None] = {}
    for k, i in enumerate(active):
        if i in lock:
            target[i] = np.zeros(3)
            continue
        xy = arch.point(float(s_new[k]), offset)
        p = np.array([xy[0], xy[1], case.pos0[i][2]])
        target[i] = p - case.pos0[i]
    for i in ids:
        if i not in target:
            target[i] = None
    disp = [float(np.linalg.norm(v)) for v in target.values() if v is not None]
    info = {"strategy": strategy, "space_gain_mm": round(gain, 2), "crowding_mm": crowd, "space_deficit_mm": deficit,
            "needed_mm": round(sum(width[i] for i in ids), 1),
            "mean_move_mm": round(float(np.mean(disp)), 2), "max_move_mm": round(float(np.max(disp)), 2),
            "notes": notes, "removed": [i for i in ids if target[i] is None], "locked": sorted(lock),
            "ipr_mm_per_surface": ipr_limit_mm if strategy in ("ipr", "expansion_ipr") else 0.0,
            "ipr_applied_teeth": [i for i in ids if i not in ipr_exclude] if strategy in ("ipr", "expansion_ipr") and ipr_limit_mm > 0 else [],
            "ipr_exclude": sorted(ipr_exclude), "expansion_mm_per_side": round(float(offset), 2)}
    return target, info


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
    for g in groups:
        dmax = max((np.linalg.norm(moves[i]) for i in g), default=0.0)
        n = max(1, int(math.ceil(dmax / MAX_LINEAR_PER_ALIGNER))) if dmax > 1e-9 else 0
        per_group.append(n)
        for s in range(1, n + 1):
            f = s / n
            st = dict(done)
            for i in g:
                st[i] = moves[i] * f
            stages.append(st)
        for i in g:
            done[i] = moves[i]
    if not stages:
        stages = [dict(done)]
    dmax_all = max(np.linalg.norm(v) for v in moves.values())
    n = len(stages)
    info = {"n_stages": n, "order": order, "stages_per_group": per_group, "max_move_mm": round(float(dmax_all), 2),
            "per_stage_mm": round(float(dmax_all / max(per_group[0], 1)), 3), "months": months_from_stages(n)}
    return stages, info


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
    TH = max(case.baseline.values()) * 2 if case.baseline else 0.0
    for si, disp in enumerate(stages, 1):
        full = {i: disp.get(i, np.zeros(3)) for i in case.ids}
        for (a, b), base in case.baseline.items():
            if a not in disp or b not in disp:
                continue
            ov = case._overlap(a, b, full[a], full[b])
            if ov > max(TH, base * 3, 0.5):
                viol.append({"stage": si, "type": "collision", "teeth": [a, b],
                             "overlap_mm3": round(ov, 2), "baseline": round(base, 2)})
        for i, v in disp.items():
            prev = stages[si - 2].get(i, np.zeros(3)) if si > 1 else np.zeros(3)
            step = float(np.linalg.norm(v - prev))
            if step > MAX_LINEAR_PER_ALIGNER + 1e-6:
                viol.append({"stage": si, "type": "move_limit", "teeth": [i],
                             "mm": round(step, 3), "limit": MAX_LINEAR_PER_ALIGNER})
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
            m = case.mesh[i].copy(); m.apply_translation(v)
            m.export(os.path.join(d, f"{i}.stl"))
    return len(stages)


def export_zip(case: Case, stages: list[dict], zip_path: str) -> str:
    os.makedirs(os.path.dirname(zip_path) or ".", exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for si, disp in enumerate(stages, 1):
            for i, v in disp.items():
                m = case.mesh[i].copy(); m.apply_translation(v)
                z.writestr(f"stage_{si:02d}/{i}.stl", m.export(file_type="stl"))
    return zip_path


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
