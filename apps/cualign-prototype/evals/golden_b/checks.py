"""Golden set B: known-answer checks of the calculation core on ground-truth-first arches (see shapes.py).

Each check names the plan step it guards (1 = correctness fixes, 2 = measurement definition, 5 = rotation and
vertical correction) and returns (ok, measured, expected). Tolerances are part of the spec and stated inline.
Real-scan regressions from the independent review need git-ignored local data and are skipped without it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from cualign.core import planner
from cualign.core.arch import Arch
from cualign.core.case import Case

from . import shapes as S

APP = Path(__file__).resolve().parents[2]
POSEIDON = APP / "data" / "cases"
TOL_WIDTH = 0.2        # mm, mesiodistal width
TOL_CROWD = 0.5        # mm, crowding (space deficit)
TOL_INV = 0.2          # mm, change allowed under transforms that must not change anything
TOL_EXP = 0.3          # mm, geometric expansion gain
TOL_YAW = 3.0          # deg, derotation target (the fitted arch tangent itself is off by ~3° on this arch)
TOL_Z = 0.2            # mm, levelling target
NEW_OVERLAP = 1.0      # mm3, a pair may not gain more than this over its own starting overlap (assumed tolerance)


@dataclass
class Check:
    id: str
    step: int
    what: str
    run: Callable[[], tuple[bool, str, str]]
    needs_data: str | None = None


def _case(meshes) -> Case:
    return Case(meshes, name="golden-b")


def _moves_toward(case: Case, i: int, j: int, total: float, per: float = 0.25) -> list[dict]:
    """Stages that move crown i straight toward crown j's centroid by `total` mm, `per` mm at a time."""
    d = case.pos0[j] - case.pos0[i]
    d[2] = 0.0
    u = d / np.linalg.norm(d)
    n = math.ceil(total / per - 1e-9)
    return [{**{k: np.zeros(3) for k in case.ids}, i: u * min(total, per * (s + 1))} for s in range(n)]


# ------------------------------------------------------------------------------------------ step 2: measurement
def width_check(family: str, kind: str):
    def run():
        meshes, t = S.build_arch(family, crowding=0.0, kind=kind)
        c = _case(meshes)
        err = {i: c.mesiodistal_width(i) - t.widths[i] for i in c.ids}
        worst = max(err, key=lambda i: abs(err[i]))
        return abs(err[worst]) <= TOL_WIDTH, f"max |err| {abs(err[worst]):.2f} mm (tooth {worst})", f"≤ {TOL_WIDTH}"
    return run


def crowding_check(family: str, deficit: float, kind: str = "box"):
    def run():
        meshes, t = S.build_arch(family, crowding=deficit, kind=kind)
        got = planner.crowding_mm(_case(meshes))
        return abs(got - t.crowding) <= TOL_CROWD, f"{got:.2f}", f"{t.crowding:.2f} ± {TOL_CROWD}"
    return run


def layout_check(family: str, deficit: float):
    """The same deficit laid out differently (no zigzag, a quarter, the default half, the opposite phase) is the same
    crowding. This replaces an earlier sweep over the arch-fit degree 2–6: the core now fixes its fit (a parametric
    quintic with pinned end crowns), so the degree is no longer a free choice — and a pinned quadratic cannot follow a
    U at all — while the thing the sweep was after, an arch length that does not follow the crowns' zigzag, is what
    this check measures directly."""
    def run():
        vals = [planner.crowding_mm(_case(S.build_arch(family, crowding=deficit, bulge=b)[0]))
                for b in (0.0, deficit / 4, deficit / 2, -deficit / 2)]
        spread = max(vals) - min(vals)
        return spread <= TOL_CROWD, f"spread {spread:.2f} mm {np.round(vals, 1).tolist()}", f"≤ {TOL_CROWD}"
    return run


def rigid_check():
    def run():
        meshes, _ = S.build_arch("catenary", crowding=4.0)
        a = planner.crowding_mm(_case(meshes))
        b = planner.crowding_mm(_case(S.rigid(meshes, 37.0, (12.0, -5.0, 3.0))))
        return abs(a - b) <= TOL_INV, f"{a:.2f} → {b:.2f}", f"Δ ≤ {TOL_INV}"
    return run


