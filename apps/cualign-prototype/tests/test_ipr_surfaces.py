"""Per-contact IPR prescription (#57): input, planning, validation, CLI parsing."""
import pytest

from cualign.cli import parse_constraints, parse_ipr_surfaces
from cualign.core import Case, planner
from cualign.core.constraints import ConstraintPatch, Constraints, reason_ko
from cualign.core.store import Store


def test_patch_takes_fdi_and_stores_universal():
    ch = ConstraintPatch(ipr_surfaces=[[11, 21, 0.4], [12, 11, 0.4], [21, 22, 0.4]]).changes()
    assert ch["ipr_surfaces"] == [[8, 9, 0.4], [7, 8, 0.4], [9, 10, 0.4]]
    c = Constraints().patched(ch)
    assert c.ipr_surfaces == ((7, 8, 0.4), (8, 9, 0.4), (9, 10, 0.4))         # sorted, Universal
    assert "IPR 처방 12-11 0.4mm, 11-21 0.4mm, 21-22 0.4mm" in c.describe_ko() and "IPR 제외" not in c.describe_ko()
    assert Constraints().patched(ConstraintPatch(ipr_surfaces=[]).changes()).ipr_surfaces == ()
    assert "IPR 제외 치아 없음 · IPR 한도 면당 0.25mm" in Constraints().describe_ko()      # the uniform rule, as before


@pytest.mark.parametrize("rows, text", [
    ([[11, 21, 0.6]], "접촉면당 최대 0.5mm"),          # cap: 0.25 per tooth surface = 0.5 per contact
    ([[11, 22, 0.4]], "이웃한 두 치아"),
    ([[11, 21, 0.4], [21, 11, 0.3]], "두 번 처방"),
    ([[11, 21, 0.0]], "0보다 커야"),
    ([[31, 41, 0.4]], "not an upper-arch FDI"),
])
def test_bad_prescriptions_are_refused_with_the_reason(rows, text):
    with pytest.raises(ValueError) as e:
        Constraints().patched(ConstraintPatch(ipr_surfaces=rows).changes())
    assert text in reason_ko(e.value)


def test_prescribed_contact_on_an_excluded_tooth_is_refused():
    with pytest.raises(ValueError) as e:
        Constraints(ipr_exclude=(8,), ipr_surfaces=((8, 9, 0.4),))
    assert "IPR 제외 치아에 IPR 이 처방" in reason_ko(e.value) and "11번" in reason_ko(e.value)
    with pytest.raises(ValueError):
        Constraints(ipr_surfaces=((7, 8, 0.4),)).check_case([8, 9, 10, 11, 12, 13])


def test_only_the_prescribed_contacts_are_stripped():
    st = Store()
    _, case = st.load_case("poseidon-000131")
    c = st.constraints_for("poseidon-000131")                        # 11-21, 11-12, 21-22 at 0.4
    target, info = planner.propose_target(case, "ipr", constraints=c)
    assert info["ipr_surfaces"] == [[7, 8, 0.4], [8, 9, 0.4], [9, 10, 0.4]]
    assert info["ipr_applied_teeth"] == [7, 8, 9, 10] and info["ipr_mm_per_surface"] == pytest.approx(0.2)
    assert info["space_gain_mm"] == pytest.approx(1.2, abs=0.01)
    assert any("IPR 처방대로 접촉면 3면 총 1.2mm" in n for n in info["notes"])
    cut = planner.cut_case(case, info)
    assert sorted(cut.ipr_cut) == [7, 8, 9, 10]                        # 13 and 23 (6, 11) untouched
    assert case.contact_width(7) - cut.contact_width(7) == pytest.approx(0.2, abs=0.02)   # one contact: 0.2
    assert case.contact_width(8) - cut.contact_width(8) == pytest.approx(0.4, abs=0.02)   # two contacts
    stages, _ = planner.plan_stages(case, target)
    viol = planner.validate(case, stages, space_deficit_mm=info["space_deficit_mm"], constraints=c, target_info=info)
    assert not [v for v in viol if v["type"] in ("ipr_unprescribed", "ipr_limit", "ipr_excluded")]


