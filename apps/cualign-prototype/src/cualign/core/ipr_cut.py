"""Interproximal reduction (IPR) applied to the crown meshes (#62).

The planner lays crowns out as if IPR had narrowed them; the meshes stayed whole, so the 3D view, the exported STLs
and the collision check did not see the stripping and IPR contacts could overlap (#61). IPR is done at the start of
treatment, so the cut crowns are a second dentition next to the untouched scan: `cut_ipr` returns a derived Case whose
`mesh` holds the cut crowns (the original Case is not changed), with what was cut in `ipr_cut`.

Input is a list of contact surfaces `(tooth_a, tooth_b, mm)`: the amount taken off that contact in total, split half
per tooth (dentist's rule: 11-21 0.4 mm -> 0.2 off each). A tooth in `exclude` is not touched and its partner takes
the whole amount (the planner counts the span tooth's distal half at the 16|15 contact while the molar keeps its
width). Later per-contact prescriptions (#57) only change where the list comes from.

Each cut is one plane: perpendicular to the crown's mesiodistal axis (the arch tangent for every crown but a rotated
incisor, case._md_axis), vertical (the crown's long axis and the gum direction are left alone), placed `depth` inside
the crown's proximal extreme, so the contact width drops by `depth`. The extreme is read in the crown's central bucco-lingual band, where the contact is and where the width is
measured (case.contact_width); a flared corner beyond the band is flattened with it, as a stripping disc does.
Scanned crowns are open at the cervical margin, so before slicing the crown is closed there (fan fill of every
boundary loop); after slicing the planar section is closed the same way. The cut crown is therefore watertight, the
untouched crowns are left as they came.
"""
from __future__ import annotations

import numpy as np
import trimesh

from .case import CONTACT_BAND, Case

Surface = tuple[int, int, float]
PLANE_TOL = 1e-4        # a vertex this close to the cut plane (mm) lies on the cap
CAP_TOL_DECIMATED = 0.02   # ... on a decimated copy (quadric collapses move cap vertices by a few µm)
MIN_CUT_MM = 1e-3       # amounts below this are no cut


def _boundary_loops(mesh: trimesh.Trimesh) -> list[np.ndarray]:
    """Directed boundary edges (as they run in their face) chained into loops of vertex indices."""
    edges = np.asarray(mesh.edges)
    _, inv, counts = np.unique(mesh.edges_sorted, axis=0, return_inverse=True, return_counts=True)
    single = edges[counts[inv.ravel()] == 1]
    nxt = {int(a): int(b) for a, b in single}
    loops = []
    while nxt:
        a0, b = next(iter(nxt.items()))
        loop = [a0]
        del nxt[a0]
        while b != a0 and b in nxt:
            loop.append(b)
            b = nxt.pop(b)
        loops.append(np.array(loop))
    return loops


