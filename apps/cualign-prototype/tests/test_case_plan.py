"""A case's stages come from that case's mesh and prescription (#92)."""
import json

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


def _ids(client, case_id):
    return [p["plan_id"] for p in client.get(f"/api/plans?case_id={case_id}").json()["plans"]]


def test_opening_a_case_makes_no_plan_and_the_fallback_plans_that_case_only(monkeypatch, tmp_path):
    """Step flow (.report/15): opening a case is the scan only; the rule fallback (POST /api/plan) plans one case."""
    client = _client(monkeypatch, tmp_path)
    opened = client.post("/api/cases/moderate/activate")
    assert opened.status_code == 200 and opened.json()["flow"] is None and opened.json()["active_plan"] is None
    assert _ids(client, "moderate") == []
    assert client.post("/api/plan", json={"case_id": "moderate"}).status_code == 200
    first = _ids(client, "moderate")
    assert first
    assert all(p["case_id"] == "moderate" for p in client.get("/api/plans?case_id=moderate").json()["plans"])
    assert client.post("/api/cases/moderate/activate").status_code == 200
    assert _ids(client, "moderate") == first                       # opening again plans nothing
    client.post("/api/cases/mild/activate")
    assert _ids(client, "moderate") == first and _ids(client, "mild") == []
    client.post("/api/plan", json={"case_id": "mild"})
    assert _ids(client, "mild") and set(_ids(client, "mild")).isdisjoint(first)


def test_a_reloaded_plan_is_readable_as_a_plan(monkeypatch, tmp_path):
    monkeypatch.setattr(store_mod, "OUT_DIR", tmp_path)
    folder = tmp_path / "plans"
    folder.mkdir()
    body = {
        "plan_id": "pdisk", "case_id": "moderate", "strategy": "expansion", "stage_cap": None,
        "parent_plan_id": None,
        "constraints": {"allow_extraction": False, "lock": [], "ipr_exclude": [], "ipr_limit_mm": 0.25,
                        "stage_cap": None, "order": "simultaneous"},
        "review": {"status": "skipped", "attempts": 0, "message": "", "error": None},
        "approval": None, "info": {"n_stages": 1, "months": 0.2, "space_deficit_mm": 1.0},
        "target": {"ipr_mm_per_surface": 0.0, "ipr_applied_teeth": []},
        "violations": [], "passed": True, "input_revision": None, "input_stale": False,
        "stages": [{"2": [0.0, 0.0, 0.0]}], "rotations": [{"2": 1.5}], "pivots": {},
    }
    (folder / "pdisk.json").write_text(json.dumps(body), encoding="utf-8")
    loaded = store_mod.Store()
    plan = loaded.plans["pdisk"]
    assert plan["case_id"] == "moderate"
    assert plan["review"]["status"] == "skipped"
    assert 2 in plan["stages"][0]
    assert plan["stages"][0].yaw[2] == 1.5
    assert loaded.plan_json("pdisk")["case_id"] == "moderate"


def test_activate_opens_the_case_without_the_rule_plan(monkeypatch, tmp_path):
    """v2 board 07 (#112) became the step flow: opening never computes a plan, so a broken rule plan cannot fail it;
    the fallback's own failure is POST /api/plan's 400. Mesh failures stay 404."""
    client = _client(monkeypatch, tmp_path)
    monkeypatch.setattr(api, "rule_based_plan", lambda *a, **k: (_ for _ in ()).throw(ValueError("규칙 계산 실패: 시험용")))
    r = client.post("/api/cases/moderate/activate")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "plan_error" not in body and body["case_id"] == "moderate" and body["n_teeth"] > 0 and body["unsupported"] == []
    assert "crowding_mm" in body and "constraints" in body and body["flow"] is None
    assert client.get("/api/plans", params={"case_id": "moderate"}).json()["plans"] == []
    assert client.post("/api/plan", json={"case_id": "moderate"}).status_code == 400
    assert client.post("/api/cases/no-such-case/activate").status_code == 404


def test_reopening_a_case_never_adds_a_plan_and_reports_the_flow(monkeypatch, tmp_path):
    """Screen review 2026-09-28: opening a case again used to save a twin of the earlier preview. In the step flow
    opening plans nothing at all; the fallback's plans stay, the case's conditions go back to the prescription, and
    `flow`/`active_plan` say where the case stands, in this process and after a restart (plans read from disk)."""
    client = _client(monkeypatch, tmp_path)
    client.post("/api/cases/moderate/activate")
    r = client.post("/api/plan", json={"case_id": "moderate", "stage_cap": 40})
    assert r.status_code == 200, r.text
    capped = _ids(client, "moderate")
    chosen = (r.json()["chosen"] or r.json()["best_failed"])["plan_id"]
    opened = client.post("/api/cases/moderate/activate").json()
    assert _ids(client, "moderate") == capped and opened["constraints"]["stage_cap"] is None
    assert opened["flow"]["step"] == "stages" and opened["flow"]["plan_id"] == chosen and opened["flow"]["constraints"]["stage_cap"] == 40
    assert opened["active_plan"]["constraints"]["stage_cap"] == 40
    # a new process: plans come back from disk, the flow (in memory only) is gone, still no new plan
    client = _client(monkeypatch, tmp_path)
    opened = client.post("/api/cases/moderate/activate").json()
    assert set(_ids(client, "moderate")) == set(capped) and opened["flow"] is None and opened["active_plan"]["plan_id"] in capped
