"""Turn Poseidon3D intra-oral scans into cuAlign per-tooth cases (upper arch).

Poseidon3D (Kubik & Spanel, Bioengineering 2024, CC-BY-4.0, https://zenodo.org/records/15608906) ships one full-arch
scan per case (teeth + gingiva in one mesh) with a tooth label for every face. cuAlign's core expects one STL per
tooth named by Universal number, occlusal plane at z=0 with crowns hanging towards -z. This script splits the scan
by label and rotates it into that frame.

  uv run python scripts/import_poseidon.py 000001 999983 000037            # reads only these cases from Zenodo
  uv run python scripts/import_poseidon.py --zip poseidon3d.zip 000001     # or from a local copy of the zip

Output: data/cases/poseidon-<id>/{2..15}.stl, gingiva.stl (trimmed band for display), gingiva_raw.stl, SOURCE.txt
(git-ignored; data is not committed). The trimmed gingiva keeps a band around the crowns and drops the plaster
base walls and the palate, which many of these model scans include.
Load it with `CUALIGN_CASE_DIR=data/cases/poseidon-<id> uv run cualign serve` (case "scan") or the upload API.
"""
from __future__ import annotations

import argparse
import http.client
import io
import json
import pickle
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import trimesh

URL = "https://zenodo.org/records/15608906/files/poseidon3d.zip?download=1"
OUT = Path(__file__).resolve().parents[1] / "data" / "cases"
GINGIVA = 17
GUM_BAND_MM = 6.0      # keep gingiva within this distance of a crown
GUM_DEPTH_MM = 6.0     # ... and no deeper than this below the lowest crown point
GUM_FACES = 25000      # decimate the display gingiva to about this many faces
CREDIT = ("Poseidon3D dataset by Tibor Kubik and Michal Spanel, \"Addressing Challenging Teeth Segmentation Cases "
          "in 3D Dental Surface Orthodontic Scans\", Bioengineering 11(10):1014, 2024 "
          "(https://doi.org/10.3390/bioengineering11101014), data https://zenodo.org/records/15608906, CC-BY-4.0.")


class RangeFile(io.RawIOBase):
    """Seekable read-only view of a remote file via HTTP range requests (zip central directory + chosen members)."""

    def __init__(self, url: str):
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
            self.size = int(r.headers["Content-Length"])
            self.url = r.geturl()
        self.pos = 0

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        end = min(self.pos + len(b), self.size) - 1
        for attempt in range(6):
            try:
                req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                break
            except (http.client.IncompleteRead, OSError):
                time.sleep(1 + attempt)
        else:
            raise OSError("range request failed")
        b[:len(data)] = data
        self.pos += len(data)
        return len(data)


def open_zip(local: str | None) -> zipfile.ZipFile:
    if local:
        return zipfile.ZipFile(local)
    return zipfile.ZipFile(io.BufferedReader(RangeFile(URL), buffer_size=1 << 20))


def _rotation_to_z(n: np.ndarray) -> np.ndarray:
    """Rotation matrix taking unit vector n onto +z (Rodrigues)."""
    z = np.array([0.0, 0.0, 1.0])
    v, c = np.cross(n, z), float(np.dot(n, z))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k * (1.0 / (1.0 + c))


def _anterior_to_y(verts: np.ndarray, faces: np.ndarray, teeth: dict[int, np.ndarray]) -> tuple[np.ndarray, bool]:
    """Rotation about z that points the arch's front (central incisors) to +y, as the core and the viewer expect, and
    whether the numbering runs the other way round.

    Front = from the midpoint of the two most distal teeth to the most mesial ones (8/9 when present). In the core's
    right-handed frame (+y anterior, +z occlusal) +x is the patient's left, so Universal 2 must sit at -x. When the
    lowest-numbered tooth lands at +x instead, the labels run left-to-right the other way (true for every Poseidon3D
    maxilla checked: 000001, 999983, 000037). A mirrored scan and swapped side labels cannot be told apart on an arch
    (each tooth's mirror image is its opposite number), so the caller renumbers instead of mirroring the mesh.
    """
    cen = {u: verts[np.unique(faces[f])][:, :2].mean(0) for u, f in teeth.items()}
    ids = sorted(cen)
    front = [u for u in (8, 9) if u in cen] or [min(ids, key=lambda u: abs(u - 8.5))]
    back = (cen[ids[0]] + cen[ids[-1]]) / 2
    d = np.mean([cen[u] for u in front], axis=0) - back
    a = np.pi / 2 - np.arctan2(d[1], d[0])
    R = np.array([[np.cos(a), -np.sin(a), 0.0], [np.sin(a), np.cos(a), 0.0], [0.0, 0.0, 1.0]])
    swapped = bool((R[:2, :2] @ cen[ids[0]])[0] > (R[:2, :2] @ cen[ids[-1]])[0])
    return R, swapped


