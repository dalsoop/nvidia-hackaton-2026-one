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


def test_plan_cut_gives_the_cut_crowns_alone(tmp_path, monkeypatch):
    """Step flow (11): switching plans on screen needs only the cut crowns, not the gum and dentition again."""
    with _client(tmp_path, monkeypatch) as client:
        client.post("/api/cases/poseidon-000131/activate")
        client.post("/api/plan", json={"case_id": "poseidon-000131"})
        plans = client.get("/api/plans?case_id=poseidon-000131").json()["plans"]
        ipr = next(p for p in plans if p["strategy"] == "ipr")
        cut = client.get(f"/api/plans/{ipr['plan_id']}/cut").json()
        full = client.get(f"/api/cases/poseidon-000131/mesh?plan_id={ipr['plan_id']}").json()
        assert set(cut) == {"plan_id", "teeth_cut", "ipr_cut"} and cut["plan_id"] == ipr["plan_id"]
        assert cut["teeth_cut"] == full["teeth_cut"] and cut["ipr_cut"] == full["ipr_cut"]   # the same computation
        assert "gum" not in cut and "teeth" not in cut
        assert client.get("/api/plans/p000000/cut").status_code == 404


def test_target_cut_gives_the_target_crowns_alone(tmp_path, monkeypatch):
    from cualign.core.service import PlanningService
    with _client(tmp_path, monkeypatch) as client:
        cid, case = store.STORE.load_case("poseidon-000131")
        tid = PlanningService(store.STORE).target(cid, "ipr", store.STORE.constraints_for(cid))
        cut = client.get(f"/api/cases/poseidon-000131/targets/{tid}/cut").json()
        full = client.get(f"/api/cases/poseidon-000131/mesh?target_id={tid}").json()
        assert set(cut) == {"plan_id", "target_id", "teeth_cut", "ipr_cut"} and cut["target_id"] == tid and cut["plan_id"] is None
        assert cut["teeth_cut"] == full["teeth_cut"] and cut["ipr_cut"] == full["ipr_cut"] and set(cut["ipr_cut"]) == {"7", "8", "9", "10"}
        assert client.get(f"/api/cases/poseidon-000097/targets/{tid}/cut").status_code == 404
        assert client.get("/api/cases/poseidon-000131/targets/t0/cut").status_code == 404


def test_mesh_crowns_are_closed_for_the_view_only(tmp_path, monkeypatch):
    """Scanned crowns are open at the margin; the mesh response fans that shut (a bared side shows no hole) while the
    scan's own vertices and faces come first, unchanged, and the case the core measures stays open."""
    import numpy as np
    import trimesh
    from cualign.core.ipr_cut import _boundary_loops
    with _client(tmp_path, monkeypatch) as client:
        data = client.get("/api/cases/poseidon-000097/mesh").json()
        _, case = store.STORE.load_case("poseidon-000097")
        raw = case.viewer_json()["teeth"]
        assert set(data["teeth"]) == set(raw)
        for i, t in data["teeth"].items():
            m = trimesh.Trimesh(np.asarray(t["v"], float), np.asarray(t["f"]), process=False)
            assert _boundary_loops(m) == []
            n, k = len(raw[i]["v"]), len(raw[i]["f"])
            assert t["v"][:n] == raw[i]["v"] and len(t["f"]) > k and t["f"][:k] == raw[i]["f"]
        assert _boundary_loops(case.mesh[case.ids[0]])                                         # the core's crown is untouched
