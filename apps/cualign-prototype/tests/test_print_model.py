"""Per-stage print models (#54): closed, crowns where the stage's per-tooth STLs are, gum following the crowns.

Offline. The fixture is synthetic: the moderate preset's crowns plus a generated open gum band with a socket under each
crown (the shape a segmented scan's gingiva.stl has). Real scans are not in the repo.
"""
import io
import zipfile

import numpy as np
import pytest
import trimesh
from scipy.spatial import Delaunay, cKDTree

from cualign.core import Case, plan_stages, propose_target
from cualign.core import print_model as pm
from cualign.core.planner import export_print_models, export_zip

GRID = 0.4


def _gum_band(case: Case) -> trimesh.Trimesh:
    """Open band around the crowns: sockets where the crowns stand, sloping away from them, cut off 6 mm out."""
    tops = np.concatenate([case.mesh[i].vertices for i in case.ids])
    lo, hi = tops[:, :2].min(0) - 8, tops[:, :2].max(0) + 8
    xs, ys = np.arange(lo[0], hi[0], GRID), np.arange(lo[1], hi[1], GRID)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    P = np.c_[X.ravel(), Y.ravel()]
    owner = np.repeat(case.ids, [len(case.mesh[i].vertices) for i in case.ids])
    dxy, k = cKDTree(tops[:, :2]).query(P)
    level = {i: case.mesh[i].bounds[0][2] + 1.5 for i in case.ids}      # gum line 1.5 mm up the crown
    Z = np.array([level[owner[j]] for j in k]) - 0.4 * dxy
    inside = np.zeros(len(P), bool)
    for i in case.ids:   # the socket follows the crown's cervical outline (at the gum line), not its widest outline
        v = case.mesh[i].vertices
        inside |= Delaunay(v[v[:, 2] <= level[i] + 0.5, :2]).find_simplex(P) >= 0
    keep = (dxy <= 6.0) & ~inside
    nx, ny = X.shape
    idx = np.arange(nx * ny).reshape(nx, ny)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel(), idx[:-1, 1:].ravel()
    ok = keep[a] & keep[b] & keep[c] & keep[d]
    F = np.r_[np.c_[a, b, c][ok], np.c_[a, c, d][ok]]
    m = trimesh.Trimesh(vertices=np.c_[P, Z], faces=F, process=False)
    m.remove_unreferenced_vertices()
    return m


@pytest.fixture(scope="module")
def scan(tmp_path_factory):
    """A per-tooth scan folder with gingiva.stl, loaded the way uploads are (Case.from_dir)."""
    src = Case.synthetic("moderate")
    folder = tmp_path_factory.mktemp("scan")
    for i in src.ids:
        src.mesh[i].export(folder / f"{i}.stl")
    _gum_band(src).export(folder / "gingiva.stl")
    case = Case.from_dir(folder)
    assert case.gum_scan is not None and not case.gum_scan.is_watertight   # an open band, as in a real scan
    return case


@pytest.fixture(scope="module")
def exported(scan, tmp_path_factory):
    target, _ = propose_target(scan, "extraction")          # removes 5 and 12: sockets left without a crown
    stages, _ = plan_stages(scan, target)
    path = str(tmp_path_factory.mktemp("zip") / "plan.zip")
    export_zip(scan, stages, path)
    report = export_print_models(scan, stages, path, "P0001-S1")
    return stages, path, report


def _stl(z: zipfile.ZipFile, name: str) -> trimesh.Trimesh:
    return trimesh.load(io.BytesIO(z.read(name)), file_type="stl")


def test_one_closed_binary_model_per_stage(exported):
    stages, path, report = exported
    assert report["status"] == "ok" and report["n_files"] == len(stages) > 1
    with zipfile.ZipFile(path) as z:
        names = sorted(n for n in z.namelist() if n.startswith("print_models/") and n.endswith(".stl"))
        assert names == [f"print_models/P0001-S1_U_stage{s:02d}.stl" for s in range(1, len(stages) + 1)]
        for n in names:
            raw = z.read(n)
            m = _stl(z, n)
            assert len(raw) == 84 + 50 * len(m.faces)          # binary STL
            assert m.is_watertight and m.is_volume, n