def test_a_molar_contact_strips_the_molar_half_and_lengthens_the_span():
    c = Case.synthetic("moderate")
    cons = Constraints(ipr_surfaces=((3, 4, 0.4), (4, 5, 0.4)))
    _, info = planner.propose_target(c, "ipr", constraints=cons)
    assert info["ipr_applied_teeth"] == [3, 4, 5] and info["space_gain_mm"] == pytest.approx(0.8, abs=0.01)
    cut = planner.cut_case(c, info)
    assert c.contact_width(3) - cut.contact_width(3) == pytest.approx(0.2, abs=0.02)


def test_ipr_beyond_the_prescription_is_a_violation():
    st = Store()
    _, case = st.load_case("poseidon-000131")
    c = st.constraints_for("poseidon-000131")
    target, info = planner.propose_target(case, "ipr", constraints=c)
    stages, _ = planner.plan_stages(case, target)
    more = {**info, "ipr_surfaces": info["ipr_surfaces"] + [[6, 7, 0.25]], "ipr_applied_teeth": [6, 7, 8, 9, 10]}
    viol = planner.validate(case, stages, constraints=c, target_info=more)
    bad = [v for v in viol if v["type"] == "ipr_unprescribed"]
    assert bad and bad[0]["surfaces"] == [[6, 7, 0.25]] and bad[0]["teeth"] == [6, 7]
    other = {**info, "ipr_surfaces": [[7, 8, 0.5], [8, 9, 0.4], [9, 10, 0.4]]}
    got = [v["surfaces"] for v in planner.validate(case, stages, constraints=c, target_info=other) if v["type"] == "ipr_unprescribed"]
    assert got == [[[7, 8, 0.5]]]


def test_too_little_prescribed_ipr_fails_with_the_deficit():
    c = Case.synthetic("moderate")                                   # ~4.5 mm crowding
    cons = Constraints(ipr_surfaces=((8, 9, 0.4),))
    rows = planner.compare_strategies(c, allowed=["ipr"], constraints=cons)
    assert not rows[0]["passed"]
    deficit = [v for v in rows[0]["_viol"] if v["type"] == "space_deficit"]
    assert deficit and deficit[0]["mm"] > 3.0


def test_the_uniform_rule_still_applies_without_a_prescription():
    c = Case.synthetic("moderate")
    _, info = planner.propose_target(c, "ipr", ipr_exclude={7, 8, 9, 10})
    assert info["ipr_mm_per_surface"] == 0.25 and 8 not in info["ipr_applied_teeth"]
    assert any("IPR 면당 0.25mm" in n for n in info["notes"])


def test_cli_reads_the_sample_prescriptions():
    from cualign.core import samples
    assert parse_ipr_surfaces(samples.get("poseidon-000131").request) == [[7, 8, 0.4], [8, 9, 0.4], [9, 10, 0.4]]
    assert parse_ipr_surfaces(samples.get("poseidon-000001").request) == [[a, a + 1, 0.4] for a in range(4, 13)]
    assert parse_ipr_surfaces("11-21 사이 0.4mm IPR 로 짜줘") is None       # no 각/총: not read as a prescription
    assert parse_ipr_surfaces("IPR 11-21 각 0.4mm") == [[8, 9, 0.4]]
    assert parse_ipr_surfaces("발치 없이 12개월 안에") is None
    assert parse_constraints("IPR 11-21·11-12 각 0.3mm 로 발치 없이")["ipr_surfaces"] == [[7, 8, 0.3], [8, 9, 0.3]]


def test_a_prescription_plans_the_ipr_strategies_only():
    from cualign.core.limits import STRATEGIES
    cons = Constraints(ipr_surfaces=((8, 9, 0.4),))
    assert planner.strategies_for(STRATEGIES, cons) == ["ipr", "expansion_ipr"]
    with pytest.raises(ValueError):
        planner.strategies_for(["expansion"], cons)
    assert planner.strategies_for(STRATEGIES, Constraints()) == ["expansion", "ipr", "expansion_ipr"]
    rows = planner.compare_strategies(Case.synthetic("mild"), constraints=cons)
    assert [r["strategy"] for r in rows] == ["ipr", "expansion_ipr"]
    assert all(r["_info"]["ipr_surfaces"] == [[8, 9, 0.4]] for r in rows)


