"""Occlusal thumbnails of the sample cases for the start screen (#46).

  uv run --extra render python scripts/render_sample_thumbs.py

Writes src/cualign/server/static/samples/<case_id>.png (committed). The view is the app's occlusal view: from above
(+z), incisors at the top, the patient's right (tooth 2) on the left. Flat-shaded triangles drawn far to near.
All samples share one scale and are centred, with the arch's wide axis turned horizontal, so the cards line up (#90).
"""
from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import trimesh  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / "src"))
from cualign.core import samples  # noqa: E402

OUT = APP / "src" / "cualign" / "server" / "static" / "samples"
TOOTH, GUM, BG = np.array([0xE9, 0xE3, 0xD6]) / 255, np.array([0xD9, 0x8B, 0x8F]) / 255, "#000000"   # DESIGN.md
LIGHT = np.array([0.3, -0.4, 1.0]) / np.linalg.norm([0.3, -0.4, 1.0])
SIZE_PX, DPI = (480, 360), 120


def _polys(mesh: trimesh.Trimesh, colour: np.ndarray, faces: int):
    if len(mesh.faces) > faces:
        mesh = mesh.simplify_quadric_decimation(face_count=faces)
    tri = mesh.triangles
    up = mesh.face_normals[:, 2] > 0                     # seen from above
    shade = 0.35 + 0.65 * np.clip(mesh.face_normals @ LIGHT, 0, 1)
    return tri[up][:, :, :2], tri[up][:, :, 2].mean(1), colour * shade[up, None]


def load(sample: samples.Sample):
    """Triangles of one arch, centred on the tooth bounding box and turned so the arch's wide axis is horizontal."""
    parts = [_polys(trimesh.load(sample.folder / f"{i}.stl", force="mesh"), TOOTH, 4000)
             for i in range(2, 16) if (sample.folder / f"{i}.stl").exists()]
    teeth_xy = np.concatenate([p[0] for p in parts]).reshape(-1, 2)
    gum = sample.folder / "gingiva.stl"
    if gum.exists():
        parts.append(_polys(trimesh.load(gum, force="mesh"), GUM, 20000))
    xy = np.concatenate([p[0] for p in parts])
    z = np.concatenate([p[1] for p in parts])
    rgb = np.concatenate([p[2] for p in parts])
    centre = (teeth_xy.min(0) + teeth_xy.max(0)) / 2
    # the wide axis (left–right) is the first principal direction of the tooth points; keep it within ±45°
    vx, vy = np.linalg.svd(teeth_xy - teeth_xy.mean(0), full_matrices=False)[2][0]
    ang = np.arctan2(vy, vx)
    ang = (ang + np.pi / 2) % np.pi - np.pi / 2
    c, s = np.cos(-ang), np.sin(-ang)
    xy = (xy - centre) @ np.array([[c, -s], [s, c]]).T
    return xy, z, rgb


def draw(xy, z, rgb, half: float, out: Path) -> None:
    order = np.argsort(z)                                  # far (low) first, near (high) last
    fig = plt.figure(figsize=(SIZE_PX[0] / DPI, SIZE_PX[1] / DPI), dpi=DPI, facecolor=BG)
    ax = fig.add_axes((0, 0, 1, 1))
    ax.set_facecolor(BG)
    ax.add_collection(PolyCollection(xy[order], facecolors=rgb[order], edgecolors="none", antialiased=False))
    ax.set_xlim(-half * SIZE_PX[0] / SIZE_PX[1], half * SIZE_PX[0] / SIZE_PX[1])
    ax.set_ylim(-half, half)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.savefig(out, dpi=DPI, facecolor=BG)
    plt.close(fig)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    arches = {}
    for s in samples.SAMPLES.values():
        if not s.available:
            print(f"skip {s.case_id}: not installed")
            continue
        arches[s.case_id] = load(s)
    if not arches:
        return 0
    half = 1.06 * max(np.abs(a[0]).max() for a in arches.values())   # one scale for every card
    for case_id, (xy, z, rgb) in arches.items():
        out = OUT / f"{case_id}.png"
        draw(xy, z, rgb, half, out)
        print(f"{out.relative_to(APP)}  {out.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