def remesh_check():
    def run():
        meshes, _ = S.build_arch("catenary", crowding=0.0, kind="template")
        a, b = _case(meshes), _case(S.remesh(meshes))
        d = max(abs(a.mesiodistal_width(i) - b.mesiodistal_width(i)) for i in a.ids)
        return d <= TOL_INV, f"max Δwidth {d:.2f} mm", f"≤ {TOL_INV}"
    return run


def spin_width_check(i: int, deg: float, kind: str):
    def run():
        meshes, t = S.build_arch("catenary", crowding=0.0, kind=kind)
        c = _case(S.spin_tooth(meshes, i, deg))
        got = c.mesiodistal_width(i)
        return abs(got - t.widths[i]) <= TOL_WIDTH, f"{got:.2f}", f"{t.widths[i]:.2f} ± {TOL_WIDTH}"
    return run


# ------------------------------------------------------------------------------------------ step 1: correctness
def expansion_check(family: str, e: float = 2.0):
    """Geometric arch-length gain of an outward offset e between the same end normals (planner reports 0.8 of it)."""
    def run():
        meshes, t = S.build_arch(family, crowding=4.0)
        c = _case(meshes)
        _, g = planner._expansion_for(c.arch, 1e9)          # forces the maximum offset
        raw = g / 0.8
        s0, s1 = t.s_center[2] - S.WIDTHS[2] / 2, t.s_center[15] + S.WIDTHS[15] / 2
        truth = t.curve.offset_length(e, s0, s1) - (s1 - s0)
        return abs(raw - truth) <= TOL_EXP, f"{raw:.2f}", f"{truth:.2f} ± {TOL_EXP}"
    return run


def expansion_margin_check():
    def run():
        meshes, _ = S.build_arch("ellipse", crowding=4.0)
        c = _case(meshes)
        cent = np.array([c.pos0[i] for i in c.ids])
        gains = [planner._expansion_for(Arch(cent, margin=m), 1e9)[1] for m in (0.0, 8.0, 12.0)]
        spread = max(gains) - min(gains)
        return spread <= TOL_INV, f"spread {spread:.2f} mm {np.round(gains, 2).tolist()}", f"≤ {TOL_INV}"
    return run


def push_check(deficit: float, i: int, j: int, total: float):
    """Move crown i into crown j: the new overlap must be reported, whatever other pairs start with."""
    def run():
        meshes, _ = S.build_arch("catenary", crowding=deficit)
        c = _case(meshes)
        stages = _moves_toward(c, i, j, total)
        final = c._overlap(i, j, stages[-1][i], np.zeros(3))
        base = c._overlap(i, j, np.zeros(3), np.zeros(3))
        flagged = any(v["type"] == "collision" and set(v.get("teeth", [])) == {i, j} for v in planner.validate(c, stages))
        should = final - base > NEW_OVERLAP
        return flagged == should, f"flagged={flagged} (Δoverlap {final - base:.1f} mm³)", f"flagged={should}"
    return run


def extraction_neighbor_check():
    """After removing 5, crowns 4 and 6 become neighbours: pushing 4 into 6 must be reported."""
    def run():
        meshes, _ = S.build_arch("catenary", crowding=0.0)
        c = _case(meshes)
        stages = [{k: v for k, v in st.items() if k != 5} for st in _moves_toward(c, 4, 6, 9.0)]
        final = c._overlap(4, 6, stages[-1][4], np.zeros(3))
        flagged = any(v["type"] == "collision" and set(v.get("teeth", [])) == {4, 6} for v in planner.validate(c, stages))
        return flagged, f"flagged={flagged} (overlap {final:.1f} mm³)", "flagged=True"
    return run


def staging_check():
    def run():
        meshes, _ = S.build_arch("catenary", crowding=0.0)
        c = _case(meshes)
        d = np.array([1.3, -0.4, 0.0])
        stages, info = planner.plan_stages(c, {**{k: np.zeros(3) for k in c.ids}, 8: d})
        n = math.ceil(np.linalg.norm(d) / 0.25)
        steps = [np.linalg.norm(stages[k][8] - (stages[k - 1][8] if k else 0)) for k in range(len(stages))]
        ok = info["n_stages"] == n and max(steps) <= 0.25 + 1e-9 and np.allclose(stages[-1][8], d)
        return ok, f"{info['n_stages']} stages, max step {max(steps):.3f}", f"{n} stages, ≤ 0.25"
    return run


