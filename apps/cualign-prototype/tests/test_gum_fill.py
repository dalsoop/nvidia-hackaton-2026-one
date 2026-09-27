"""The viewer's gum with the tooth trench covered (core/gum_fill.py, GET /api/cases/{id}/mesh and /gum).

A sample gingiva.stl is the gum with the teeth cut out as one trench along the arch; once a crown moves or is
extracted the viewer looks into that hole. The server covers the trench once per case and hands the covered copy to
the screen as `gum_filled`, in the same {v, f} shape as `gum`."""
import numpy as np
import pytest
import trimesh
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import gum_fill, samples
from cualign.core.case import Case
from cualign.core.store import STORE
from cualign.server import api

SAMPLES = [s for s in samples.SAMPLES.values() if s.available]


def _case(sample):
    return Case.from_dir(sample.folder)


@pytest.mark.parametrize("sample", SAMPLES, ids=lambda s: s.case_id)
def test_the_trench_is_covered_on_every_sample(sample):
    case = _case(sample)
    crowns = [case.mesh[i] for i in case.ids]
    gum = gum_fill._finite(case.gum_scan)
    before = gum_fill.socket_loops(gum, case.anchor, crowns)
    assert before and {t for _, teeth in before for t in teeth} >= set(case.ids) - {8}   # the trench encloses the teeth
    filled, meta = gum_fill.fill_sockets(gum, case.anchor, crowns)
    assert meta["filled"] and meta["sockets"] == sorted({t for _, teeth in before for t in teeth})
    assert gum_fill.socket_loops(filled, case.anchor, crowns) == []                     # no trench loop is left
    assert meta["loops_after"] == 0 and meta["base"] is True                            # closed underneath as well (#7 polish)
    assert not [loop for loop in gum_fill.boundary_loops(filled) if len(loop) == 3]     # no triangle-sized pinholes
    # every tooth's site is covered when looked at from above (the crown may be anywhere by then)
    xy = np.array([case.anchor[i][:2] for i in case.ids])
    covered = gum_fill.covers_xy(filled, xy)
    assert all(covered[k] for k, i in enumerate(case.ids) if i in meta["sockets"])
    assert covered.sum() >= gum_fill.covers_xy(gum, xy).sum()
    assert np.isfinite(filled.vertices).all() and len(filled.vertices) < 1.6 * len(gum.vertices)   # viewer-sized


def test_an_extraction_site_is_closed():
    """poseidon-000097 prescribes 14·24 (Universal 5, 12): with those crowns gone the gum under them is a surface."""
    case = _case(samples.SAMPLES["poseidon-000097"])
    crowns = [case.mesh[i] for i in case.ids]
    filled, meta = gum_fill.fill_sockets(case.gum_scan, case.anchor, crowns)
    assert {5, 12} <= set(meta["sockets"])
    sites = np.array([case.anchor[5][:2], case.anchor[12][:2]])
    assert not gum_fill.covers_xy(gum_fill._finite(case.gum_scan), sites).any()   # open before
    assert gum_fill.covers_xy(filled, sites).all()                                # closed after
    # the cover sits at gum level, not at the crown: below the occlusal plane, above the deepest gum
    near = filled.vertices[np.linalg.norm(filled.vertices[:, :2] - case.anchor[5][:2], axis=1) < 1.0]
    assert len(near) and (near[:, 2] < 0).all() and (near[:, 2] > case.gum_scan.bounds[0][2]).all()


def test_the_procedural_gum_comes_back_unchanged():
    case = Case.synthetic("moderate")
    view = case.viewer_json()["gum"]
    gum = trimesh.Trimesh(np.asarray(view["v"]), np.asarray(view["f"]), process=False)
    filled, meta = gum_fill.fill_sockets(gum, case.anchor, [case.mesh[i] for i in case.ids])
    assert filled is gum and meta["filled"] is False and meta["sockets"] == []


def _client():
    app = FastAPI()
    api.add_api_routes(app)
    return TestClient(app)


