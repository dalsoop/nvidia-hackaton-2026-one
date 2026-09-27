"""Golden set B: first the ground truth itself, then the core against it.

The generator (evals/golden_b/shapes.py) must be right before its answers can judge the core, so its
construction is checked here with numbers that do not go through the core. Core checks that fail today are
listed in KNOWN_FAIL with the plan step that should fix them; strict xfail makes a fixed check fail loudly until
it is removed from the list.
"""
import re
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.golden_b import checks as C  # noqa: E402
from evals.golden_b import shapes as S  # noqa: E402

# ----------------------------------------------------------------------------------------- the ground truth
@pytest.mark.parametrize("family", ["parabola", "catenary", "ellipse", "skewed"])
@pytest.mark.parametrize("kind", ["box", "ellipsoid", "template"])
def test_generator_widths_along_own_axis(family, kind):
    meshes, t = S.build_arch(family, crowding=3.0, kind=kind)
    for i, m in meshes.items():
        _, tan, _ = t.curve.at(t.s_center[i])
        proj = m.vertices[:, :2] @ tan
        assert abs(np.ptp(proj) - S.WIDTHS[i]) < 1e-6, (family, kind, i)


@pytest.mark.parametrize("family", ["parabola", "catenary", "ellipse", "skewed"])
@pytest.mark.parametrize("deficit", [0.0, 5.0])
def test_generator_arch_length_and_deficit(family, deficit):
    meshes, t = S.build_arch(family, crowding=deficit)
    assert abs(t.curve.length - t.arch_length) < 1e-6
    assert abs(sum(t.widths.values()) - t.arch_length - t.crowding) < 1e-9
    # end crowns keep their distal contacts at the arch ends
    assert abs(t.s_center[2] - S.WIDTHS[2] / 2) < 1e-9 and abs(t.s_center[15] + S.WIDTHS[15] / 2 - t.arch_length) < 1e-9
    if deficit == 0:
        ids = S.UPPER
        for a, b in zip(ids, ids[1:]):
            assert abs(t.s_center[b] - t.s_center[a] - (S.WIDTHS[a] + S.WIDTHS[b]) / 2 - 0.05) < 1e-9


def test_generator_offset_length_matches_circle():
    cv = S.Curve("circle")
    phi, R, e = np.pi, 25.0, 2.0
    assert abs(cv.length - R * phi) < 1e-3
    assert abs(cv.offset_length(e, 0.0, cv.length) - (R + e) * phi) < 1e-2


def test_generator_vertical_and_yaw_are_applied():
    base, _ = S.build_arch("catenary", kind="box")
    moved, _ = S.build_arch("catenary", kind="box", dz={6: -1.5}, yaw={8: 20.0})
    assert abs(moved[6].bounds[1][2] - base[6].bounds[1][2] + 1.5) < 1e-9
    assert not np.allclose(moved[8].vertices, base[8].vertices)


@pytest.mark.parametrize("family", ["parabola", "catenary", "ellipse", "skewed"])
@pytest.mark.parametrize("blocked", [(6, 11), (4, 13), (8,)])
def test_generator_crowded_arch_truth(family, blocked):
    meshes, t = S.build_crowded_arch(family, deficit=4.0, blocked=blocked)
    aligned, t0 = S.build_crowded_arch(family, deficit=0.0)
    # same crowns, the arch shorter by exactly the deficit
    assert abs(t0.span_crowding - t.span_crowding + 4.0) < 1e-6
    assert abs(t0.arch_length - t.arch_length - 4.0) < 1e-6
    for i in S.UPPER:
        mid = t.curve.at(t.s_center[i])[0]
        c = meshes[i].bounds.mean(0)[:2]
        off = float(np.linalg.norm(c - mid))
        if i in blocked:
            assert off > 3.0, (i, off)            # stands out of the arch
        else:
            assert off < 1.0, (i, off)            # on it


def test_generator_contact_width_of_a_box_is_its_width():
    assert all(abs(S.contact_width(i, "box") - S.WIDTHS[i]) < 1e-6 for i in S.UPPER)


def test_generator_does_not_import_the_core():
    src = Path(S.__file__).read_text()
    assert "cualign" not in src.split('"""', 2)[2].split("TEMPLATES")[0]    # no core import above the data paths
    assert "import cualign" not in src and "from cualign" not in src


# ----------------------------------------------------------------------------------------- the core
def _num(got: str) -> float:
    return float(re.search(r"-?\d+\.\d+", got).group())


