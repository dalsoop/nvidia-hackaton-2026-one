"""Upload filenames accept FDI stems too (#113): the dentist reads and writes FDI, the app still stores and plans
in Universal. A batch is FDI when any stem is one only FDI has (17·18, 21..28); otherwise Universal
(see api._scan_file_name)."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import store
from cualign.server import api
from cualign.server.api import _scan_file_name

# universal id -> its FDI number, for the ids this app plans with (2..15; 1 and 16, the third molars, are unsupported)
FDI_OF = {2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11, 9: 21, 10: 22, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27}


def test_scan_file_name_reads_the_batch_as_fdi_or_universal():
    from cualign.server.api import _batch_is_fdi
    fdi_arch = [f"{n}.stl" for n in (17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27)]
    assert _batch_is_fdi(fdi_arch) and not _batch_is_fdi([f"{n}.stl" for n in range(2, 16)])
    stored = [_scan_file_name(n, fdi=True)[0] for n in fdi_arch]
    assert stored == [f"{n}.stl" for n in range(2, 16)]            # FDI 17…11 · 21…27 → Universal 2…15, no duplicates
    assert _scan_file_name("18.stl", fdi=True) == ("1.stl", "tooth") and _scan_file_name("28.stl", fdi=True) == ("16.stl", "tooth")
    assert _scan_file_name("36.stl", fdi=True) == (None, "lower")     # FDI lower arch, not supported
    assert _scan_file_name("11.stl") == ("11.stl", "tooth")            # Universal batch: 11 is the app's 11
    assert _scan_file_name("20.stl") == (None, "lower")                # Universal lower


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "OUT_DIR", tmp_path)
    s = store.STORE
    for d in (s.cases, s.case_constraints, s.targets, s.plans):
        d.clear()
    s.active_case = None
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as c:
        yield c


def _scan_files(ids, rename=None):
    from cualign.core.case import Case
    meshes = {i: m for i, m in Case.synthetic("mild").mesh.items() if i in ids}
    out = []
    for i, m in meshes.items():
        name = f"{(rename or (lambda u: u))(i)}.stl"
        out.append(("files", (name, m.export(file_type="stl"), "model/stl")))
    return out


def test_fdi_named_upload_gets_the_same_scan_as_universal_named(client):
    # a subset clear of the 11..16 collision zone: teeth 2 and 9..15 (FDI 17, 21..27)
    ids = [2, 9, 10, 11, 12, 13, 14, 15]
    fdi_files = _scan_files(ids, rename=lambda u: FDI_OF[u])
    universal_files = _scan_files(ids)

    client.post("/api/patients", json={"alias": "FDI 업로드"})
    a = client.post("/api/patients/P0001/scans", files=fdi_files).json()
    client.post("/api/patients", json={"alias": "Universal 업로드"})
    b = client.post("/api/patients/P0002/scans", files=universal_files).json()

    assert a["check"]["n_teeth"] == b["check"]["n_teeth"] == len(ids)
    assert a["check"]["missing"] == b["check"]["missing"]
    # both scans read as the same teeth (Universal ids on disk), whichever filename convention was uploaded
    check_a = client.get(f"/api/cases/{a['case_id']}/check").json()
    check_b = client.get(f"/api/cases/{b['case_id']}/check").json()
    assert check_a["teeth"] == check_b["teeth"] == sorted(ids)
