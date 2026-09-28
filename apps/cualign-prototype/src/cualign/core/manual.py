"""Manual target edits (직접 이동): the dentist moves crowns of a target arrangement by hand.

The screen sends each edited crown's total pose from the scan (world translation mm, yaw deg about its vertical axis
through the centroid, as planner.Moves); the rest keep the base target's pose. The result is a new target with the
base target's info (strategy, IPR, extraction) and `source: "manual"`, staged and validated like any other target.
LLMs never produce these numbers; the dentist does, and the same rules check them.

frames() gives the axes the screen moves along: mesial (along the arch tangent, toward the midline), buccal (the arch's
outward normal), occlusal (+z: the occlusal plane is z = 0 and the crowns hang towards -z, see Case.crown_top).
"""
from __future__ import annotations

import math

import numpy as np

from .case import Case
from .constraints import Constraints
from .fdi import label
from .limits import MAX_LINEAR_PER_ALIGNER, MAX_ROTATION_PER_ALIGNER, months_from_stages
from .planner import NEW_OVERLAP_MM3, Moves, _touching_pairs, crowding_mm, cut_case, yaw_of

# Bounds of one hand edit (assumed PoC limits, not clinical): a crown further than this from the scan, or turned more,
# is a slip of the mouse rather than a movement to stage.
MAX_EDIT_MM = 10.0
MAX_EDIT_YAW_DEG = 45.0
SAME_MM = 1e-4      # a pose this close to the base target's is unchanged
SAME_DEG = 1e-3


def frames(case: Case) -> dict[int, dict[str, list[float]]]:
    """{tooth: {mesial, buccal, occlusal}} unit vectors (world) at the crown's place on the scan's arch."""
    out = {}
    for i in case.ids:
        if i in (case.ids[0], case.ids[-1]) and len(case.ids) > 3:   # the global fit's end derivative is unreliable
            t = case.arch.end_direction(last=i == case.ids[-1], pad=0.0)
        else:
            t = case.arch.tangent(case.arch.s_of(case.anchor[i]))
        t = np.asarray(t, float) / np.linalg.norm(t)
        n = case.arch.sign * np.array([-t[1], t[0]])            # outward, as Arch.normal
        mesial = t if i <= 8 else -t                          # the tangent runs 2 -> 15: toward the midline on 2..8
        out[i] = {"mesial": np.round([*mesial, 0.0], 4).tolist(), "buccal": np.round([*n, 0.0], 4).tolist(),
                  "occlusal": [0.0, 0.0, 1.0]}
    return out


def scan_start(case: Case, constraints: Constraints) -> tuple[Moves, dict]:
    """(target, info) to place by hand from the scan (처음부터 수동 배치, before any strategy): every crown where it
    stands, the prescribed extraction teeth removed, only the prescribed IPR contacts cut (no automatic IPR, no
    expansion). Strategy "manual"; nothing is computed about space, so no space deficit is claimed either."""
    constraints.check_case(case.ids)
    removed = sorted(set(constraints.extraction))
    target = Moves({i: (None if i in removed else np.zeros(3)) for i in case.ids})
    surfaces = [[int(a), int(b), float(mm)] for a, b, mm in constraints.ipr_surfaces]
    info = {"strategy": "manual", "source": "scan", "space_gain_mm": 0.0, "crowding_mm": round(crowding_mm(case), 2),
            "space_deficit_mm": 0.0, "open_space_mm": 0.0, "mean_move_mm": 0.0, "max_move_mm": 0.0,
            "notes": ["치료 전 위치에서 시작한 수동 배치 (전략 없음 · 자동 IPR·확장 없음)"],
            "removed": removed, "locked": sorted(constraints.lock), "extraction": removed,
            "ipr_mm_per_surface": 0.0, "ipr_applied_teeth": sorted({t for a, b, _ in surfaces for t in (a, b)}),
            "ipr_surfaces": surfaces, "ipr_exclude": sorted(constraints.ipr_exclude), "expansion_mm_per_side": 0.0,
            "rotation_deg": {}, "vertical_mm": {}}
    return target, info


