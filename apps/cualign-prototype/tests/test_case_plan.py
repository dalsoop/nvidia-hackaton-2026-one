"""A case's stages come from that case's mesh and prescription (#92)."""
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
