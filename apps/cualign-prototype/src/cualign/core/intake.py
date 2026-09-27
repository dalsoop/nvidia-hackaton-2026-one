"""Put an uploaded per-tooth scan into the core's frame before anything measures it.

Per-tooth STLs exported from dental software keep the scanner's coordinates. The core assumes the upper arch with the
occlusal side toward +z, the occlusal plane at z = 0 and the incisors toward +y (Universal 2 at −x); heights, the
viewer and the left/right check all depend on it. The tooth numbers in the file names give the arch; the occlusal side
comes from, in order of preference:

1. gingiva.stl — the gum lies on the root side of the crowns;
2. the crowns' open cervical margins — a segmented crown is open where it was cut from the gum, and the crown lies on
   the occlusal side of that edge;
3. nothing — closed crowns and no gum: the input's +z is kept and the result says so.

The originals are kept in original/ next to the aligned files. Only a rotation and a translation are applied (never a
mirror), so a scan whose numbers run the other way stays that way and is reported as "reversed" for the dentist to fix.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import trimesh

MIN_TEETH = 3


def _rotation_to_z(n: np.ndarray) -> np.ndarray:
    z = np.array([0.0, 0.0, 1.0])
    v, c = np.cross(n, z), float(n @ z)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k / (1.0 + c)


def _surface_centroid(m: trimesh.Trimesh) -> np.ndarray:
    return np.average(m.triangles_center, axis=0, weights=m.area_faces)


def _cervical_votes(teeth: dict[int, trimesh.Trimesh], n: np.ndarray) -> tuple[int, int]:
    """(+1 votes, −1 votes) for "n points from the cut edge to the crown", from teeth that have an open edge."""
    plus = minus = 0
    for m in teeth.values():
        edges = m.edges_sorted
        uniq, count = np.unique(edges, axis=0, return_counts=True)
        rim = uniq[count == 1]
        if len(rim) < 6:
            continue
        b = m.vertices[np.unique(rim)].mean(0)
        s = float((_surface_centroid(m) - b) @ n)
        plus += s > 0
        minus += s < 0
    return plus, minus


def orient_scan(folder: str | Path) -> dict:
    folder = Path(folder)
    files = {int(p.stem): p for p in folder.glob("*.stl") if p.stem.isdigit()}
    gum_file = folder / "gingiva.stl"
    if len(files) < MIN_TEETH:
        return {"basis": "none", "note": f"치아 {len(files)}개 — 방향을 정할 수 없어 입력 방향 그대로 둠", "side": "unknown",
                "rotation_deg": 0.0}
    teeth = {i: trimesh.load(p, process=True, force="mesh") for i, p in files.items()}
    gum = trimesh.load(gum_file, process=True, force="mesh") if gum_file.exists() else None

    # the frame comes from the planned teeth (Universal 2..15); third molars 1/16 are moved along but do not steer it
    ids = sorted(i for i in teeth if 2 <= i <= 15)
    if len(ids) < MIN_TEETH:
        ids = sorted(teeth)
    cen = np.array([_surface_centroid(teeth[i]) for i in ids])
    c0 = cen.mean(0)
    n = np.linalg.svd(cen - c0)[2][2]
    basis = "none"
    if gum is not None and len(gum.faces):
        basis = "gingiva"
        if (_surface_centroid(gum) - c0) @ n > 0:
            n = -n
    else:
        plus, minus = _cervical_votes({i: teeth[i] for i in ids}, n)
        if plus + minus >= max(MIN_TEETH, len(ids) // 2) and plus != minus:
            basis = "cervical"
            if minus > plus:
                n = -n
        elif n[2] < 0:          # no evidence: assume the input's +z is the occlusal side
            n = -n
    R = _rotation_to_z(n)
    P = (cen - c0) @ R.T
    mid = [k for k, i in enumerate(ids) if i in (8, 9, 24, 25)] or [int(np.argmin([abs(i - 8.5) for i in ids]))]
    front = P[mid, :2].mean(0) - (P[0, :2] + P[-1, :2]) / 2
    a = np.pi / 2 - np.arctan2(front[1], front[0])
    Rz = np.array([[np.cos(a), -np.sin(a), 0.0], [np.sin(a), np.cos(a), 0.0], [0.0, 0.0, 1.0]])
    M = Rz @ R
    T = np.eye(4)
    T[:3, :3] = M
    T[:3, 3] = -M @ c0
    tops = [float((teeth[i].vertices @ M.T + T[:3, 3])[:, 2].max()) for i in ids]
    T[2, 3] -= float(np.median(tops))                      # occlusal plane at z = 0

    orig = folder / "original"
    if not orig.exists():
        orig.mkdir()
        for p in [*files.values(), *([gum_file] if gum is not None else [])]:
            shutil.copy2(p, orig / p.name)
    for i, m in teeth.items():
        m.apply_transform(T)
        m.export(files[i])
    if gum is not None:
        gum.apply_transform(T)
        gum.export(gum_file)

    lo, hi = (cen[0] - c0) @ M.T, (cen[-1] - c0) @ M.T
    side = "reversed" if lo[0] > hi[0] else "ok"
    angle = float(np.degrees(np.arccos(np.clip((np.trace(M) - 1) / 2, -1, 1))))
    out = {"basis": basis, "side": side, "rotation_deg": round(angle, 1), "transform": np.round(T, 6).tolist()}
    if basis == "none":   # no gum and no cut rims to vote on: the input's +z stays up (v2 board 09-c wording, #112)
        out["note"] = f"치아 {len(ids)}개 — 방향을 정할 수 없어 입력 방향 그대로 둠"
    return out


def mirror_numbers(folder: str | Path) -> list[int]:
    """Renumber the tooth files u -> 17 - u (the dentist found the numbers running the other way)."""
    folder = Path(folder)
    files = sorted(p for p in folder.glob("*.stl") if p.stem.isdigit())
    tmp = [p.rename(p.with_name(f"_{17 - int(p.stem)}.stl")) for p in files]
    for p in tmp:
        p.rename(p.with_name(p.name[1:]))
    return sorted(17 - int(p.stem) for p in files)
