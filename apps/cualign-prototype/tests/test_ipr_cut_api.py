"""The mesh response carries the IPR-cut crowns of the case's plan (#62): `teeth_cut`, `ipr_cut`, `plan_id`."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import store
from cualign.core.store import Store
from cualign.server import api


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "STORE", Store())
    monkeypatch.setattr(api, "STORE", store.STORE)
    app = FastAPI()
    api.add_api_routes(app)
    return TestClient(app)


def test_mesh_has_cut_crowns_for_an_ipr_plan_and_none_without_a_plan(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        data = client.get("/api/cases/poseidon-000131/mesh").json()
        assert data["plan_id"] is None and data["teeth_cut"] == {} and data["ipr_cut"] == {}     # no plan yet
        client.post("/api/cases/poseidon-000131/activate")
        client.post("/api/plan", json={"case_id": "poseidon-000131"})   # step flow: opening plans nothing; the fallback does
        plans = client.get("/api/plans?case_id=poseidon-000131").json()["plans"]
        ipr = next(p for p in plans if p["strategy"] == "ipr")
        data = client.get(f"/api/cases/poseidon-000131/mesh?plan_id={ipr['plan_id']}").json()
        assert data["plan_id"] == ipr["plan_id"]
        assert set(data["teeth_cut"]) == set(data["ipr_cut"]) == {"7", "8", "9", "10"}        # FDI 12..22 prescribed
        for i, e in data["ipr_cut"].items():
            assert e["mm"] > 0 and 0 < len(e["faces"]) < len(data["teeth_cut"][i]["f"])
            assert data["teeth_cut"][i]["v"] != data["teeth"][i]["v"]                            # the scan stays whole
        assert {"7", "8", "9", "10"} <= set(data["teeth"])
        # the representative plan (latest) when no plan_id is given
        data = client.get("/api/cases/poseidon-000131/mesh").json()
        assert data["plan_id"] == plans[0]["plan_id"]


def test_extraction_plan_without_ipr_cuts_nothing(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        client.post("/api/cases/poseidon-000097/activate")
        client.post("/api/plan", json={"case_id": "poseidon-000097"})
        data = client.get("/api/cases/poseidon-000097/mesh").json()
        assert data["plan_id"] is not None and data["teeth_cut"] == {} and data["ipr_cut"] == {}