# id -> how it is allowed to fail: a known failure that fails some other way (a new cause, or worse than documented)
# is a failure of the test.
KNOWN_FAIL = {
    # step 5 limit, found while adding the rotation checks: a near-square molar outline changes its extent by < 0.1 mm
    # over ±10°, so the width axis (and with it the rotation) stays on the arch tangent — a 12° molar rotation reads 0°.
    # Needs a shape feature (e.g. the buccal surface line), not the outline extent.
    "B-rot-3-12": lambda got: got.startswith("3: rot"),
    # step 2 limit (#59): with canines or first premolars blocked out on a tapered arch, the arch refitted through
    # the teeth in line cuts the corner where they stood, so the available length reads short (ellipse at 5 mm:
    # -1.5 mm of length, widths within 0.2 mm) and crowding reads high by 1.3–2.2 mm. It errs toward more space needed.
    "B-crowd-parabola-9": lambda got: _num(got) <= 8.5 + 1.5,
    "B-crowd-ellipse-2": lambda got: _num(got) <= 1.5 + 1.6,
    "B-crowd-ellipse-5": lambda got: _num(got) <= 4.5 + 2.0,
    "B-crowd-ellipse-9": lambda got: _num(got) <= 8.5 + 2.5,
    "B-layout-parabola-5": lambda got: _num(got) <= 1.6,
    "B-layout-parabola-9": lambda got: _num(got) <= 1.6,
    # step 2 limit: a tooth under DISPLACED_MM out of the arch still counts in the fit and bends it; past it, it is left
    # out. On the parabola the measure steps by 1.4 mm across 3 → 3.5 mm (catenary 0.6 mm).
    "B-out-step-parabola": lambda got: _num(got) <= 1.5,
    # collision validator (#61): the target is clear, but on the way 7 slides past 6's corner (+1.0–1.8 mm³ in the
    # middle stages, straight-line staging) and IPR is not cut from the meshes, so the plan fails on small collisions
    # although the space is there. Only that: a space deficit or another pair is a new failure.
    "D-plan-000001": lambda got: re.fullmatch(r"fail: 최선 \w+: collision \d+건, 가장 큰 충돌 \[6, 7\] 단계 \d+ \(\+1\.\d+mm³\)",
                                                got) is not None,
}


@pytest.mark.parametrize("ck", C.CHECKS, ids=lambda c: c.id)
def test_core(ck):
    if ck.needs_data and not (C.POSEIDON / ck.needs_data).exists():
        pytest.skip(f"local data {ck.needs_data} not present")
    ok, got, want = ck.run()
    if ck.id in KNOWN_FAIL:
        if ok:
            pytest.fail(f"{ck.id} now passes ({got}); remove it from KNOWN_FAIL")
        if not KNOWN_FAIL[ck.id](got):
            pytest.fail(f"{ck.id} fails otherwise than documented: {got} vs {want}")
        pytest.xfail(f"known failure (step {ck.step}): {got} vs {want}")
    assert ok, f"{ck.id}: {got} vs {want}"


# ----------------------------------------------------------------------------------------- the checks bite
def _by_id(i):
    return next(c for c in C.CHECKS if c.id == i)


def test_checks_catch_a_core_that_always_says_no_crowding(monkeypatch):
    monkeypatch.setattr(C.planner, "crowding_mm", lambda case: 0.0)
    assert not _by_id("B-crowd-catenary-2").run()[0]
    assert not _by_id("B-crowd-parabola-2").run()[0]


def test_checks_catch_a_blind_validator(monkeypatch):
    monkeypatch.setattr(C.planner, "validate", lambda *a, **k: [])
    assert not _by_id("B-push-crowded").run()[0]


def test_checks_catch_a_constant_width(monkeypatch):
    monkeypatch.setattr(C.Case, "mesiodistal_width", lambda self, i: 8.0)
    assert not _by_id("B-width-catenary-box").run()[0]
    assert not _by_id("B-spin-3-10-box").run()[0]


def test_checks_catch_wrong_stage_splitting(monkeypatch):
    monkeypatch.setattr(C.planner, "MAX_LINEAR_PER_ALIGNER", 0.5)
    assert not _by_id("B-staging").run()[0]


def test_checks_catch_an_arch_bent_by_teeth_out_of_line(monkeypatch):
    monkeypatch.setattr(C.planner, "_displaced", lambda case, span: set())    # blocked-out teeth stay in the arch fit
    assert not _by_id("B-layout-catenary-5").run()[0]
    assert not _by_id("B-crowd-catenary-5").run()[0]


def test_checks_catch_the_old_crowding_measure(monkeypatch):
    # #59: the measure before it (main a9a8db2) — all crowns' full outline widths against the crown-centre arch
    # between the end crowns' distal surfaces, both molars included
    def old(case):
        w = {i: case.mesiodistal_width(i) for i in case.ids}
        s = sorted(case.arch.s_of(case.anchor[i]) for i in case.ids)
        return round(sum(w.values()) - ((s[-1] - s[0]) + (w[case.ids[0]] + w[case.ids[-1]]) / 2), 1)
    monkeypatch.setattr(C.planner, "crowding_mm", old)
    assert not _by_id("B-crowd-catenary-5").run()[0]


def test_checks_catch_a_translation_only_core(monkeypatch):
    monkeypatch.setattr(C.planner, "_corrections", lambda case, active, lock: ({}, {}))
    assert not _by_id("B-rot-8-20").run()[0]
    assert not _by_id("B-level-6").run()[0]
