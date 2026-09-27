"""#75: the rule-based plan without the agent is `POST /api/plan` (the screen's «에이전트 없이 계산» / runFallback).

These tests pin the contract after v2: the case is opened with /activate (which may fail its own rule plan and return
200 + plan_error), the body is the screen's form (case_id, parent_plan_id, ConstraintPatch fields, Universal numbers),
the response holds plan summaries shaped exactly like GET /api/plans entries (input_stale included), and the chosen
plan is what a plan_selected event would name: stored, listed, current for the case, review skipped."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import store as store_mod
from cualign.server import api


def _client(monkeypatch, tmp_path):
    monkeypatch.setattr(store_mod, "OUT_DIR", tmp_path)
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(api, "STORE", store_mod.Store())
    app = FastAPI()
    api.add_api_routes(app)
    return TestClient(app)


def test_rule_plan_after_activate_matches_the_plans_list_and_a_plan_selected(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    opened = client.post("/api/cases/moderate/activate").json()
    assert "plan_error" not in opened and client.get("/api/plans?case_id=moderate").json()["plans"] == []   # step flow: no preview
    assert client.post("/api/plan", json={"case_id": "moderate"}).status_code == 200   # the fallback makes the first plans
    shown = client.get("/api/plans?case_id=moderate").json()["plans"][0]      # the plan the screen shows
    body = {"case_id": "moderate", "parent_plan_id": shown["plan_id"], "extraction": [], "stage_cap": 40, "lock": [8]}
    r = client.post("/api/plan", json=body)
    assert r.status_code == 200
    res = r.json()
    assert set(res) >= {"case_id", "chosen", "tried"} and res["case_id"] == "moderate"
    listed = {p["plan_id"]: p for p in client.get("/api/plans?case_id=moderate").json()["plans"]}
    for t in res["tried"]:
        assert set(t) == set(shown) and t["input_stale"] is False       # same shape as a GET /api/plans entry
        assert t == listed[t["plan_id"]]                                 # and the same values
        assert t["parent_plan_id"] == shown["plan_id"]
        assert t["constraints"]["stage_cap"] == 40 and t["constraints"]["lock"] == [8] and t["constraints"]["extraction"] == []
        assert t["review"]["status"] == "skipped"                        # no reviewer ran (the screen says so)
    selected = res["chosen"] or res["best_failed"]
    assert selected["plan_id"] in listed
    detail = client.get(f"/api/plans/{selected['plan_id']}").json()
    assert detail["constraints"] == selected["constraints"] and detail["parent_plan_id"] == shown["plan_id"]
    # what a plan_selected event carries (plan_id, parent_plan_id, review) is all in the summary
    assert {"plan_id", "parent_plan_id", "review"} <= set(selected)
    # the next agent turn continues from the plan (base_plan_id); opening the case again shows the prescription as the
    # case's conditions and the plan's own (cap included) under active_plan (answer-polish (8))
    opened = client.post("/api/cases/moderate/activate").json()
    assert opened["constraints"] == {**selected["constraints"], "stage_cap": None, "order": "simultaneous"}
    assert opened["active_plan"]["constraints"] == selected["constraints"]


def test_rule_plan_recovers_a_case_whose_activation_plan_failed(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    opened = client.post("/api/cases/moderate/activate")
    assert opened.status_code == 200 and "plan_error" not in opened.json()   # step flow: opening computes nothing
    assert client.get("/api/plans?case_id=moderate").json()["plans"] == []
    # a condition the rules refuse through POST /api/plan: 400 with the Korean reason (the failure card's text)
    bad = client.post("/api/plan", json={"case_id": "moderate", "allow_extraction": True})   # extraction without teeth
    assert bad.status_code == 400 and "발치할 치아 번호가 필요합니다" in bad.json()["detail"]
    assert client.get("/api/plans?case_id=moderate").json()["plans"] == []
    # «이 조건으로 다시 계산» on the open case: the first plans of the case
    ok = client.post("/api/plan", json={"case_id": "moderate", "extraction": []})
    assert ok.status_code == 200 and ok.json()["tried"] and all(t["parent_plan_id"] is None for t in ok.json()["tried"])
    assert client.get("/api/plans?case_id=moderate").json()["plans"]


def test_rule_plan_takes_universal_numbers_like_the_form(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    client.post("/api/cases/moderate/activate")
    res = client.post("/api/plan", json={"case_id": "moderate", "extraction": [5, 12]}).json()
    assert all(t["constraints"]["extraction"] == [5, 12] for t in res["tried"])    # stored as the form sent it
    assert all(t["strategy"] == "extraction" for t in res["tried"])
    assert client.post("/api/plan", json={"case_id": "moderate", "extraction": [14, 24]}).status_code == 422   # FDI is not form input


def test_rule_plan_takes_the_forms_ipr_prescription_once(monkeypatch, tmp_path):
    """Step flow (13): the form's per-contact IPR prescription (FDI, #57) reached the rules converted twice and was
    refused; it is converted once, in the request's own validation."""
    client = _client(monkeypatch, tmp_path)
    client.post("/api/cases/moderate/activate")
    r = client.post("/api/plan", json={"case_id": "moderate", "extraction": [], "ipr_surfaces": [[12, 11, 0.4]]})
    assert r.status_code == 200, r.text
    tried = r.json()["tried"]
    assert tried and all(t["constraints"]["ipr_surfaces"] == [[7, 8, 0.4]] for t in tried)   # FDI 12|11 = Universal 7|8
    assert client.post("/api/cases/moderate/activate").json()["constraints"]["ipr_surfaces"] == [[7, 8, 0.4]]
