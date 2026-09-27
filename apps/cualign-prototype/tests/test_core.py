"""Smoke tests for the planning core. No network, no API key, no external data."""
import numpy as np
import pytest

from cualign.core import Case, compare_strategies, plan_stages, propose_target, validate
from cualign.core.constraints import Constraints
from cualign.core.limits import MAX_LINEAR_PER_ALIGNER, STRATEGIES, stage_cap_from_months
from cualign.core.synth import PRESETS


@pytest.fixture(scope="module")
def moderate():
    return Case.synthetic("moderate")


def test_presets_load_and_crowding_is_monotonic():
    from cualign.core.planner import crowding_mm
    crowd = [crowding_mm(Case.synthetic(p)) for p in ["aligned", "mild", "moderate", "severe", "extraction"]]
    assert all(b > a for a, b in zip(crowd, crowd[1:])), crowd
    assert crowd[0] < 1.0


def test_collision_engine_is_live():
    """The boolean engine must return positive volume for overlapping hulls (guards the silent-zero fallback)."""
    c = Case.synthetic("severe")
    assert sum(c.baseline.values()) > 0
    a, b = c.ids[6], c.ids[7]
    assert c._overlap(a, b, np.zeros(3), np.zeros(3)) >= 0
    pushed = c._overlap(a, b, np.array([1.5, 0, 0]), np.array([-1.5, 0, 0]))
    assert pushed > c.baseline[(a, b)]


def test_stage_step_never_exceeds_limit(moderate):
    for s in STRATEGIES:
        target, _ = propose_target(moderate, s, extraction=(5, 12) if s == "extraction" else ())
        stages, _ = plan_stages(moderate, target)
        viol = validate(moderate, stages)
        assert not [v for v in viol if v["type"] == "move_limit"]
        for si in range(1, len(stages)):
            for i, v in stages[si].items():
                assert np.linalg.norm(v - stages[si - 1][i]) <= MAX_LINEAR_PER_ALIGNER + 1e-6


def test_strategy_ladder_on_moderate_case(moderate):
    rows = {r["strategy"]: r for r in compare_strategies(moderate)}
    assert "extraction" not in rows              # no prescribed teeth: the app does not plan an extraction (#56)
    assert not rows["expansion"]["passed"] and "space_deficit" in rows["expansion"]["by_type"]
    assert not rows["ipr"]["passed"]
    assert rows["expansion_ipr"]["passed"]
    ext = compare_strategies(moderate, constraints=Constraints(extraction=(5, 12)))
    assert [r["strategy"] for r in ext] == ["extraction"]           # prescribed: only the extraction plan
    assert ext[0]["passed"] and ext[0]["removed"] == [5, 12]


def test_extraction_forbidden_on_severe_fails_honestly():
    c = Case.synthetic("severe")
    rows = compare_strategies(c, allowed=["expansion", "ipr", "expansion_ipr"])
    assert all(not r["passed"] for r in rows)
    assert min(r["_info"]["space_deficit_mm"] for r in rows) > 0.5


def test_stage_cap_violation():
    c = Case.synthetic("extraction")
    target, info = propose_target(c, "extraction", extraction=(5, 12))
    stages, _ = plan_stages(c, target, order="sequential")
    viol = validate(c, stages, stage_cap=stage_cap_from_months(3))
    assert any(v["type"] == "stage_cap" for v in viol)


def test_lock_and_ipr_exclude(moderate):
    target, info = propose_target(moderate, "ipr", ipr_exclude={7, 8, 9, 10}, lock={3, 14})
    assert np.allclose(target[3], 0) and np.allclose(target[14], 0)
    assert "제외 [7, 8, 9, 10]" in info["notes"][0]


def test_orders_change_stage_count(moderate):
    target, _ = propose_target(moderate, "expansion_ipr")
    n = {o: plan_stages(moderate, target, order=o)[1]["n_stages"] for o in ["simultaneous", "anterior_first", "sequential"]}
    assert n["simultaneous"] < n["anterior_first"] < n["sequential"]


def test_export_zip(tmp_path, moderate):
    from cualign.core.planner import export_zip
    import zipfile
    target, _ = propose_target(moderate, "expansion_ipr")
    stages, _ = plan_stages(moderate, target)
    z = export_zip(moderate, stages, str(tmp_path / "p.zip"))
    names = zipfile.ZipFile(z).namelist()
    assert len(names) == len(stages) * len(moderate.ids)
    assert names[0].startswith("stage_01/")


def test_all_presets_exist():
    assert set(PRESETS) == {"aligned", "mild", "moderate", "severe", "extraction"}