def test_mesh_and_gum_endpoints_carry_the_filled_gum(monkeypatch):
    monkeypatch.setattr(api, "_GUM_FILLED", {})
    client = _client()
    sample = samples.SAMPLES["poseidon-000097"]
    if not sample.available:
        pytest.skip("sample scans not present")
    mesh = client.get(f"/api/cases/{sample.case_id}/mesh").json()
    assert set(mesh["gum_filled"]) == {"v", "f"} and set(mesh["gum"]) == {"v", "f"}
    assert mesh["gum_fill"]["source"] == "scan" and mesh["gum_fill"]["filled"] is True
    assert len(mesh["gum_filled"]["f"]) > len(mesh["gum"]["f"]) and len(mesh["gum_filled"]["v"][0]) == 3
    gum = client.get(f"/api/cases/{sample.case_id}/gum").json()
    assert set(gum) == {"gum", "gum_filled", "gum_fill"}
    assert gum["gum_filled"] == mesh["gum_filled"] and gum["gum"] == mesh["gum"]   # same cached copy
    assert len(api._GUM_FILLED) == 1
    assert client.get("/api/cases/no-such-case/gum").status_code == 404
    # a case without a scanned gum: the procedural ridge, unchanged, under the same keys
    STORE.load_case("moderate")
    plain = client.get("/api/cases/moderate/mesh").json()
    assert plain["gum_fill"] == {"source": "procedural", "filled": False, "sockets": [], "loops_before": plain["gum_fill"]["loops_before"],
                                 "loops_after": plain["gum_fill"]["loops_after"], "base": False, "z_base": None}
    assert plain["gum_filled"] == plain["gum"]


@pytest.mark.parametrize("sample", SAMPLES, ids=lambda s: s.case_id)
def test_the_underside_is_closed_on_every_sample(sample):
    """Seen from below (the viewer turned over) the gum is a solid block: the outer rim walls down to a flat floor
    BASE_DEPTH_MM under the gum's lowest point, the floor uses the rim's own edges, and no boundary loop is left."""
    case = _case(sample)
    crowns = [case.mesh[i] for i in case.ids]
    gum = gum_fill._finite(case.gum_scan)
    filled, meta = gum_fill.fill_sockets(gum, case.anchor, crowns)
    assert meta["base"] is True and meta["loops_after"] == 0 and gum_fill.boundary_loops(filled) == []
    z_gum = float(np.asarray(gum.vertices)[:, 2].min())
    assert meta["z_base"] == pytest.approx(z_gum - gum_fill.BASE_DEPTH_MM, abs=0.01)
    v = np.asarray(filled.vertices)
    assert v[:, 2].min() == pytest.approx(meta["z_base"], abs=0.01) and v[:, 2].max() == np.asarray(gum.vertices)[:, 2].max()
    floor = np.isclose(v[:, 2], meta["z_base"], atol=0.01)
    assert floor.sum() >= 500                      # the rim's projection (500+ points on every sample)
    # the floor is the rim's footprint (about 1,250-1,450 mm2 on the samples) and lies under the molars; the incisors'
    # anchors can fall outside it where the palatal slope folds under them, which the closed shell covers from above
    faces = np.asarray(filled.faces)
    floor_faces = trimesh.Trimesh(v, faces[floor[faces].all(axis=1)], process=False)
    assert floor_faces.area >= 1000
    assert gum_fill.covers_xy(floor_faces, np.array([case.anchor[3][:2], case.anchor[14][:2]])).all()


def test_close_base_walls_a_simple_band():
    """A flat square ring (one outer loop, one inner hole) becomes a closed box with a floor 2 mm below."""
    outer = np.array([[0, 0], [10, 0], [10, 10], [0, 10]], float)
    inner = np.array([[3, 3], [3, 7], [7, 7], [7, 3]], float)
    ring = trimesh.Trimesh(np.column_stack([np.vstack([outer, inner]), np.zeros(8)]),
                           np.array([[0, 1, 4], [1, 5, 4], [1, 2, 5], [2, 6, 5], [2, 3, 6], [3, 7, 6], [3, 0, 7], [0, 4, 7]]), process=False)
    assert len(gum_fill.boundary_loops(ring)) == 2
    closed, meta = gum_fill.close_base(ring, depth=2.0)
    assert meta == {"base": True, "z_base": -2.0, "loops_after": 0} and gum_fill.boundary_loops(closed) == []
    assert closed.vertices[:, 2].min() == -2.0 and len(closed.vertices) == 8 + 4 + 1   # rim + its floor copy + the hole's fan centre
    tris = gum_fill._ear_clip(np.array([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], float))   # an L: a reflex corner
    assert tris is not None and len(tris) == 4
    assert gum_fill.close_base(trimesh.creation.box(), depth=1.0)[1] == {"base": False, "z_base": None, "loops_after": 0}   # nothing open
