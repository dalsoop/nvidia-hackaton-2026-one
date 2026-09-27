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


def test_opening_a_case_plans_that_case_only(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    opened = client.post("/api/cases/moderate/activate")
    assert opened.status_code == 200
    first = _ids(client, "moderate")
    assert first
    assert all(p["case_id"] == "moderate" for p in client.get("/api/plans?case_id=moderate").json()["plans"])
    assert client.post("/api/cases/moderate/activate").status_code == 200
    assert _ids(client, "moderate") == first
    client.post("/api/cases/mild/activate")
    assert _ids(client, "moderate") == first
    assert _ids(client, "mild")
    assert set(_ids(client, "mild")).isdisjoint(first)


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


def test_activate_opens_the_case_even_when_the_rule_plan_fails(monkeypatch, tmp_path):
    """v2 board 07 (#112): a failed rule computation is a failure card on an open case, not a closed case. The response
    keeps its fields and carries the ValueError text as plan_error; mesh/constraint failures stay 404/400."""
    client = _client(monkeypatch, tmp_path)
    monkeypatch.setattr(api, "rule_based_plan", lambda *a, **k: (_ for _ in ()).throw(ValueError("규칙 계산 실패: 시험용")))
    r = client.post("/api/cases/moderate/activate")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan_error"] == "규칙 계산 실패: 시험용" and body["case_id"] == "moderate" and body["n_teeth"] > 0
    assert "crowding_mm" in body and "constraints" in body
    assert client.get("/api/plans", params={"case_id": "moderate"}).json()["plans"] == []
    assert client.post("/api/cases/no-such-case/activate").status_code == 404


def test_reopening_a_case_reuses_the_preview_under_the_same_conditions(monkeypatch, tmp_path):
    """Screen review 2026-09-28: opening a case again left the earlier preview under 지난 계획 and saved a new one with
    the same conditions. A plan under the case's current conditions, latest or not, is reused; only new conditions plan."""
    client = _client(monkeypatch, tmp_path)
    client.post("/api/cases/moderate/activate")
    preview = _ids(client, "moderate")
    # an agent turn (here POST /api/plan) planned under other conditions; the case now carries those
    r = client.post("/api/plan", json={"case_id": "moderate", "stage_cap": 40, "parent_plan_id": preview[-1]})
    assert r.status_code == 200, r.text
    capped = [pid for pid in _ids(client, "moderate") if pid not in preview]
    assert capped
    # the dentist went back to the preview's conditions (the case's conditions are the preview's again)
    api.STORE.case_constraints["moderate"] = api.STORE.constraints_for("moderate", preview[0])
    client.post("/api/cases/moderate/activate")
    assert set(_ids(client, "moderate")) == set(preview + capped)   # no twin of the preview
    # a new process: plans come back from disk, the case's conditions are the default ones the preview was made under
    client = _client(monkeypatch, tmp_path)
    client.post("/api/cases/moderate/activate")
    assert set(_ids(client, "moderate")) == set(preview + capped)
    # a prescription nobody planned under still gets a preview (a stage cap would not: opening drops plan conditions, (8))
    api.STORE.case_constraints["moderate"] = api.STORE.constraints_for("moderate").patched({"lock": [3]})
    client.post("/api/cases/moderate/activate")
    assert len(_ids(client, "moderate")) == 2 * len(preview) + len(capped)   # one preview per strategy again
