"""#56: the teeth to extract are the dentist's prescription; the app plans exactly them and never picks them."""
import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import Case, store
from cualign.core.constraints import ConstraintPatch, Constraints, ExtractionTeethNeeded
from cualign.core.planner import compare_strategies, plan_stages, propose_target, validate
from cualign.server import api


@pytest.fixture(scope="module")
def moderate():
    return Case.synthetic("moderate")


# ------------------------------------------------------------------------------------------------ the prescription
def test_patch_semantics():
    none, ext = Constraints(), Constraints(extraction=(12, 5))
    assert ext.extraction == (5, 12) and ext.allow_extraction and not none.allow_extraction
    assert ext.patched(ConstraintPatch().changes()) == ext                       # null keeps
    assert ext.patched({"extraction": []}).extraction == ()                      # [] = non-extraction
    assert ext.patched({"extraction": [4, 13]}).extraction == (4, 13)            # a list replaces
    assert ext.patched({"allow_extraction": False}).extraction == ()             # legacy false clears
    assert ext.patched({"allow_extraction": True}).extraction == (5, 12)         # legacy true keeps a prescription
    with pytest.raises(ExtractionTeethNeeded):
        none.patched({"allow_extraction": True})                                 # ... but never picks teeth
    with pytest.raises(ValueError):
        none.patched({"allow_extraction": False, "extraction": [5]})             # contradiction
    # the output keeps allow_extraction for readers, and reads back
    assert Constraints.model_validate(ext.model_dump(mode="json")) == ext


@pytest.mark.parametrize("bad, why", [({"extraction": (7,)}, "소구치"), ({"extraction": (5,), "lock": (5,)}, "고정")])
def test_unsupported_or_contradictory_prescriptions_are_refused(bad, why):
    with pytest.raises(ValueError, match=why):
        Constraints(**bad)


def test_prescribed_tooth_must_be_in_the_case(moderate):
    without_5 = Case({i: m for i, m in moderate.mesh.items() if i != 5}, name="no-5")
    with pytest.raises(ValueError):
        Constraints(extraction=(5, 12)).check_case(without_5.ids)
    with pytest.raises(ValueError, match="케이스에 없습니다"):
        propose_target(without_5, "extraction", extraction=(5, 12))


# ------------------------------------------------------------------------------------------------ the plan
@pytest.mark.parametrize("teeth", [(5, 12), (4, 13)])
def test_only_the_prescribed_teeth_are_extracted(moderate, teeth):
    rows = compare_strategies(moderate, constraints=Constraints(extraction=teeth))
    assert [r["strategy"] for r in rows] == ["extraction"]
    assert rows[0]["removed"] == list(teeth)
    assert not [v for v in rows[0]["_viol"] if v["type"].startswith("extraction")]


def test_non_extraction_removes_nothing_and_the_app_does_not_offer_extraction(moderate):
    rows = compare_strategies(moderate, constraints=Constraints())
    assert "extraction" not in [r["strategy"] for r in rows]
    assert all(r["removed"] == [] for r in rows)
    with pytest.raises(ValueError, match="발치 처방"):
        propose_target(moderate, "extraction")                 # no prescription: no extraction plan at all


def test_a_plan_that_extracts_otherwise_is_a_violation(moderate):
    target, info = propose_target(moderate, "extraction", extraction=(5, 12))
    stages, _ = plan_stages(moderate, target)
    viol = validate(moderate, stages, constraints=Constraints(extraction=(4, 13)))
    bad = [v for v in viol if v["type"] == "extraction_mismatch"]
    assert bad and bad[0]["prescribed"] == [4, 13] and bad[0]["removed"] == [5, 12]
    target, _ = propose_target(moderate, "expansion_ipr")    # a prescribed extraction that is not done
    stages, _ = plan_stages(moderate, target)
    assert any(v["type"] == "extraction_mismatch" for v in validate(moderate, stages, constraints=Constraints(extraction=(5, 12))))


