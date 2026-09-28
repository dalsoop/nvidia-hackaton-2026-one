"""A stored plan computed by another version of the calculation core is never reused (answer-polish (10)).

Live 2026-09-28: after #138 changed the target arrangement, the server on port 8000 still showed a 20-stage plan it had
saved under out/plans, so the dentist saw no change. Every plan now carries `planner_version` (a fingerprint of
planner, arch, ipr_cut, limits and print_model source) in its info. A stored plan under another fingerprint is dropped
at load for a sample case, and for a patient case it stays listed as `previous_calculation` only: never the case's
active plan, never the representative plan of the mesh, never a base plan for a turn or a replay."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import store as store_mod
from cualign.server import api
from cualign.server.plan_events import ChatContext, open_run


def _client(monkeypatch, tmp_path):
    monkeypatch.setattr(store_mod, "OUT_DIR", tmp_path)
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(api, "STORE", store_mod.Store())
    app = FastAPI()
    api.add_api_routes(app)
    return TestClient(app)


def _age(tmp_path, plan_id, version="0000000000000000"):
    """Rewrite a stored plan file as if another core version had computed it."""
    path = tmp_path / "plans" / f"{plan_id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["info"]["planner_version"] = version
    path.write_text(json.dumps(data), encoding="utf-8")


def test_new_plans_carry_the_fingerprint(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    res = client.post("/api/plan", json={"case_id": "moderate"}).json()
    pid = res["tried"][0]["plan_id"]
    detail = client.get(f"/api/plans/{pid}").json()
    assert detail["info"]["planner_version"] == store_mod.PLANNER_VERSION and detail["previous_calculation"] is False
    assert len(store_mod.PLANNER_VERSION) == 16 and store_mod.planner_version() == store_mod.PLANNER_VERSION
    assert all(t["previous_calculation"] is False for t in res["tried"])


def test_a_patient_plan_of_another_version_is_listed_as_previous_only(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    old = client.post("/api/plan", json={"case_id": "moderate", "stage_cap": 40}).json()
    old_ids = [t["plan_id"] for t in old["tried"]]
    for pid in old_ids:
        _age(tmp_path, pid)
    client = _client(monkeypatch, tmp_path)   # a new process reads the files back
    listed = {p["plan_id"]: p for p in client.get("/api/plans?case_id=moderate").json()["plans"]}
    assert set(listed) == set(old_ids) and all(p["previous_calculation"] for p in listed.values())
    opened = client.post("/api/cases/moderate/activate").json()
    assert opened["active_plan"] is None                                 # not the case's current plan
    assert client.get("/api/cases/moderate/mesh").json()["plan_id"] is None   # not the mesh's representative plan
    # not a base plan: a turn from it is refused (400 on the chat route, ValueError here), a replay too (409)
    with pytest.raises(ValueError, match="이전 계산"):
        open_run(ChatContext(case_id="moderate", base_plan_id=old_ids[0]), store=api.STORE)
    from cualign.core import recorded
    monkeypatch.setattr(recorded, "RECORDED_DIR", tmp_path / "recorded")
    # a new plan under the current core is the case's plan again; the old ones stay listed as previous
    new = client.post("/api/plan", json={"case_id": "moderate"}).json()
    new_id = (new["chosen"] or new["best_failed"])["plan_id"]
    assert client.post("/api/cases/moderate/activate").json()["active_plan"]["plan_id"] == new_id
    listed = client.get("/api/plans?case_id=moderate").json()["plans"]
    assert {p["plan_id"] for p in listed if p["previous_calculation"]} == set(old_ids)
    assert {p["plan_id"] for p in listed if not p["previous_calculation"]} >= {new_id}


def test_a_sample_plan_of_another_version_is_dropped_at_load(monkeypatch, tmp_path):
    from cualign.core import samples
    sample = next(s for s in samples.SAMPLES.values() if s.available)
    client = _client(monkeypatch, tmp_path)
    res = client.post("/api/plan", json={"case_id": sample.case_id}).json()
    ids = [t["plan_id"] for t in res["tried"]]
    _age(tmp_path, ids[0])
    (tmp_path / "stl").mkdir(exist_ok=True)
    (tmp_path / "stl" / f"{ids[0]}.zip").write_bytes(b"old")
    client = _client(monkeypatch, tmp_path)
    kept = [p["plan_id"] for p in client.get(f"/api/plans?case_id={sample.case_id}").json()["plans"]]
    assert ids[0] not in kept and set(kept) == set(ids[1:])
    assert not (tmp_path / "plans" / f"{ids[0]}.json").exists() and not (tmp_path / "stl" / f"{ids[0]}.zip").exists()
