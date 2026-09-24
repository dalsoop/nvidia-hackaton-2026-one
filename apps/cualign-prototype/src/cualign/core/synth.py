"""Synthetic upper-arch cases. No patient data, no restricted datasets.

A case is 14 crowns (Universal 2..15) placed on a parabolic arch whose length is
shortened by `crowding_mm`, so neighbours overlap the way crowded teeth do.
Deterministic per (name, seed). Crown shapes come from real tooth templates (`templates/<id>.stl`,
CC-BY scan — see templates/ATTRIBUTION.md); if a template is missing the crown falls back to a tapered
box, which is all the planner needs: centroids, mesiodistal width, and a convex hull for collision volume.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh

TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"

from .limits import UPPER

# Mean mesiodistal (MD), buccolingual (BL) widths and crown height in mm, upper arch.
# Textbook averages (Wheeler's), rounded; used only to shape synthetic crowns.
_DIMS = {  # tooth type: (MD, BL, height)
    "central": (8.5, 7.0, 10.5),
    "lateral": (6.5, 6.0, 9.0),
    "canine": (7.5, 8.0, 10.0),
    "premolar1": (7.0, 9.0, 8.5),
    "premolar2": (6.5, 9.0, 8.0),
    "molar1": (10.0, 11.0, 7.5),
    "molar2": (9.0, 11.0, 7.0),
}
_TYPE = {2: "molar2", 3: "molar1", 4: "premolar2", 5: "premolar1", 6: "canine", 7: "lateral", 8: "central",
         9: "central", 10: "lateral", 11: "canine", 12: "premolar1", 13: "premolar2", 14: "molar1", 15: "molar2"}

# Named presets: crowding in mm (space deficit) and jitter scale.
PRESETS = {
    "aligned": dict(crowding_mm=0.0, jitter=0.15),
    "mild": dict(crowding_mm=2.0, jitter=0.3),
    "moderate": dict(crowding_mm=4.5, jitter=0.4),
    "severe": dict(crowding_mm=8.0, jitter=0.5),
    "extraction": dict(crowding_mm=10.0, jitter=0.5),
}


def _arch_xy(s: np.ndarray, half_len: float, depth: float) -> np.ndarray:
    """Map arc-length parameter s in [-half_len, half_len] onto a parabola y = depth*(1 - (x/w)^2)."""
    # numeric arc-length parameterisation of x -> (x, depth*(1-(x/w)^2)) with w chosen so total length = 2*half_len
    def length_for(w: float) -> tuple[float, np.ndarray, np.ndarray]:
        xs = np.linspace(-w, w, 4001)
        ys = depth * (1 - (xs / w) ** 2)
        seg = np.hypot(np.diff(xs), np.diff(ys))
        cum = np.concatenate([[0.0], np.cumsum(seg)])
        return cum[-1], xs, cum
    lo, hi = 5.0, 80.0
    for _ in range(60):
        w = (lo + hi) / 2
        L, xs, cum = length_for(w)
        if L < 2 * half_len:
            lo = w
        else:
            hi = w
    L, xs, cum = length_for(w)
    x = np.interp(s + L / 2, cum, xs)
    y = depth * (1 - (x / w) ** 2)
    return np.stack([x, y], axis=1)


def _crown(md: float, bl: float, h: float) -> trimesh.Trimesh:
    """Tapered box: occlusal face full size, gingival face 80%. Convex by construction."""
    top = np.array([[-md / 2, -bl / 2, 0], [md / 2, -bl / 2, 0], [md / 2, bl / 2, 0], [-md / 2, bl / 2, 0]], float)
    bot = top * np.array([0.8, 0.8, 1.0]) + np.array([0, 0, -h])
    pts = np.vstack([top, bot])
    return trimesh.convex.convex_hull(pts)


@lru_cache(maxsize=None)
def _template(i: int) -> trimesh.Trimesh | None:
    """Real crown for Universal id i (xy centred, occlusal at z=0, MD axis along x) or None."""
    f = TEMPLATE_DIR / f"{i}.stl"
    if not f.exists():
        return None
    return trimesh.load(str(f), process=True, force="mesh")


def crown_for(i: int) -> tuple[trimesh.Trimesh, float]:
    """(crown mesh copy, mesiodistal width mm) for tooth i — template if bundled, else tapered box."""
    t = _template(i)
    if t is not None:
        return t.copy(), float(t.extents[0])
    m, b, h = _DIMS[_TYPE[i]]
    return _crown(m, b, h), m


def make_case(name: str = "moderate", seed: int = 0, crowding_mm: float | None = None,
              jitter: float | None = None) -> dict[int, trimesh.Trimesh]:
    """Return {tooth_id: mesh} for the upper arch. Occlusal plane is z=0, crowns hang down (-z)."""
    preset = PRESETS.get(name, PRESETS["moderate"])
    crowding_mm = preset["crowding_mm"] if crowding_mm is None else crowding_mm
    jitter = preset["jitter"] if jitter is None else jitter
    rng = np.random.default_rng(seed)

    ids = list(UPPER)
    crowns = {i: crown_for(i) for i in ids}
    md = np.array([crowns[i][1] for i in ids])
    total = md.sum()
    # Available arch length is shorter than the sum of widths by the crowding amount.
    avail = total - crowding_mm
    # Ideal (uncrowded) slots along the arch, then compress to `avail`.
    centres = np.cumsum(md) - md / 2 - total / 2          # centred at 0
    centres = centres * (avail / total)
    xy = _arch_xy(centres, avail / 2, depth=32.0)

    meshes: dict[int, trimesh.Trimesh] = {}
    for k, i in enumerate(ids):
        crown = crowns[i][0]
        # tangent direction from neighbours -> rotate MD axis onto the arch tangent
        k0, k1 = max(k - 1, 0), min(k + 1, len(ids) - 1)
        t = xy[k1] - xy[k0]
        ang = np.arctan2(t[1], t[0]) + rng.normal(0, 0.06 * jitter * 4)
        R = trimesh.transformations.rotation_matrix(ang, [0, 0, 1])
        crown.apply_transform(R)
        jit = rng.normal(0, jitter, 2)
        crown.apply_translation([xy[k, 0] + jit[0], xy[k, 1] + jit[1], 0.0])
        meshes[i] = crown
    return meshes


def save_case(meshes: dict[int, trimesh.Trimesh], folder) -> None:
    import os
    os.makedirs(folder, exist_ok=True)
    for i, m in meshes.items():
        m.export(os.path.join(folder, f"{i}.stl"))
