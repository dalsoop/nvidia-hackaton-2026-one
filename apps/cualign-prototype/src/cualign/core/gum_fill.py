"""The scanned gingiva with its tooth trench covered, for the viewer.

A sample gingiva.stl is the gum with the teeth cut out: not one socket per tooth but one trench along the arch (its rim
is one boundary loop that hugs every crown). Once a crown moves, or is extracted, the viewer looks through that trench
into the dark inside of the mesh. Here the trench is covered by one surface interpolated from its rim, the way
print_model.py fills the sockets of the print model (`_fill`), and stitched to the gum through the rim vertices.
Display only: never part of collision checks, planning or the print model. The procedural ridge (gum.py) has no
trench and comes back unchanged.
"""
from __future__ import annotations

import numpy as np
import trimesh
from scipy.spatial import Delaunay, cKDTree

from .print_model import GRID_MM as PRINT_GRID_MM, _fill

GRID_MM = 2 * PRINT_GRID_MM   # 0.4 mm: the viewer's patch; the print model keeps its finer grid
RIM_NEAR_CROWN_MM = 2.0       # a trench rim runs along the crowns; the gum's outer edge (vestibule, palate) is far away
RIM_CLEARANCE = 0.5           # grid points closer than this (in cells) to the rim are dropped (slivers in the triangulation)


def boundary_loops(m: trimesh.Trimesh) -> list[np.ndarray]:
    """Closed chains of vertex indices along the mesh's open edges (an edge with one face)."""
    edges = m.edges_sorted
    if len(edges) == 0:
        return []
    open_edges = edges[trimesh.grouping.group_rows(edges, require_count=1)]
    nxt: dict[int, list[int]] = {}
    for a, b in open_edges:
        nxt.setdefault(int(a), []).append(int(b))
        nxt.setdefault(int(b), []).append(int(a))
    seen: set[int] = set()
    loops = []
    for start in nxt:
        if start in seen:
            continue
        loop, prev, cur = [start], -1, start
        seen.add(start)
        while True:
            cand = [n for n in nxt[cur] if n != prev and n not in seen]
            if not cand:
                break
            prev, cur = cur, cand[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) >= 3:
            loops.append(np.asarray(loop))
    return loops


def inside_polygon(points: np.ndarray, poly: np.ndarray) -> np.ndarray:
    """Even-odd test of 2D `points` (n, 2) against the closed polygon `poly` (m, 2)."""
    x, y = points[:, 0][:, None], points[:, 1][:, None]
    px, py = poly[:, 0][None, :], poly[:, 1][None, :]
    qx, qy = np.roll(poly[:, 0], -1)[None, :], np.roll(poly[:, 1], -1)[None, :]
    crosses = (py > y) != (qy > y)
    dy = np.where(qy - py == 0, 1e-12, qy - py)
    xs = px + (y - py) * (qx - px) / dy
    return (np.sum(crosses & (x < xs), axis=1) % 2) == 1


def socket_loops(gum: trimesh.Trimesh, anchors: dict[int, np.ndarray], crowns: list[trimesh.Trimesh]) -> list[tuple[np.ndarray, list[int]]]:
    """The boundary loops that are tooth trenches: their rim runs along the crowns and they enclose at least one
    tooth anchor (XY). Returns (loop vertex indices, teeth enclosed)."""
    if not crowns:
        return []
    tree = cKDTree(np.concatenate([np.asarray(c.vertices) for c in crowns]))
    ids = sorted(anchors)
    pts = np.array([anchors[i][:2] for i in ids])
    out = []
    for loop in boundary_loops(gum):
        rim = np.asarray(gum.vertices[loop])
        if np.median(tree.query(rim)[0]) > RIM_NEAR_CROWN_MM:
            continue
        teeth = [i for i, hit in zip(ids, inside_polygon(pts, rim[:, :2])) if hit]
        if teeth:
            out.append((loop, teeth))
    return out


def _raster(pts: np.ndarray, lo: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Highest z per grid vertex of this module's grid (print_model._raster uses the print grid); -inf where nothing lands."""
    H = np.full(shape, -np.inf)
    ij = np.rint((pts[:, :2] - lo) / GRID_MM).astype(int)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < shape[0]) & (ij[:, 1] >= 0) & (ij[:, 1] < shape[1])
    np.maximum.at(H, (ij[ok, 0], ij[ok, 1]), pts[ok, 2])
    return H


def _seal_triangles(m: trimesh.Trimesh) -> trimesh.Trimesh:
    """Close three-vertex holes left where the cover's triangulation skipped a cell at the rim (one triangle each)."""
    holes = [loop for loop in boundary_loops(m) if len(loop) == 3]
    if not holes:
        return m
    faces = np.vstack([np.asarray(m.faces), np.array(holes)])
    return trimesh.Trimesh(np.asarray(m.vertices), faces, process=False)


