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


def closed_json(t: dict) -> dict:
    """A crown as the viewer gets it ({v, f}) with its open cervical margin fanned shut, so a crown whose side is bared
    (a neighbour extracted or moved away) does not show a hole. For the view only: the core measures the crowns as
    they came. The new faces come after the old ones, so face indices into `f` stay valid."""
    mesh = trimesh.Trimesh(np.asarray(t["v"], float), np.asarray(t["f"]), process=False)
    out = _fill_loops(mesh)
    return t if out is mesh else {"v": np.round(out.vertices, 3).tolist(), "f": out.faces.tolist()}


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