# ------------------------------------------------------------------------------------------ step 5: rotation / vertical
def correction_check(yaw: dict | None = None, dz: dict | None = None):
    """A crown rotated about its long axis or out of level must be moved back (derotated / levelled) in the target,
    staged within 2°/0.25 mm per aligner, and nothing else may be rotated or lifted. (Before step 5 this check only
    asked for a flag; translation-only plans passed silently.)"""
    def run():
        meshes, _ = S.build_arch("catenary", crowding=0.0, kind="template", yaw=yaw, dz=dz)
        c = _case(meshes)
        target, _ = planner.propose_target(c, "expansion")
        want_rot = {i: -a for i, a in (yaw or {}).items()}
        want_z = {i: -v for i, v in (dz or {}).items()}
        rot = {i: getattr(target, "yaw", {}).get(i, 0.0) for i in c.ids}
        lift = {i: float(target[i][2]) for i in c.ids if target[i] is not None}
        bad = [f"{i}: rot {rot[i]:+.1f}°" for i in c.ids if abs(rot[i] - want_rot.get(i, 0.0)) > TOL_YAW]
        bad += [f"{i}: z {lift[i]:+.2f}" for i in lift if abs(lift[i] - want_z.get(i, 0.0)) > TOL_Z]
        stages, _ = planner.plan_stages(c, target)
        limits = [v for v in planner.validate(c, stages) if v["type"] in ("rotation_limit", "move_limit")]
        final = stages[-1]
        ends = all(abs(getattr(final, "yaw", {}).get(i, 0.0) - rot[i]) < 1e-6 for i in c.ids)
        ok = not bad and not limits and ends
        got = "; ".join(bad) or ("limit violated" if limits else "corrected" if ends else "stages do not reach the target")
        return ok, got, f"rot {want_rot or 0}, z {want_z or 0} (±{TOL_YAW}°, ±{TOL_Z} mm), others unchanged"
    return run


# ------------------------------------------------------------------------------------------ real-scan regressions
def real_push_check():
    def run():
        c = Case.from_dir(POSEIDON / "poseidon-999983")
        stages = _moves_toward(c, 2, 3, 0.75)
        base = c._overlap(2, 3, np.zeros(3), np.zeros(3))
        final = c._overlap(2, 3, stages[-1][2], np.zeros(3))
        flagged = any(v["type"] == "collision" and set(v.get("teeth", [])) == {2, 3} for v in planner.validate(c, stages))
        should = final - base > NEW_OVERLAP
        return flagged == should, f"flagged={flagged} (Δoverlap {final - base:.1f} mm³)", f"flagged={should}"
    return run


def real_extraction_check():
    def run():
        c = Case.from_dir(POSEIDON / "poseidon-000001")
        stages = [{k: v for k, v in st.items() if k not in (5, 12)} for st in _moves_toward(c, 4, 6, float(np.linalg.norm((c.pos0[6] - c.pos0[4])[:2])))]
        final = c._overlap(4, 6, stages[-1][4], np.zeros(3))
        flagged = any(v["type"] == "collision" and set(v.get("teeth", [])) == {4, 6} for v in planner.validate(c, stages))
        return flagged, f"flagged={flagged} (overlap {final:.1f} mm³)", "flagged=True"
    return run


def real_expansion_margin_check():
    def run():
        c = Case.from_dir(POSEIDON / "poseidon-000037")
        cent = np.array([c.pos0[i] for i in c.ids])
        gains = [planner._expansion_for(Arch(cent, margin=m), 1e9)[1] for m in (0.0, 8.0, 12.0)]
        spread = max(gains) - min(gains)
        return spread <= TOL_INV, f"spread {spread:.2f} mm {np.round(gains, 2).tolist()}", f"≤ {TOL_INV}"
    return run


