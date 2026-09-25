"""Golden set B: first the ground truth itself, then the core against it.

The generator (evals/golden_b/shapes.py) must be right before its answers can judge the core, so its
construction is checked here with numbers that do not go through the core. Core checks that fail today are
listed in KNOWN_FAIL with the plan step that should fix them; strict xfail makes a fixed check fail loudly until
it is removed from the list.
"""
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


def test_generator_does_not_import_the_core():
    src = Path(S.__file__).read_text()
    assert "cualign" not in src.split('"""', 2)[2].split("TEMPLATES")[0]    # no core import above the data paths
    assert "import cualign" not in src and "from cualign" not in src


# ----------------------------------------------------------------------------------------- the core
KNOWN_FAIL = {
    # step 5 limit, found while adding the rotation checks: a near-square molar outline changes its extent by < 0.1 mm
    # over ±10°, so the width axis (and with it the rotation) stays on the arch tangent — a 12° molar rotation reads 0°.
    # Needs a shape feature (e.g. the buccal surface line), not the outline extent.
    "B-rot-3-12",
}


@pytest.mark.parametrize("ck", C.CHECKS, ids=lambda c: c.id)
def test_core(ck):
    if ck.needs_data and not (C.POSEIDON / ck.needs_data).exists():
        pytest.skip(f"local data {ck.needs_data} not present")
    ok, got, want = ck.run()
    if ck.id in KNOWN_FAIL:
        if ok:
            pytest.fail(f"{ck.id} now passes ({got}); remove it from KNOWN_FAIL")
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


def test_checks_catch_an_arch_that_follows_the_zigzag(monkeypatch):
    from cualign.core import case as case_mod
    real = case_mod.Arch
    monkeypatch.setattr(case_mod, "Arch", lambda P, **k: real(P, degree=len(P) - 1))   # interpolates every crown
    assert not _by_id("B-layout-catenary-5").run()[0]


def test_checks_catch_a_translation_only_core(monkeypatch):
    monkeypatch.setattr(C.planner, "_corrections", lambda case, active, lock: ({}, {}))
    assert not _by_id("B-rot-8-20").run()[0]
    assert not _by_id("B-level-6").run()[0]