def trim_gingiva(verts: np.ndarray, gum_faces: np.ndarray, tooth_verts: np.ndarray) -> trimesh.Trimesh:
    """Band of gingiva around the crowns: drops the model base walls and the palate, then decimates for display."""
    from scipy.spatial import cKDTree

    g = trimesh.Trimesh(verts, gum_faces, process=False)
    d, _ = cKDTree(tooth_verts).query(g.triangles_center)
    keep = (d <= GUM_BAND_MM) & (g.triangles_center[:, 2] >= tooth_verts[:, 2].min() - GUM_DEPTH_MM)
    band = trimesh.Trimesh(verts, gum_faces[keep], process=True)
    parts = band.split(only_watertight=False)
    if len(parts) > 1:   # drop small islands left by the cut
        big = max(len(p.faces) for p in parts)
        band = trimesh.util.concatenate([p for p in parts if len(p.faces) >= 0.05 * big])
    if len(band.faces) > GUM_FACES:
        band = band.simplify_quadric_decimation(face_count=GUM_FACES)
    return band


def convert(z: zipfile.ZipFile, meta: dict, out_root: Path) -> Path:
    cid = meta["id"]
    mapping = meta["maxilla_region_mapping"]            # index = Universal number (1..16), value = face label
    stl_name = next(p for p in meta["maxilla_paths"] if p.endswith(".stl"))
    labels_name = f"data/{cid}/{cid}_REGIONS_FACES_maxilla.pkl"
    mesh = trimesh.load(io.BytesIO(z.read(stl_name)), file_type="stl", process=True)
    labels = np.asarray(pickle.loads(z.read(labels_name)))
    if len(labels) != len(mesh.faces):
        raise ValueError(f"{cid}: {len(labels)} labels for {len(mesh.faces)} faces")

    teeth = {u: np.flatnonzero(labels == lab) for u, lab in enumerate(mapping) if lab is not None and lab >= 0}
    centroids = np.array([mesh.triangles_center[f].mean(0) for f in teeth.values()])
    gum = mesh.triangles_center[labels == GINGIVA].mean(0)

    # Arch plane from the tooth centroids; occlusal side (+z) is the side away from the gingiva.
    c0 = centroids.mean(0)
    n = np.linalg.svd(centroids - c0)[2][2]
    if np.dot(gum - c0, n) > 0:
        n = -n
    R = _rotation_to_z(n)
    verts = (mesh.vertices - c0) @ R.T
    tops = [verts[np.unique(mesh.faces[f])][:, 2].max() for f in teeth.values()]
    verts[:, 2] -= float(np.median(tops))                 # occlusal plane at z = 0
    R2, swapped = _anterior_to_y(verts, mesh.faces, teeth)
    verts = verts @ R2.T
    if swapped:                                           # Universal: 1..16 = patient's right to left
        teeth = {17 - u: f for u, f in teeth.items()}

    out = out_root / f"poseidon-{cid}"
    out.mkdir(parents=True, exist_ok=True)
    for u, f in teeth.items():
        sub = trimesh.Trimesh(verts, mesh.faces[f], process=False)
        sub.remove_unreferenced_vertices()
        sub.export(out / f"{u}.stl")
    gum_faces = mesh.faces[labels == GINGIVA]
    g = trimesh.Trimesh(verts, gum_faces, process=False)
    g.remove_unreferenced_vertices()
    g.export(out / "gingiva_raw.stl")
    tooth_verts = verts[np.unique(np.concatenate([mesh.faces[f].ravel() for f in teeth.values()]))]
    trim_gingiva(verts, gum_faces, tooth_verts).export(out / "gingiva.stl")
    note = "tooth labels renumbered u -> 17 - u (dataset order runs opposite to Universal in this frame)\n" if swapped else ""
    (out / "SOURCE.txt").write_text(f"Poseidon3D case {cid} (maxilla), teeth {sorted(teeth)}\n{note}{CREDIT}\n", encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="+", help="Poseidon3D case ids, e.g. 000001")
    ap.add_argument("--zip", help="local poseidon3d.zip instead of reading from Zenodo")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args(argv)
    z = open_zip(args.zip)
    metas = {m["id"]: m for m in json.loads(z.read("data/metadata.json"))}
    for cid in args.cases:
        m = metas.get(cid)
        if not m or not m.get("maxilla_paths") or not m.get("maxilla_region_mapping"):
            print(f"[skip] {cid}: no labelled maxilla scan"); continue
        t0 = time.time()
        out = convert(z, m, Path(args.out))
        print(f"[ok] {cid} -> {out} ({len(list(out.glob('[0-9]*.stl')))} teeth, {time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