CHECKS: list[Check] = [
    # step 2 — measurement
    *[Check(f"B-width-{f}-{k}", 2, f"MD width, aligned {f} arch, {k} crowns", width_check(f, k))
      for f in ("parabola", "catenary", "ellipse", "skewed") for k in ("box", "template")],
    *[Check(f"B-crowd-{f}-{d:g}", 2, f"crowding {d:g} mm, {f} arch", crowding_check(f, d))
      for f in ("parabola", "catenary", "ellipse", "skewed") for d in (0.0, 2.0, 5.0, 9.0)],
    Check("B-crowd-template-5", 2, "crowding 5 mm, real crown shapes", crowding_check("catenary", 5.0, "template")),
    *[Check(f"B-layout-{f}-{d:g}", 2, f"crowding {d:g} mm unchanged by how the crowns zigzag, {f}", layout_check(f, d))
      for f in ("catenary", "skewed") for d in (5.0, 9.0)],
    Check("B-inv-rigid", 2, "crowding unchanged by whole-case rotation/translation", rigid_check()),
    Check("B-inv-remesh", 2, "widths unchanged by finer triangulation", remesh_check()),
    *[Check(f"B-spin-{i}-{a:g}-{k}", 2, f"width of tooth {i} after {a:g}° spin about its own axis ({k})", spin_width_check(i, a, k))
      for i, a, k in ((3, 1, "template"), (3, 10, "template"), (8, 15, "template"), (3, 10, "box"))],
    # step 1 — correctness
    *[Check(f"B-exp-{f}", 1, f"expansion gain = geometric offset length, {f}", expansion_check(f))
      for f in ("parabola", "catenary", "ellipse")],
    Check("B-exp-margin", 1, "expansion gain independent of the fit's extrapolation margin", expansion_margin_check()),
    Check("B-push-aligned", 1, "push 8 into 9 by 0.75 mm, aligned arch", push_check(0.0, 8, 9, 0.75)),
    Check("B-push-crowded", 1, "push 2 into 3 by 0.75 mm while other pairs start overlapped", push_check(6.0, 2, 3, 0.75)),
    Check("B-extraction-neighbour", 1, "after removing 5, pushing 4 into 6 is reported", extraction_neighbor_check()),
    Check("B-staging", 1, "straight move split into ≤ 0.25 mm stages, exact end", staging_check()),
    # step 5 — rotation / vertical correction
    Check("B-rot-8-20", 5, "incisor rotated 20° is derotated, nothing else turns", correction_check(yaw={8: 20.0})),
    Check("B-rot-3-12", 5, "molar rotated -12° is derotated, nothing else turns", correction_check(yaw={3: -12.0})),
    Check("B-level-6", 5, "canine 1.5 mm short of the occlusal level is levelled", correction_check(dz={6: -1.5})),
    Check("B-level-9", 5, "incisor 1.2 mm past the occlusal level is levelled", correction_check(dz={9: 1.2})),
    # review regressions on real scans (local data)
    Check("R-push-999983", 1, "real scan: push 2 into 3 by 0.75 mm", real_push_check(), "poseidon-999983"),
    Check("R-extraction-000001", 1, "real scan: extract 5·12, move 4 onto 6", real_extraction_check(), "poseidon-000001"),
    Check("R-exp-margin-000037", 1, "real scan: expansion gain independent of margin", real_expansion_margin_check(), "poseidon-000037"),
]


def run_all(only_step: int | None = None) -> list[tuple[Check, bool | None, str, str]]:
    rows = []
    for ck in CHECKS:
        if only_step is not None and ck.step != only_step:
            continue
        if ck.needs_data and not (POSEIDON / ck.needs_data).exists():
            rows.append((ck, None, "skipped (no local data)", ""))
            continue
        try:
            ok, got, want = ck.run()
        except Exception as e:  # a crash is a failure, not a pass
            ok, got, want = False, f"error: {type(e).__name__}: {e}", ""
        rows.append((ck, ok, got, want))
    return rows


def main() -> int:
    rows = run_all()
    print("| check | step | what | result | measured | expected |\n|---|---|---|---|---|---|")
    for ck, ok, got, want in rows:
        mark = "–" if ok is None else ("✅" if ok else "❌")
        print(f"| {ck.id} | {ck.step} | {ck.what} | {mark} | {got} | {want} |")
    done = [r for r in rows if r[1] is not None]
    print(f"\npass {sum(1 for r in done if r[1])}/{len(done)} · skipped {len(rows) - len(done)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