@pytest.mark.parametrize("tooth, moved, kept", [(5, 3, 14), (4, 3, 14), (12, 14, 3), (13, 14, 3)])
def test_one_sided_extraction_closes_on_its_own_side(tooth, moved, kept):
    # mild: a one-sided premolar leaves room to close (moderate's 4.5 mm crowding leaves ~0.7 mm, which the incisors'
    # shape room takes, #76)
    c = Case.synthetic("mild")
    target, info = propose_target(c, "extraction", extraction=(tooth,))
    assert target[tooth] is None and sum(v is None for v in target.values()) == 1
    assert np.linalg.norm(target[moved][:2]) > 1.0             # the extraction side's molars close the space
    assert np.linalg.norm(target[kept][:2]) < 0.05             # the other side's molars stay
    stages, _ = plan_stages(c, target)
    assert not validate(c, stages, space_deficit_mm=info["space_deficit_mm"], constraints=Constraints(extraction=(tooth,)))


# ------------------------------------------------------------------------------------------------ the paths in
@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "OUT_DIR", tmp_path)
    s = store.Store()
    monkeypatch.setattr(store, "STORE", s)
    monkeypatch.setattr(api, "STORE", s)
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as c:
        yield c


def test_api_plans_the_prescription_and_keeps_it_on_revision(client):
    r = client.post("/api/plan", json={"case_id": "moderate", "extraction": [5, 12]}).json()
    plan = r["chosen"]
    assert plan and plan["strategy"] == "extraction" and [t["strategy"] for t in r["tried"]] == ["extraction"]
    assert plan["constraints"]["extraction"] == [5, 12] and plan["constraints"]["allow_extraction"] is True
    rev = client.post("/api/plan", json={"case_id": "moderate", "parent_plan_id": plan["plan_id"], "stage_cap": 60}).json()
    kept = rev["chosen"] or rev["best_failed"]
    assert kept["constraints"]["extraction"] == [5, 12] and kept["constraints"]["stage_cap"] == 60


def test_api_asks_for_the_teeth_instead_of_picking_them(client):
    r = client.post("/api/plan", json={"case_id": "moderate", "allow_extraction": True})
    assert r.status_code == 400 and "발치할 치아 번호" in r.json()["detail"]
    r = client.post("/api/plan", json={"case_id": "moderate", "extraction": [7]})
    assert r.status_code == 400 and "소구치" in r.json()["detail"]


def test_chat_context_without_teeth_is_refused_with_the_reason():
    from cualign.server.plan_events import ChatContext, open_run
    ctx = ChatContext.model_validate({"request_id": "r1", "case_id": "moderate",
                                      "constraints": {"allow_extraction": True}})
    with pytest.raises(ExtractionTeethNeeded):
        open_run(ctx, store=store.Store())


def test_cli_does_not_plan_extraction_without_teeth(monkeypatch):
    from cualign import cli
    args = type("A", (), {"request": "발치 허용해서 짜줘", "case": "moderate", "export": None})()
    with pytest.raises(SystemExit, match="발치할 치아 번호"):
        cli.cmd_plan(args)


def test_plan_files_from_before_56_read_back():
    # plan files keep constraints; before #56 they said allow_extraction and never which teeth (store reads them, #93)
    old = {"allow_extraction": True, "lock": [], "ipr_exclude": [], "ipr_limit_mm": 0.25, "stage_cap": None,
           "order": "simultaneous"}
    assert Constraints.from_saved(old, removed=[12, 5]).extraction == (5, 12)     # an extraction plan: what it removed
    assert Constraints.from_saved(old, removed=[]).extraction == ()               # only allowed: non-extraction
    assert Constraints.from_saved({**old, "allow_extraction": False}).extraction == ()
    new = Constraints(extraction=(4, 13)).model_dump(mode="json")
    assert Constraints.from_saved(new, removed=[]).extraction == (4, 13)          # new files carry the teeth
