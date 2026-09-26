"""Occlusal thumbnails of the sample cases for the start screen (#46).

  uv run --extra render python scripts/render_sample_thumbs.py

Writes src/cualign/server/static/samples/<case_id>.png (committed). The view is the app's occlusal view: from above
(+z), incisors at the top, the patient's right (tooth 2) on the left. Flat-shaded triangles drawn far to near.
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


def render(sample: samples.Sample, out: Path) -> None:
    parts = [_polys(trimesh.load(sample.folder / f"{i}.stl", force="mesh"), TOOTH, 4000)
             for i in range(2, 16) if (sample.folder / f"{i}.stl").exists()]
    gum = sample.folder / "gingiva.stl"
    if gum.exists():
        parts.append(_polys(trimesh.load(gum, force="mesh"), GUM, 20000))
    xy = np.concatenate([p[0] for p in parts])
    z = np.concatenate([p[1] for p in parts])
    rgb = np.concatenate([p[2] for p in parts])
    order = np.argsort(z)                                  # far (low) first, near (high) last
    fig = plt.figure(figsize=(SIZE_PX[0] / DPI, SIZE_PX[1] / DPI), dpi=DPI, facecolor=BG)
    ax = fig.add_axes((0, 0, 1, 1))
    ax.set_facecolor(BG)
    ax.add_collection(PolyCollection(xy[order], facecolors=rgb[order], edgecolors="none", antialiased=False))
    lo, hi = xy.reshape(-1, 2).min(0), xy.reshape(-1, 2).max(0)
    pad = 0.06 * (hi - lo).max()
    ax.set_xlim(lo[0] - pad, hi[0] + pad)
    ax.set_ylim(lo[1] - pad, hi[1] + pad)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.savefig(out, dpi=DPI, facecolor=BG)
    plt.close(fig)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for s in samples.SAMPLES.values():
        if not s.available:
            print(f"skip {s.case_id}: not installed")
            continue
        out = OUT / f"{s.case_id}.png"
        render(s, out)
        print(f"{out.relative_to(APP)}  {out.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