def _fill_loops(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Close every boundary loop with a fan to its centroid (boundary edge a->b in its face -> triangle (b, a, c))."""
    loops = _boundary_loops(mesh)
    if not loops:
        return mesh
    V, F = [np.asarray(mesh.vertices, float)], [np.asarray(mesh.faces)]
    n = len(mesh.vertices)
    for loop in loops:
        if len(loop) < 3:
            continue
        V.append(mesh.vertices[loop].mean(0)[None])
        F.append(np.c_[np.roll(loop, -1), loop, np.full(len(loop), n)])
        n += 1
    out = trimesh.Trimesh(vertices=np.vstack(V), faces=np.vstack(F), process=False)
    if out.volume < 0:
        out.invert()
    return out


# The view's closing of a scanned crown (#163, redone): a flat fan read as a dark cut face and its normals folded against
# the crown wall. The margin is continued instead as a short root stub — rings pushed ROOT_STUB_MM along the tooth axis,
# tapering, closed by a subdivided dome — so the wall runs on and the shading with it. A margin that is split in two or
# too short gets a dome cap smoothed in place. _fill_loops (the IPR cut's closing, core geometry) is not this.
ROOT_STUB_MM = 2.5
STUB_RINGS = ((0.6, 0.95), (1.3, 0.90), (1.9, 0.85))      # (depth mm, radial scale) of the tapered rings
STUB_DOME = ((35, 0.35), (65, 0.35))                       # dome rings: angle° from the last ring, and that ring's share
MIN_STUB_LOOP = (12, 8.0)                                  # fewer vertices or a shorter perimeter (mm) -> dome fallback
ROOT_DIR = np.array([0.0, 0.0, -1.0])                      # opposite the occlusal normal (upper arch: roots are -z)


def _loop_closed(loop: np.ndarray, boundary: set) -> bool:
    return len(loop) >= 3 and (int(loop[-1]), int(loop[0])) in boundary


def _tooth_axis(V: np.ndarray, P: np.ndarray) -> np.ndarray:
    """Crown centre -> margin centre; the fixed root direction when that leans more than 60° from it (a crown whose
    margin sits to the side, e.g. a tipped molar)."""
    ax = P.mean(0) - V.mean(0)
    n = np.linalg.norm(ax)
    if n < 1e-6 or ax @ ROOT_DIR / n < 0.5:
        return ROOT_DIR.copy()
    return ax / n


def _rings(P: np.ndarray, axis: np.ndarray, rings) -> np.ndarray:
    """Rings below the margin P (n,3): each (depth below the margin's deepest point, radial scale). The margin is
    scalloped (it rises between the teeth); that rise fades out ring by ring, so every ring lies below its own margin
    point and the last is level. The margin is averaged with its neighbours once first, so the stub starts smooth
    under a jagged scan edge. Returns the ring points (k*n, 3) and the level of the deepest margin point (along axis,
    from the margin's centre)."""
    Q = (np.roll(P, 1, 0) + P + np.roll(P, -1, 0)) / 3
    c = Q.mean(0)
    r = Q - c
    a = r @ axis
    rad = r - np.outer(a, axis)
    top = a.max()
    out = [c + axis * (top + d) + rad * s + np.outer((a - top) * (1 - (i + 1) / len(rings)), axis)
           for i, (d, s) in enumerate(rings)]
    return np.vstack(out), c + axis * top


def _band_faces(loop: np.ndarray, first: int, n_rings: int, apex: int) -> np.ndarray:
    """Faces from the margin (loop, directed as its edges run in their faces) through n_rings new rings of len(loop)
    points starting at index `first`, then a fan to the apex. Edge a->b of the margin gets (b, a, a'), (b, a', b'): the
    new faces wind against the old ones, so the closed shell keeps one orientation."""
    n = len(loop)
    rows = [np.asarray(loop)] + [first + k * n + np.arange(n) for k in range(n_rings)]
    F = []
    for top, low in zip(rows, rows[1:]):
        a, b, a2, b2 = top, np.roll(top, -1), low, np.roll(low, -1)
        F += [np.c_[b, a, a2], np.c_[b, a2, b2]]
    last = rows[-1]
    F.append(np.c_[np.roll(last, -1), last, np.full(n, apex)])
    return np.vstack(F)


def _laplace(V: np.ndarray, F: np.ndarray, free: np.ndarray, times: int = 3) -> None:
    """Average each free vertex with its neighbours in F, `times` times (the margin, not free, stays put)."""
    nb: dict[int, set] = {int(i): set() for i in free}
    for f in F:
        for i in f:
            if int(i) in nb:
                nb[int(i)].update(int(j) for j in f if j != i)
    for _ in range(times):
        V[free] = np.array([V[list(nb[int(i)])].mean(0) for i in free])


def closed_json(t: dict) -> tuple[dict, str]:
    """A crown as the viewer gets it ({v, f}) with its open cervical margin closed, so a crown whose side is bared (a
    neighbour extracted or moved away) shows no hole, and no flat dark cut either: one margin loop gets a root stub
    ("stub"), a split or short margin a smoothed dome ("dome"); a crown with no open edge comes back as it is
    ("closed"). The margin's own vertices are shared by the new faces (the normals run across the seam), and the new
    vertices and faces come after the old ones, so indices into `v` and `f` stay valid. For the view only: the core
    measures the crowns as they came."""
    mesh = trimesh.Trimesh(np.asarray(t["v"], float), np.asarray(t["f"]), process=False)
    loops = [lp for lp in _boundary_loops(mesh) if len(lp) >= 3]
    if not loops:
        return t, "closed"
    V0 = np.asarray(mesh.vertices, float)
    _, inv, cnt = np.unique(mesh.edges_sorted, axis=0, return_inverse=True, return_counts=True)
    boundary = {(int(a), int(b)) for a, b in np.asarray(mesh.edges)[cnt[inv.ravel()] == 1]}
    per = [np.linalg.norm(np.diff(V0[np.r_[lp, lp[:1]]], axis=0), axis=1).sum() for lp in loops]
    stub = (len(loops) == 1 and len(loops[0]) >= MIN_STUB_LOOP[0] and per[0] >= MIN_STUB_LOOP[1]
            and _loop_closed(loops[0], boundary))
    V, F, free = [V0], [np.asarray(mesh.faces)], []
    n = len(V0)
    for lp in loops:
        P = V0[lp]
        axis = _tooth_axis(V0, P)
        if stub:
            d, s = STUB_RINGS[-1]
            h = ROOT_STUB_MM - d
            rings = list(STUB_RINGS) + [(d + h * np.sin(np.radians(g)), s * np.cos(np.radians(g))) for g, _ in STUB_DOME]
            apex_depth = ROOT_STUB_MM
        else:
            # a low dome over the margin: height a quarter of its mean radius, three rings in, smoothed after
            R = np.linalg.norm((P - P.mean(0)) - np.outer((P - P.mean(0)) @ axis, axis), axis=1).mean()
            h = 0.25 * R
            rings = [(h * np.sqrt(1 - s * s), s) for s in (0.75, 0.5, 0.25)]
            apex_depth = h
        ring_pts, level = _rings(P, axis, rings)
        apex = level + axis * apex_depth
        first = n
        V += [ring_pts, apex[None]]
        n += len(ring_pts) + 1
        F.append(_band_faces(lp, first, len(rings), n - 1))
        if not stub:
            free.append(np.arange(first, n))
    V, F = np.vstack(V), np.vstack(F)
    if free:
        _laplace(V, F[len(mesh.faces):], np.concatenate(free))
    return {"v": np.round(V, 3).tolist(), "f": F.tolist()}, ("stub" if stub else "dome")


def _slice(mesh: trimesh.Trimesh, n: np.ndarray, c: float) -> trimesh.Trimesh:
    """The part of the mesh with x.n <= c; crossing triangles are clipped on the plane (new vertices shared along
    edges so the section is a chain of boundary edges). trimesh's slice_mesh_plane needs shapely, which is not a
    dependency here."""
    V = np.asarray(mesh.vertices, float)
    F = np.asarray(mesh.faces)
    d = c - V @ n                              # >= 0: kept side
    inside = d >= 0
    k = inside[F].sum(axis=1)
    keep = [F[k == 3]]
    verts = [V]
    new: dict[tuple[int, int], int] = {}
    count = len(V)

    def cross(u: int, v: int) -> int:
        if d[u] == 0:
            return u
        if d[v] == 0:
            return v
        key = (min(u, v), max(u, v))
        if key not in new:
            nonlocal count
            t = d[u] / (d[u] - d[v])
            verts.append((V[u] + t * (V[v] - V[u]))[None])
            new[key] = count
            count += 1
        return new[key]

    tris = []
    for tri in F[(k == 1) | (k == 2)]:
        # rotate the triangle so that a is inside and cc outside (winding kept)
        for r in range(3):
            a, b, cc = tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]
            if inside[a] and not inside[cc]:
                break
        if inside[b]:                  # a, b in; cc out: a quad
            tris += [[a, b, cross(b, cc)], [a, cross(b, cc), cross(a, cc)]]
        else:                          # a in; b, cc out: a smaller triangle
            tris += [[a, cross(a, b), cross(a, cc)]]
    if tris:
        keep.append(np.array(tris))
    F2 = np.vstack(keep)
    F2 = F2[(F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 0] != F2[:, 2])]
    out = trimesh.Trimesh(vertices=np.vstack(verts), faces=F2, process=False)
    out.remove_unreferenced_vertices()         # the dropped side's vertices, or the crown still measures whole
    return out


def _plane(case: Case, i: int, j: int, depth: float) -> tuple[np.ndarray, float]:
    """(unit normal pointing from crown i towards j, offset c): the cut keeps x.n <= c, c = i's proximal extreme
    towards j (central band) minus depth. The normal is the crown's mesiodistal axis - the arch tangent, except
    for a rotated incisor where it is the crown's own axis - because that is the axis the contact width is measured
    along (and reduced by the planner); a plane on the arch tangent shaves a rotated incisor's corner and leaves its
    width nearly whole (000001 tooth 11: 0.01 mm of 0.25)."""
    a = case._md_axis(i)[2]
    n = np.array([np.cos(a), np.sin(a), 0.0])
    if n[:2] @ (case.anchor[j][:2] - case.anchor[i][:2]) < 0:
        n = -n
    bl = np.array([-np.sin(a), np.cos(a)])
    V = case._surface_points(i)
    pn = V[:, :2] @ bl
    mid, half = (pn.max() + pn.min()) / 2, (pn.max() - pn.min()) / 2
    band = np.abs(pn - mid) <= CONTACT_BAND * half
    ext = float((V[band] @ n).max()) if band.sum() >= 3 else float((V @ n).max())
    return n, ext - depth


def cut_faces(mesh: trimesh.Trimesh, planes: list[dict], tol: float = PLANE_TOL) -> np.ndarray:
    """Indices of the faces lying on any of the cut planes (`{"n": [x, y, z], "c": offset}`) - the stripped surface,
    for colouring. Works on the cut mesh and on a decimated copy of it (decimation keeps the plane's vertices on it)."""
    V = np.asarray(mesh.vertices, float)
    on = np.zeros(len(mesh.faces), bool)
    for pl in planes:
        d = np.abs(V @ np.asarray(pl["n"], float) - pl["c"])
        on |= (d[mesh.faces] <= tol).all(axis=1)
    return np.flatnonzero(on)


def cut_crown(case: Case, i: int, cuts: list[tuple[int, float]]) -> tuple[trimesh.Trimesh, list[dict]]:
    """Crown i with `depth` taken off its proximal surface towards each neighbour j in cuts=[(j, depth), ...]."""
    m = _fill_loops(case.mesh[i].copy())
    planes = []
    for j, depth in cuts:
        if depth < MIN_CUT_MM:
            continue
        n, c = _plane(case, i, j, depth)
        m = _slice(m, n, c)
        m = _fill_loops(m)
        planes.append({"n": np.round(n, 6).tolist(), "c": round(float(c), 6)})
    return m, planes


def per_tooth(surfaces: list[Surface], exclude=frozenset()) -> dict[int, list[tuple[int, float]]]:
    """{tooth: [(neighbour, depth mm), ...]} - half of each contact's amount per tooth; an excluded tooth takes none
    and its partner takes all of it."""
    out: dict[int, list[tuple[int, float]]] = {}
    for a, b, mm in surfaces:
        ea, eb = a in exclude, b in exclude
        if mm < MIN_CUT_MM or (ea and eb):
            continue
        if not ea:
            out.setdefault(a, []).append((b, mm if eb else mm / 2))
        if not eb:
            out.setdefault(b, []).append((a, mm if ea else mm / 2))
    return out


def cut_ipr(case: Case, surfaces: list[Surface], exclude=frozenset()) -> Case:
    """A derived Case with the prescribed IPR cut from its crowns. `case` itself is unchanged (the scan as it is).

    The result keeps the original crown positions, arch and rotation pivots (the target and stages are computed
    against them) and carries `ipr_cut = {tooth: {"mm": total taken off this crown, "planes": [...], "faces": [...]}}`
    and `teeth_cut = {tooth: cut mesh}` for the cut crowns only. With nothing to cut it returns `case`.
    """
    plan = per_tooth(surfaces, frozenset(exclude))
    plan = {i: c for i, c in plan.items() if i in case.mesh}
    if not plan:
        return case
    meshes, info = {}, {}
    for i, cuts in sorted(plan.items()):
        m, planes = cut_crown(case, i, cuts)
        meshes[i] = m
        info[i] = {"mm": round(sum(d for _, d in cuts), 4), "planes": planes,
                   "faces": cut_faces(m, planes).tolist(), "closed": bool(m.is_watertight)}
    out = case.with_meshes(meshes)
    out.ipr_cut = info
    out.teeth_cut = meshes
    return out


def surfaces_from_info(case: Case, info: dict) -> tuple[list[Surface], frozenset]:
    """(surfaces, exclude) for a target/plan info: its `ipr_surfaces` list when it has one, else the planner's
    uniform IPR (`ipr_mm_per_surface` on every contact of `ipr_applied_teeth`) as a surface list - a contact takes
    half the per-surface amount from each of its teeth that gets IPR. Teeth without IPR are excluded, so the cut lands
    on the tooth whose width the planner reduced."""
    applied = set(info.get("ipr_applied_teeth") or ())
    if info.get("ipr_surfaces"):
        return [(int(a), int(b), float(mm)) for a, b, mm in info["ipr_surfaces"]], frozenset(set(case.ids) - applied)
    mm = float(info.get("ipr_mm_per_surface") or 0.0)
    if mm <= 0 or not applied:
        return [], frozenset()
    surfaces = []
    for a, b in case.neighbors():
        amount = mm / 2 * ((a in applied) + (b in applied))
        if amount > 0:
            surfaces.append((a, b, round(amount, 4)))
    return surfaces, frozenset(set(case.ids) - applied)