def test_the_target_tool_keeps_the_prescription():
    """The agent's propose_target goes through PlanningService.target. Asked for 확장안 under an IPR prescription it made
    an expansion-only target with no IPR (poseidon-000001, 2026-09-28 recording): refused like the comparison's."""
    from cualign.core.service import PlanningService

    class OneCase:
        def require_current_input(self, *a):
            pass

        def load_case(self, cid):
            return cid, Case.synthetic("mild")

        def put_target(self, cid, target, info, constraints):
            return info["strategy"]

    svc, cons = PlanningService(OneCase()), Constraints(ipr_surfaces=((8, 9, 0.4),))
    with pytest.raises(ValueError, match="IPR"):
        svc.target("mild", "expansion", cons)
    with pytest.raises(ValueError, match="발치"):
        svc.target("mild", "ipr", Constraints(extraction=(5, 12)))
    assert svc.target("mild", "expansion_ipr", cons) == "expansion_ipr"
    assert svc.target("mild", "expansion", Constraints()) == "expansion"


def test_ipr_amounts_split_a_contact_per_face_and_stay_out_of_the_dump_when_empty():
    """직접 이동's right-click IPR (ipr_amounts): (tooth, neighbour, mm off that face), the contact the sum of its faces.
    Without it the conditions dump, validate and patch exactly as before (saved plans, golden sets, plan_context)."""
    old = Constraints(extraction=(5, 12), ipr_surfaces=((7, 8, 0.4),))
    assert "ipr_amounts" not in old.model_dump() and "ipr_amounts" not in old.model_dump(mode="json")
    assert Constraints.model_validate(old.model_dump(exclude={"allow_extraction"})) == old
    assert old.face_amounts() == {(7, 8): 0.2, (8, 7): 0.2}                    # half each, as the planner cuts it
    c = Constraints(ipr_surfaces=((6, 7, 0.2), (7, 8, 0.45)), ipr_amounts=((7, 6, 0.2), (7, 8, 0.25), (8, 7, 0.2)))
    assert c.model_dump()["ipr_amounts"] == ((7, 6, 0.2), (7, 8, 0.25), (8, 7, 0.2))
    assert c.face_amounts() == {(7, 6): 0.2, (6, 7): 0.0, (7, 8): 0.25, (8, 7): 0.2}
    for surfaces, amounts, text in (
        (((7, 8, 0.4),), ((7, 8, 0.3),), "면당 양은 0~0.25mm"),
        (((7, 8, 0.4),), ((7, 8, 0.25),), "합이 접촉면 처방과 다릅니다"),
        ((), ((7, 8, 0.2),), "처방되지 않은 접촉면"),
        (((7, 8, 0.4),), ((7, 9, 0.2),), "이웃한 두 치아"),
    ):
        with pytest.raises(ValueError) as e:
            Constraints(ipr_surfaces=surfaces, ipr_amounts=amounts)
        assert text in reason_ko(e.value)
    # a new contact list (the form or a turn repeating it) keeps the split of the contacts it leaves as they were
    again = c.patched(ConstraintPatch(ipr_surfaces=[[13, 12, 0.2], [12, 11, 0.45]]).changes())
    assert again.ipr_amounts == c.ipr_amounts
    moved = c.patched(ConstraintPatch(ipr_surfaces=[[13, 12, 0.2], [12, 11, 0.4]]).changes())
    assert moved.ipr_amounts == ((7, 6, 0.2),) and moved.ipr_surfaces == ((6, 7, 0.2), (7, 8, 0.4))


def test_the_planner_reads_the_contact_amount_not_the_face_split():
    """The planner plans a contact's total (half off each tooth, #57); the per-face split changes the setup's cut only."""
    s = Store()
    cid, case = s.load_case("poseidon-000131")
    even = Constraints(ipr_surfaces=((7, 8, 0.4),))
    split = even.model_copy(update={"ipr_amounts": ((7, 8, 0.25), (8, 7, 0.15))})
    Constraints.model_validate(split.model_dump(exclude={"allow_extraction"}))   # a valid split of the same contact
    t_even, i_even = planner.propose_target(case, "ipr", constraints=even)
    t_split, i_split = planner.propose_target(case, "ipr", constraints=split)
    assert i_even == i_split and all((t_even[k] == t_split[k]).all() for k in t_even if t_even[k] is not None)
