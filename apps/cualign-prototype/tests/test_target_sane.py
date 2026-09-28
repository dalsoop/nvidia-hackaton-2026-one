"""The target arrangement stays a plausible arch (Poseidon 000001, 2026-09-28, #197 diagnosis ③): 11 turned −25° beside
21 at 0° — a width axis the crown outline could not decide — and the premolars stood 1–3.2 mm buccal of where they were
against 0.6 mm of molar expansion, a 4.7 mm step from the canine to the first premolar."""
import numpy as np
import pytest

from cualign.core import planner, samples
from cualign.core.case import Case
from cualign.core.limits import ARCH_STEP_MAX_MM, PREMOLAR_BUCCAL_EXTRA_MM, ROTATION_MAX_DEG


def test_rotations_are_bounded():
    yaw = {8: -25.3, 7: 30.0, 10: -7.3}
    planner._bound_rotations(yaw)
    assert yaw == {8: -ROTATION_MAX_DEG, 7: ROTATION_MAX_DEG, 10: -7.3}


def _sample(cid):
    s = samples.get(cid)
    if s is None or not s.available:
        pytest.skip(f"{cid} not installed")
    return Case.from_dir(s.folder)


def test_000001_incisor_rotation_and_premolars():
    case = _sample("poseidon-000001")
    assert case.crown_yaw(8) == 0.0            # 11: the outline narrows both ways from the tangent (was +24.3°)
    assert case.crown_yaw(9) == 0.0
    target, info = planner.propose_target(case, "expansion_ipr", ipr_surfaces=[[a, a + 1, 0.4] for a in range(4, 13)])[:2]
    assert abs(target.yaw.get(8, 0.0)) < planner.ROTATION_MIN_DEG
    span = planner._span_model(case)
    ex = np.array([span.axis[1], -span.axis[0]])

    def away(i):
        return abs(float((case.anchor[i][:2] + target[i][:2] - span.mid[:2]) @ ex))

    for canine, pm in ((6, 5), (11, 12)):
        assert away(pm) - away(canine) <= ARCH_STEP_MAX_MM + 0.01
    off = info["expansion_mm_per_side"]
    for i in (4, 5, 12, 13):
        n = case.arch.normal(case.arch.s_of(case.anchor[i]))
        assert float(target[i][:2] @ n) <= off + PREMOLAR_BUCCAL_EXTRA_MM + 0.3   # the span arch's normal, not the case's


def test_a_real_rotation_is_still_read():
    case = _sample("poseidon-000131")
    assert case.crown_yaw(7) == pytest.approx(15.8, abs=0.3)      # 12: narrows on one side only