def apply_edits(base: dict, edits: dict[int, dict], constraints: Constraints) -> tuple[Moves, list[int]]:
    """(the new target, the crowns that changed). `edits` = {tooth: {"d": [x, y, z], "yaw": deg}} in total from the
    scan; a tooth left out keeps the base pose. Raises ValueError for a tooth not in the target, an extracted or
    locked crown that moves, or a pose beyond the edit bounds."""
    new = Moves({i: (None if v is None else np.asarray(v, float).copy()) for i, v in base.items()},
                yaw={i: yaw_of(base, i) for i in base if yaw_of(base, i)})
    changed = []
    lock = set(constraints.lock)
    for i, e in sorted(edits.items()):
        if i not in base:
            raise ValueError(f"{label(i)} 치아는 이 목표 배열에 없습니다" if 1 <= i <= 16 else "치아 번호가 올바르지 않습니다")
        d = np.asarray(e.get("d", base[i] if base[i] is not None else [0.0, 0.0, 0.0]), float)
        y = float(e.get("yaw", yaw_of(base, i)))
        if d.shape != (3,) or not np.all(np.isfinite(d)) or not math.isfinite(y):
            raise ValueError(f"{label(i)} 치아의 이동값이 올바르지 않습니다")
        if base[i] is None:
            raise ValueError(f"발치하는 {label(i)} 치아는 옮길 수 없습니다")
        if np.linalg.norm(d - base[i]) <= SAME_MM and abs(y - yaw_of(base, i)) <= SAME_DEG:
            continue
        if i in lock:
            raise ValueError(f"고정 치아 {label(i)}은 옮길 수 없습니다")
        if np.linalg.norm(d) > MAX_EDIT_MM or abs(y) > MAX_EDIT_YAW_DEG:
            raise ValueError(f"{label(i)} 치아의 이동이 한 번에 조정할 수 있는 범위({MAX_EDIT_MM:g}mm, {MAX_EDIT_YAW_DEG:g}°)를 넘습니다")
        new[i] = d
        if abs(y) > SAME_DEG:
            new.yaw[i] = y
        else:
            new.yaw.pop(i, None)
        changed.append(i)
    return new, changed


def manual_info(base_info: dict, parent_target_id: str, changed: list[int], base_changed=()) -> dict:
    """The base target's info with where it came from: source, parent target, the crowns moved by hand (accumulated
    over edits of an edited target)."""
    teeth = sorted(set(base_changed) | set(changed))
    return {**base_info, "source": "manual", "parent_target_id": parent_target_id, "manual_teeth": teeth}


def check(case: Case, target: dict, info: dict) -> dict:
    """What the screen shows while the dentist drags, without staging: the largest move and turn, the fewest aligners
    they need at the per-aligner limits (collisions on the way can add more), and the crown pairs whose hulls overlap
    in the target by more than the validator's NEW_OVERLAP_MM3 over where they started."""
    disp = Moves({i: np.asarray(v, float) for i, v in target.items() if v is not None},
                 yaw={i: yaw_of(target, i) for i in target if target[i] is not None and yaw_of(target, i)})
    cut = cut_case(case, info)          # measured on the crowns with the IPR cut, as the validator measures (#62)
    overlaps = []
    for a, b in _touching_pairs(cut, disp):
        ov = cut._overlap(a, b, disp[a], disp[b], yaw_of(disp, a), yaw_of(disp, b)) - cut.pair_baseline(a, b)
        if ov > NEW_OVERLAP_MM3:
            overlaps.append({"teeth": [a, b], "overlap_mm3": round(float(ov), 2)})
    move = max((float(np.linalg.norm(v)) for v in disp.values()), default=0.0)
    turn = max((abs(yaw_of(disp, i)) for i in disp), default=0.0)
    n = max((max(math.ceil(float(np.linalg.norm(disp[i])) / MAX_LINEAR_PER_ALIGNER - 1e-9),
                 math.ceil(abs(yaw_of(disp, i)) / MAX_ROTATION_PER_ALIGNER - 1e-9)) for i in disp), default=0)
    return {"max_move_mm": round(move, 2), "max_yaw_deg": round(turn, 2), "min_stages": int(n),
            "min_months": months_from_stages(int(n)), "overlaps": overlaps}
