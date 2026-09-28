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
    """Scanned crowns are open at the margin; the mesh response closes that with a root stub (a bared side shows no
    hole and no flat cut) while the scan's own vertices and faces come first, unchanged, the shell keeps one outward
    orientation, and the case the core measures stays open. The stub reaches 2–3 mm past the margin's deepest point
    along the tooth axis."""
    import numpy as np
    import trimesh
    from cualign.core.ipr_cut import _boundary_loops, _tooth_axis
    with _client(tmp_path, monkeypatch) as client:
        data = client.get("/api/cases/poseidon-000097/mesh").json()
        _, case = store.STORE.load_case("poseidon-000097")
        raw = case.viewer_json()["teeth"]
        assert set(data["teeth"]) == set(raw) == set(data["teeth_cap"])
        assert set(data["teeth_cap"].values()) == {"stub"}                                      # one clean margin per crown here
        for i, t in data["teeth"].items():
            m = trimesh.Trimesh(np.asarray(t["v"], float), np.asarray(t["f"]), process=False)
            assert _boundary_loops(m) == [] and m.volume > 0
            n, k = len(raw[i]["v"]), len(raw[i]["f"])
            assert t["v"][:n] == raw[i]["v"] and len(t["f"]) > k and t["f"][:k] == raw[i]["f"]
            V0 = np.asarray(raw[i]["v"], float)
            margin = V0[_boundary_loops(trimesh.Trimesh(V0, np.asarray(raw[i]["f"]), process=False))[0]]
            axis = _tooth_axis(V0, margin)
            reach = (np.asarray(t["v"], float)[n:] @ axis).max() - (margin @ axis).max()
            assert 2.0 <= reach <= 3.0, (i, reach)
        assert _boundary_loops(case.mesh[case.ids[0]])                                         # the core's crown is untouched


def test_a_split_margin_gets_a_smoothed_dome():
    """Two open loops (a margin split in two) or a short one: no stub, a dome over each, closed, the old part first."""
    import numpy as np
    import trimesh
    from cualign.core.ipr_cut import _boundary_loops, closed_json
    tube = trimesh.creation.cylinder(radius=3.0, height=6.0, sections=24)
    keep = np.abs(tube.triangles_center[:, 2]) < 2.9                         # the side wall only: open at both ends
    wall = trimesh.Trimesh(tube.vertices, tube.faces[keep], process=False)
    wall.remove_unreferenced_vertices()
    t = {"v": np.round(wall.vertices, 3).tolist(), "f": wall.faces.tolist()}
    out, how = closed_json(t)
    m = trimesh.Trimesh(np.asarray(out["v"], float), np.asarray(out["f"]), process=False)
    assert how == "dome" and _boundary_loops(m) == [] and out["f"][:len(t["f"])] == t["f"] and out["v"][:len(t["v"])] == t["v"]


def test_mesh_scan_part_is_cached_per_loaded_case(tmp_path, monkeypatch):
    """The scan part of /mesh is JSON text made once per Case object (#163 follow-up): the same answer twice, and a
    re-loaded scan (a new Case, as after a re-upload) gets its own."""
    from cualign.core import Case, samples
    with _client(tmp_path, monkeypatch) as client:
        first = client.get("/api/cases/poseidon-000131/mesh")
        assert first.headers["content-type"].startswith("application/json")
        _, case = store.STORE.load_case("poseidon-000131")
        assert case in api._MESH_JSON and client.get("/api/cases/poseidon-000131/mesh").text == first.text
        store.STORE.cases["poseidon-000131"] = fresh = Case.from_dir(samples.get("poseidon-000131").folder)
        assert fresh not in api._MESH_JSON
        assert client.get("/api/cases/poseidon-000131/mesh").json()["teeth"] == first.json()["teeth"] and fresh in api._MESH_JSON
