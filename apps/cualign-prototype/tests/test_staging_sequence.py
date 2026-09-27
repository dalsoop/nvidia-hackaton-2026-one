"""Staging with sequencing (2026-09-28): crowns that would clip on the way wait for their neighbour."""
import numpy as np

from cualign.core import Case, planner
from cualign.core.limits import MAX_LINEAR_PER_ALIGNER, MAX_ROTATION_PER_ALIGNER
from cualign.core.store import Store


def test_stages_end_at_the_target_within_the_limits_and_report_the_boundary():
    c = Case.synthetic("moderate")
    target, _ = planner.propose_target(c, "expansion_ipr")
    stages, info = planner.plan_stages(c, target)
    assert info["n_stages"] == len(stages) and set(info) >= {"phase_boundary", "delays", "per_stage_mm", "stages_per_group"}
    for i, v in target.items():
        assert np.allclose(stages[-1][i], v) and planner.yaw_of(stages[-1], i) == planner.yaw_of(target, i)
    for k, st in enumerate(stages):
        prev = stages[k - 1] if k else {}
        for i in st:
            assert np.linalg.norm(st[i] - prev.get(i, np.zeros(3))) <= MAX_LINEAR_PER_ALIGNER + 1e-6
            assert abs(planner.yaw_of(st, i) - planner.yaw_of(prev, i)) <= MAX_ROTATION_PER_ALIGNER + 1e-6
    assert info["per_stage_mm"] <= MAX_LINEAR_PER_ALIGNER + 1e-6
    # nothing delayed: everybody starts at aligner 1 and the boundary is 0
    if not info["delays"]:
        assert info["phase_boundary"] == 0


def test_the_extraction_sample_closes_every_contact_without_path_room_or_collisions():
    st = Store()
    cid, case = st.load_case("poseidon-000097")
    rows = planner.compare_strategies(case, constraints=st.constraints_for(cid))
    r = rows[0]
    assert r["passed"], r["by_type"]
    info, sinfo = r["_info"], r["_sinfo"]
    assert info["shape_room_mm"] <= 0.5                                  # no path room left in the target
    assert sinfo["delays"] and sinfo["phase_boundary"] >= 1               # the blocked-out canine waits
    assert all(1 <= s < sinfo["n_stages"] for s in sinfo["delays"].values())
    stages = r["_stages"]
    for i, s0 in sinfo["delays"].items():        # a delayed crown holds until its first aligner
        assert np.allclose(stages[s0 - 2][i], 0) if s0 >= 2 else True


def test_a_lone_move_is_not_sequenced():
    c = Case.synthetic("aligned")
    target = {i: np.zeros(3) for i in c.ids}
    target[8] = np.array([0.0, 0.6, 0.0])
    stages, info = planner.plan_stages(c, target)
    assert info["n_stages"] == 3 and info["phase_boundary"] == 0 and info["delays"] == {}