def _cover(rim: np.ndarray) -> trimesh.Trimesh | None:
    """A surface over the polygon `rim` (n, 3): grid points inside it get heights from print_model._fill (linear from
    the rim, nearest beyond), the rim vertices are kept as they are, and the whole is triangulated in XY."""
    poly = rim[:, :2]
    lo, hi = poly.min(axis=0) - 2 * GRID_MM, poly.max(axis=0) + 2 * GRID_MM
    shape = tuple((np.ceil((hi - lo) / GRID_MM) + 1).astype(int))
    known_h = _raster(rim, lo, shape)
    known = np.isfinite(known_h)
    gi, gj = np.meshgrid(np.arange(shape[0]), np.arange(shape[1]), indexing="ij")
    grid = np.stack([lo[0] + gi.ravel() * GRID_MM, lo[1] + gj.ravel() * GRID_MM], axis=1)
    want = inside_polygon(grid, poly).reshape(shape)
    H = _fill(np.where(known, known_h, -np.inf), known, want)
    keep = want & ~known & np.isfinite(H)
    far = cKDTree(poly).query(grid)[0].reshape(shape) >= RIM_CLEARANCE * GRID_MM
    keep &= far
    if not keep.any():
        return None
    inner = np.column_stack([grid[keep.ravel()], H[keep]])
    verts = np.vstack([rim, inner])
    try:
        tri = Delaunay(verts[:, :2]).simplices
    except Exception:   # noqa: BLE001 - degenerate rim: leave the trench open rather than fail the viewer
        return None
    centroids = verts[tri][:, :, :2].mean(axis=1)
    tri = tri[inside_polygon(centroids, poly)]
    if len(tri) == 0:
        return None
    return trimesh.Trimesh(verts, tri, process=False)


def _finite(m: trimesh.Trimesh) -> trimesh.Trimesh:
    """`m` without the faces that touch a non-finite vertex (poseidon-000001's gingiva.stl carries a few NaN vertices)."""
    v, fc = np.asarray(m.vertices, float), np.asarray(m.faces)
    good = np.isfinite(v).all(axis=1)
    if good.all():
        return m
    out = trimesh.Trimesh(np.where(good[:, None], v, 0.0), fc[good[fc].all(axis=1)], process=False)
    out.remove_unreferenced_vertices()
    return out


def fill_sockets(gum: trimesh.Trimesh, anchors: dict[int, np.ndarray], crowns: list[trimesh.Trimesh]) -> tuple[trimesh.Trimesh, dict]:
    """The gum with every tooth trench covered, and what was done: {filled, sockets, loops_before, loops_after}."""
    gum = _finite(gum)
    before = boundary_loops(gum)
    sockets = socket_loops(gum, anchors, crowns)
    meta = {"filled": False, "sockets": [], "loops_before": len(before), "loops_after": len(before)}
    if not sockets:
        return gum, meta
    parts, teeth = [gum], []
    for loop, enclosed in sockets:
        cover = _cover(np.asarray(gum.vertices[loop]))
        if cover is not None:
            parts.append(cover)
            teeth += enclosed
    if len(parts) == 1:
        return gum, meta
    filled = trimesh.util.concatenate(parts)
    filled.merge_vertices()
    filled = _seal_triangles(filled)
    meta.update({"filled": True, "sockets": sorted(set(teeth)), "loops_after": len(boundary_loops(filled))})
    return filled, meta


def covers_xy(m: trimesh.Trimesh, points: np.ndarray) -> np.ndarray:
    """Whether a vertical line through each XY point (n, 2) meets a face of `m` (a hole test that needs no ray tracer)."""
    tri = np.asarray(m.triangles)[:, :, :2]
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    out = np.zeros(len(points), bool)
    for k, p in enumerate(points):
        d1 = (b[:, 0] - a[:, 0]) * (p[1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (p[0] - a[:, 0])
        d2 = (c[:, 0] - b[:, 0]) * (p[1] - b[:, 1]) - (c[:, 1] - b[:, 1]) * (p[0] - b[:, 0])
        d3 = (a[:, 0] - c[:, 0]) * (p[1] - c[:, 1]) - (a[:, 1] - c[:, 1]) * (p[0] - c[:, 0])
        out[k] = bool(np.any(((d1 >= 0) & (d2 >= 0) & (d3 >= 0)) | ((d1 <= 0) & (d2 <= 0) & (d3 <= 0))))
    return out


def to_json(m: trimesh.Trimesh) -> dict:
    return {"v": np.round(np.asarray(m.vertices), 3).tolist(), "f": np.asarray(m.faces).tolist()}
