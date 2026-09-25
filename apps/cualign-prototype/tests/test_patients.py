"""Patient flow: register → upload a scan → input check → plan. Local files only; no model calls."""
import numpy as np
import pytest
import trimesh
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import store
from cualign.core.synth import make_case
from cualign.server import api


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "OUT_DIR", tmp_path)
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as c:
        yield c


def _scan_files(drop=(), transform=None, gum=False, open_crowns=False, rename=None):
    meshes = {i: m.copy() for i, m in make_case("mild").items() if i not in drop}
    if open_crowns:     # cut the gingival face off, as a segmented crown comes out of a scan
        for m in meshes.values():
            m.update_faces(m.face_normals[:, 2] > -0.5)
            m.remove_unreferenced_vertices()
    if gum:             # a plate under the crowns
        lo, hi = np.min([m.bounds[0] for m in meshes.values()], 0), np.max([m.bounds[1] for m in meshes.values()], 0)
        g = trimesh.creation.box(extents=[hi[0] - lo[0] + 6, hi[1] - lo[1] + 6, 4])
        g.apply_translation([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] - 2])
        meshes["gingiva"] = g
    out = []
    for i, m in meshes.items():
        if transform is not None:
            m.apply_transform(transform)
        name = f"{(rename or (lambda u: u))(i)}.stl" if i != "gingiva" else "gingiva.stl"
        out.append(("files", (name, m.export(file_type="stl"), "model/stl")))
    return out


def _scanner_pose(flip):
    T = trimesh.transformations.euler_matrix(0.4, -0.3 + (np.pi if flip else 0.0), 1.1)
    T[:3, 3] = [31.0, -12.0, 57.0]
    return T


def test_register_upload_check_and_plan(client):
    assert client.post("/api/patients", json={"alias": "상담 010-1234-5678"}).status_code == 400   # phone number
    assert client.post("/api/patients", json={"alias": " "}).status_code == 400
    p = client.post("/api/patients", json={"alias": "3월 상담 A", "memo": "상악 총생"}).json()
    assert p["patient_id"] == "P0001" and p["scans"] == []

    gum_only = [("files", ("gingiva.stl", b"solid g\nendsolid g\n", "model/stl"))]
    assert client.post("/api/patients/P0001/scans", files=gum_only).status_code == 400
    assert client.post("/api/patients/P9999/scans", files=_scan_files()).status_code == 404

    r = client.post("/api/patients/P0001/scans", files=_scan_files())
    assert r.status_code == 200, r.text
    scan = r.json()
    assert scan["case_id"] == "P0001-S1" and scan["check"]["ready"] and scan["check"]["n_teeth"] == 14
    assert scan["check"]["missing"] == [] and scan["check"]["crowding_mm"] > 0

    # survives a restart: a fresh store opens the scan from disk by its case id
    store.STORE.cases.pop("P0001-S1", None)
    check = client.get("/api/cases/P0001-S1/check").json()
    assert check["teeth"] == list(range(2, 16))

    # planning waits for the dentist's confirmation on the input-check screen (every planning path)
    blocked = client.post("/api/plan", json={"case_id": "P0001-S1", "allow_extraction": False})
    assert blocked.status_code == 400 and "입력 확인" in blocked.json()["detail"]
    assert client.post("/api/patients/P0001/scans/S1/confirm").json()["confirmed_at"]
    plan = client.post("/api/plan", json={"case_id": "P0001-S1", "allow_extraction": False}).json()
    assert plan["case_id"] == "P0001-S1" and plan["tried"]
    detail = client.get("/api/patients/P0001").json()
    assert [s["scan_id"] for s in detail["scans"]] == ["S1"] and detail["scans"][0]["plans"] >= 1
    assert client.get("/api/patients").json()["patients"][0]["n_scans"] == 1
    assert all(not r["case_id"].startswith("P0001") for r in client.get("/api/cases").json()["cases"])


def test_scan_with_a_missing_tooth_is_not_plannable(client):
    client.post("/api/patients", json={"alias": "결손 케이스"})
    check = client.post("/api/patients/P0001/scans", files=_scan_files(drop=(7,))).json()["check"]
    assert check["missing"] == [7] and not check["ready"] and check["unsupported"]
    assert client.post("/api/patients/P0001/scans/S1/confirm").status_code == 409   # unsupported: cannot be confirmed


def test_unknown_patient_and_case(client):
    assert client.get("/api/patients/P0404").status_code == 404
    assert client.get("/api/cases/P0404-S1/check").status_code == 404


@pytest.mark.parametrize("gum,open_crowns,basis", [(True, False, "gingiva"), (False, True, "cervical")])
def test_scanner_coordinates_are_put_into_the_core_frame(client, gum, open_crowns, basis):
    client.post("/api/patients", json={"alias": "스캐너 좌표"})
    ref = client.post("/api/patients/P0001/scans", files=_scan_files(gum=gum, open_crowns=open_crowns)).json()
    moved = client.post("/api/patients/P0001/scans", files=_scan_files(transform=_scanner_pose(flip=True), gum=gum,
                                                                         open_crowns=open_crowns)).json()
    assert moved["orientation"]["basis"] == basis and moved["orientation"]["side"] == "ok"
    assert moved["orientation"]["rotation_deg"] > 90                      # it really was upside down
    assert abs(moved["check"]["crowding_mm"] - ref["check"]["crowding_mm"]) <= 0.2
    mesh = client.get("/api/cases/P0001-S2/mesh").json()
    tops = [max(v[2] for v in t["v"]) for t in mesh["teeth"].values()]
    assert abs(float(np.median(tops))) < 0.3                              # occlusal plane at z = 0
    x = {i: np.mean([v[0] for v in mesh["teeth"][str(i)]["v"]]) for i in (2, 8, 15)}
    y8 = np.mean([v[1] for v in mesh["teeth"]["8"]["v"]])
    y2 = np.mean([v[1] for v in mesh["teeth"]["2"]["v"]])
    assert x[2] < x[15] and y8 > y2                                       # tooth 2 on the left, incisors to +y


def test_reversed_numbers_are_flagged_and_can_be_mirrored(client):
    client.post("/api/patients", json={"alias": "번호 반대"})
    scan = client.post("/api/patients/P0001/scans", files=_scan_files(gum=True, rename=lambda u: 17 - u)).json()
    assert scan["orientation"]["side"] == "reversed"
    assert client.post("/api/patients/P0001/scans/S1/confirm").status_code == 200
    fixed = client.post("/api/patients/P0001/scans/S1/mirror").json()
    assert fixed["orientation"]["side"] == "ok" and fixed["confirmed_at"] is None   # renumbering clears the confirmation
    assert fixed["teeth"] == list(range(2, 16))


def test_one_piece_scan_is_explained_and_deletes_work(client):
    client.post("/api/patients", json={"alias": "삭제 확인"})
    for name in ("upperjaw.stl", "000018.stl"):      # an all-digit scan id is not a tooth number
        r = client.post("/api/patients/P0001/scans", files=[("files", (name, b"solid a\nendsolid a\n", "model/stl"))])
        assert r.status_code == 400 and "한 덩어리" in r.json()["detail"], name
    client.post("/api/patients/P0001/scans", files=_scan_files())
    assert client.delete("/api/patients/P0001/scans/S1").json()["scans"] == []
    assert client.get("/api/cases/P0001-S1/check").status_code == 404
    assert client.delete("/api/patients/P0001").status_code == 200
    assert client.get("/api/patients/P0001").status_code == 404
