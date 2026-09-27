"""The first-molar-anchored layout (#59) under the conditions the PR #63 review found broken: locked teeth, missing
molars, extraction spaces, IPR scope, and the width cache. Synthetic cases only (no data)."""
import numpy as np
import pytest
from scipy.spatial import cKDTree

from cualign.core import Case, planner
from cualign.core.arch import Arch
from cualign.core.planner import plan_stages, propose_target, validate, yaw_of


@pytest.fixture(scope="module")
def moderate():
    return Case.synthetic("moderate")


def _collisions(case, target):
    stages, _ = plan_stages(case, target)
    return [v for v in validate(case, stages) if v["type"] == "collision"]


def test_locking_one_tooth_keeps_the_anchored_plan(moderate):
    # before: any lock fell back to the whole-arch chain at contact widths (33 collisions, 2 and 15 moved 3.7 mm)
    target, _ = propose_target(moderate, "expansion_ipr", lock={13})
    assert np.allclose(target[13], 0)
    assert not _collisions(moderate, target)


def test_locked_first_molar_holds_its_block(moderate):
    target, _ = propose_target(moderate, "expansion_ipr", lock={3, 14})
    for i in (2, 3, 14, 15):
        assert np.allclose(target[i], 0), i


def test_end_tooth_is_not_taken_for_a_displaced_one(moderate):
    # before: without 2 and 3, tooth 4 read as standing out of the arch and the crowding jumped 4.5 -> 15.4 mm
    without = Case({i: m for i, m in moderate.mesh.items() if i not in (2, 3)}, name="no-left-molars")
    assert 4 not in planner._span_model(without).out
    assert abs(planner.crowding_mm(without) - planner.crowding_mm(moderate)) < 1.5


def test_extraction_closes_its_spaces(moderate):
    target, info = propose_target(moderate, "extraction", extraction=(5, 12))
    A = moderate.placed(4, target[4], yaw_of(target, 4), hull=True)
    B = moderate.placed(6, target[6], yaw_of(target, 6), hull=True)
    gap = float(cKDTree(B.vertices).query(A.vertices)[0].min())
    assert gap < 1.6, gap          # before: 3.7 mm left open next to the extracted premolar
    assert not _collisions(moderate, target)


def test_ipr_counts_inside_the_span_only(moderate):
    _, info = propose_target(moderate, "ipr")
    assert info["ipr_applied_teeth"] == list(range(4, 14))
    assert info["space_gain_mm"] == pytest.approx(10 * planner.IPR_PER_SURFACE)
    _, info = propose_target(moderate, "ipr", ipr_exclude=set(range(3, 15)), lock={3, 14})
    assert info["space_gain_mm"] == 0 and info["ipr_applied_teeth"] == []


def test_shape_room_stops_when_the_span_cannot_fit():
    c = Case.synthetic("severe")
    _, info = propose_target(c, "ipr")
    assert info["shape_room_mm"] <= 2 * planner.SHAPE_STEP_MM * 14


def test_contact_width_cache_does_not_outlive_its_arch(moderate):
    pts = np.array([moderate.anchor[i] for i in moderate.ids])
    a = Arch(pts, degree=2)
    w2 = moderate.contact_width(7, a)
    del a
    b = Arch(pts, degree=3)
    assert moderate.contact_width(7, b) == pytest.approx(Case.synthetic("moderate").contact_width(7, Arch(pts, degree=3)))
    assert w2 > 0