def _fit(model: trimesh.Trimesh, crown: trimesh.Trimesh) -> float:
    """90th percentile distance (mm) from the crown's upward-facing vertices to the model surface."""
    up = crown.vertices[crown.vertex_normals[:, 2] > 0.7]
    lo, hi = crown.bounds[0] - 2, crown.bounds[1] + 2
    faces = np.nonzero(np.all((model.triangles.min(1) < hi) & (model.triangles.max(1) > lo), axis=1))[0]
    pts = pm._surface_samples(model.submesh([faces], append=True), 0.1)
    return float(np.percentile(cKDTree(pts).query(up)[0], 90))


def test_crowns_in_model_match_stage_teeth(scan, exported):
    stages, path, _ = exported
    last = len(stages)
    with zipfile.ZipFile(path) as z:
        model = _stl(z, f"print_models/P0001-S1_U_stage{last:02d}.stl")
        moved = 0
        for i in stages[-1]:
            crown = _stl(z, f"stage_{last:02d}/{i}.stl")
            assert _fit(model, crown) < 0.15, i
            if np.linalg.norm(stages[-1][i]) >= 1.0:              # the unmoved crown would not fit: the check can fail
                moved += 1
                assert _fit(model, scan.mesh[i]) > 0.4, i
        assert moved >= 2
        assert 5 not in stages[-1] and 12 not in stages[-1]


def test_gum_follows_a_moved_crown_and_stays_far_away(scan):
    rig = pm.GumRig(scan)
    k = scan.ids.index(3)
    shift = np.array([1.0, 0.0, 0.0])
    disp = {i: (shift if i == 3 else np.zeros(3)) for i in scan.ids}
    moved = rig.vertices(disp) - scan.gum_scan.vertices
    d = rig.distance
    others = np.delete(d, k, axis=1).min(1)
    rim = (d[:, k] <= pm.FOLLOW_MM) & (others >= 3.0)
    far = d[:, k] >= pm.FIXED_MM
    assert rim.sum() > 5 and far.sum() > 100
    assert np.all(moved[rim] @ shift > 0.9)                      # the socket rim goes with the crown
    assert np.allclose(moved[far], 0.0)                          # gum beyond FIXED_MM stays
    mid = (d[:, k] > 2.0) & (d[:, k] < 4.0) & (others >= 4.0)
    assert np.all((moved[mid] @ shift > 0.0) & (moved[mid] @ shift < 0.9))   # in between: partly


def test_no_gingiva_is_skipped_with_reason(tmp_path):
    case = Case.synthetic("moderate")
    target, _ = propose_target(case, "expansion_ipr")
    stages, _ = plan_stages(case, target)
    path = str(tmp_path / "p.zip")
    export_zip(case, stages, path)
    report = export_print_models(case, stages, path, "moderate")
    assert report["status"] == "skipped" and report["n_files"] == 0 and "gingiva" in report["reason"]
    with zipfile.ZipFile(path) as z:
        assert not [n for n in z.namelist() if n.startswith("print_models/") and n.endswith(".stl")]
        assert "잇몸" in z.read("print_models/README.txt").decode()


def test_per_tooth_files_unchanged(scan, exported, tmp_path):
    stages, path, _ = exported
    alone = str(tmp_path / "alone.zip")
    export_zip(scan, stages, alone)
    with zipfile.ZipFile(alone) as a, zipfile.ZipFile(path) as b:
        teeth = [n for n in b.namelist() if not n.startswith("print_models/")]
        assert teeth == a.namelist()
        assert all(a.read(n) == b.read(n) for n in teeth)


def test_failed_stage_is_reported_not_written(scan, monkeypatch):
    real = pm.build_model

    def flaky(case, disp, rig=None):
        if disp is stages[0]:
            raise pm.PrintModelError("model mesh is not closed")
        return real(case, disp, rig)

    target, _ = propose_target(scan, "expansion_ipr")
    stages, _ = plan_stages(scan, target)
    stages = stages[:2]
    monkeypatch.setattr(pm, "build_model", flaky)
    files, report = pm.print_models(scan, stages, "P0001-S1")
    assert list(files) == ["P0001-S1_U_stage02.stl"]
    assert report["status"] == "partial" and report["failed"] == [{"stage": 1, "reason": "model mesh is not closed"}]
    assert "단계 01 모형 실패" in pm.readme(report)


def test_model_name_is_safe():
    assert pm.model_name("P0001-S1", 3) == "P0001-S1_U_stage03.stl"
    assert pm.model_name("synthetic:moderate", 12) == "synthetic_moderate_U_stage12.stl"
    assert pm.model_name("/tmp/cases/poseidon-000001", 1) == "poseidon-000001_U_stage01.stl"
