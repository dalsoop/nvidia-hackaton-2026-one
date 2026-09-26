"""One print-ready upper-arch model per stage: that stage's crowns + the scanned gingiva deformed to follow them.

Aligners are thermoformed over a printed arch model (teeth and gum in one closed mesh on a flat base), so a stage's
per-tooth STLs cannot be printed as they are. Commercial model builders do not publish how they reshape the gum per
stage, so this is a PoC with two steps:

1. Gum deformation (linear-blend skinning). Each gingiva vertex moves by a weighted blend of the rigid motions of the
   crowns near it. A vertex within FOLLOW_MM of a crown (the cervical margin) follows the crowns fully; beyond FIXED_MM
   from every crown it stays put (palate, vestibule); in between the attachment falls off smoothly. Between two crowns
   (papilla) the share goes by inverse squared distance, so the edge of each crown's socket follows that crown.
2. Solid model (height map along the insertion axis +z). Crowns and deformed gum are rasterised from the occlusal side
   into one height map; the gum's sockets under the crowns (and an extracted crown's site) are filled by interpolating
   from the socket rim, the highest surface wins, and the map is closed with vertical walls down to a flat base. The
   mesh is watertight by construction and is checked (`is_watertight`, `is_volume`) before it is written.
   Everything the sheet cannot reach from +z (interproximal and cervical undercuts) is filled — the digital form of
   the wax block-out labs do before thermoforming. The model is not hollowed and carries no label.

The coordinates are the case's (occlusal plane z = 0, crowns towards +z, gum towards -z), so the base lies on the gum
side. Nothing here is a clinical rule: the constants below are PoC settings with the reason next to each.
"""
from __future__ import annotations

import re
from pathlib import Path

import manifold3d
import numpy as np
import trimesh
from scipy import ndimage
from scipy.interpolate import griddata
from scipy.spatial import cKDTree

from .case import Case

# Gum deformation. A crown's socket rim sits on the crown (~0 mm); FOLLOW_MM absorbs the scan's sampling (vertex
# spacing ~0.3–0.5 mm) so the rim moves with the crown. FIXED_MM: about the attached gingiva plus half an interdental
# papilla; beyond it (palate, vestibule) the gum is treated as fixed to bone. Assumed values, not measured tissue data.
FOLLOW_MM = 0.5
FIXED_MM = 6.0
NEAR_EPS_MM = 0.05          # floor on distance in the inverse-distance shares (a vertex on a crown would divide by 0)

# Height map. GRID_MM: crowns are placed to within half a cell (0.1 mm), well under a 0.25 mm step per aligner.
GRID_MM = 0.2
BASE_BELOW_MARGIN_MM = 3.0  # base plane below the deepest cervical margin (lab practice ~3 mm; research note #54 §2)
MIN_THICK_MM = 0.5          # gum closer than this to the base plane (deep vestibule) is trimmed off, like a clip plane
CLOSE_CELLS = 2             # closing radius (cells) that seals sampling pinholes between crown and gum surfaces
MAX_HOLE_MM2 = 4.0          # holes in the footprint smaller than this are filled; larger ones (open palate) stay open
# The raw map is ~170k faces on a real arch, half of them the flat base. manifold3d's simplify merges faces that are
# coplanar within SIMPLIFY_MM and keeps the mesh manifold (quadric decimation left doubled faces on some stages).
# 0.01 mm is far below a 50–100 µm print layer; on poseidon-000001 it gives ~78k faces (~4 MB binary STL).
SIMPLIFY_MM = 0.01


class PrintModelError(ValueError):
    """A model that cannot be made printable (the reason is shown to the dentist instead of a broken file)."""


def model_name(case_id: str, stage: int) -> str:
    """<case_id>_U_stage<NN>.stl, with anything unsafe in a file name replaced."""
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(str(case_id)).name).strip("._") or "case"
    return f"{safe}_U_stage{stage:02d}.stl"


class GumRig:
    """Per-vertex crown weights for one case's scanned gingiva (computed once, applied to every stage)."""

    def __init__(self, case: Case):
        gum = case.gum_scan
        if gum is None or len(gum.faces) == 0:
            raise PrintModelError("no scanned gingiva (gingiva.stl)")
        self.case = case
        self.gum = gum
        V = np.asarray(gum.vertices, float)
        d = np.stack([cKDTree(case.mesh[i].vertices).query(V)[0] for i in case.ids], axis=1)   # (n_vertices, n_teeth)
        near = d.min(axis=1)
        t = np.clip((FIXED_MM - near) / (FIXED_MM - FOLLOW_MM), 0.0, 1.0)
        attach = t * t * (3 - 2 * t)                     # smoothstep: 1 within FOLLOW_MM, 0 beyond FIXED_MM
        share = np.where(d < FIXED_MM, 1.0 / np.maximum(d, NEAR_EPS_MM) ** 2, 0.0)
        tot = share.sum(axis=1, keepdims=True)
        self.w = np.divide(share, tot, out=np.zeros_like(share), where=tot > 0) * attach[:, None]
        self.distance = d

    def vertices(self, disp: dict) -> np.ndarray:
        """Gum vertices for one stage. Crowns absent from the stage (extracted) count as not moving."""
        from .planner import yaw_of
        V = np.asarray(self.gum.vertices, float)
        out = V.copy()
        H = np.c_[V, np.ones(len(V))]
        for k, i in enumerate(self.case.ids):
            if i not in disp:
                continue
            T = self.case.transform(i, disp[i], yaw_of(disp, i))
            if np.allclose(T, np.eye(4)):
                continue
            out += self.w[:, k:k + 1] * ((H @ T.T)[:, :3] - V)
        return out


def _surface_samples(m: trimesh.Trimesh, spacing: float) -> np.ndarray:
    """Points on every triangle, no farther apart than `spacing` (a fixed barycentric lattice, deterministic)."""
    tri = np.asarray(m.triangles, float)
    if len(tri) == 0:
        return np.zeros((0, 3))
    edge = np.max(np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2), axis=1)
    n = np.maximum(1, np.ceil(edge / spacing)).astype(int)
    pts = []
    for k in np.unique(n):
        a, b = np.meshgrid(np.arange(k + 1), np.arange(k + 1), indexing="ij")
        keep = a + b <= k
        bary = np.stack([a[keep], b[keep], k - a[keep] - b[keep]], axis=1) / k       # (m, 3)
        pts.append(np.einsum("mj,tjc->tmc", bary, tri[n == k]).reshape(-1, 3))
    return np.concatenate(pts)


def _raster(pts: np.ndarray, x0: float, y0: float, shape: tuple[int, int]) -> np.ndarray:
    """Highest z per grid vertex (nearest vertex); -inf where nothing lands."""
    H = np.full(shape, -np.inf)
    ix = np.rint((pts[:, 0] - x0) / GRID_MM).astype(int)
    iy = np.rint((pts[:, 1] - y0) / GRID_MM).astype(int)
    ok = (ix >= 0) & (ix < shape[0]) & (iy >= 0) & (iy < shape[1])
    np.maximum.at(H, (ix[ok], iy[ok]), pts[ok, 2])
    return H


def _fill(H: np.ndarray, known: np.ndarray, want: np.ndarray) -> np.ndarray:
    """Values for `want` cells: linear interpolation from the known cells on their rim, nearest outside that."""
    out = H.copy()
    todo = want & ~known
    if not todo.any():
        return out
    rim = known & ndimage.binary_dilation(todo, iterations=2)
    q = np.argwhere(todo)
    if rim.sum() >= 3:
        p = np.argwhere(rim)
        v = griddata(p, H[rim], q, method="linear")
    else:
        v = np.full(len(q), np.nan)
    miss = np.isnan(v)
    if miss.any():
        idx = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
        v[miss] = H[idx[0][tuple(q[miss].T)], idx[1][tuple(q[miss].T)]]
    out[tuple(q.T)] = v
    return out


def _clean_quads(Q: np.ndarray) -> np.ndarray:
    """Fill 2x2 blocks where two quads touch only at a corner (that corner would be non-manifold)."""
    Q = Q.copy()
    while True:
        a, b, c, d = Q[:-1, :-1], Q[1:, :-1], Q[:-1, 1:], Q[1:, 1:]
        pinch = (a & d & ~b & ~c) | (b & c & ~a & ~d)
        if not pinch.any():
            return Q
        for di in (0, 1):
            for dj in (0, 1):
                Q[di:Q.shape[0] - 1 + di, dj:Q.shape[1] - 1 + dj] |= pinch


def _solid(H: np.ndarray, Q: np.ndarray, x0: float, y0: float, z_base: float) -> trimesh.Trimesh:
    """Closed mesh: top = height map over the active quads, flat bottom at z_base, vertical walls on the outline."""
    nx, ny = H.shape
    used = np.zeros((nx, ny), bool)
    qi, qj = np.nonzero(Q)
    for di in (0, 1):
        for dj in (0, 1):
            used[qi + di, qj + dj] = True
    vid = np.full((nx, ny), -1)
    vi, vj = np.nonzero(used)
    n = len(vi)
    vid[vi, vj] = np.arange(n)
    xy = np.c_[x0 + vi * GRID_MM, y0 + vj * GRID_MM]
    V = np.vstack([np.c_[xy, H[vi, vj]], np.c_[xy, np.full(n, z_base)]])
    a, b = vid[qi, qj], vid[qi + 1, qj]              # corners (i,j) (i+1,j) (i+1,j+1) (i,j+1): counter-clockwise
    c, d = vid[qi + 1, qj + 1], vid[qi, qj + 1]
    top = np.r_[np.c_[a, b, c], np.c_[a, c, d]]
    bottom = top[:, ::-1] + n
    # outline edges, each taken in the direction it runs in its top face (so the interior is on its left)
    pad = np.pad(Q, 1)
    walls = []
    for (p, q), nb in (((a, b), pad[1:-1, :-2]), ((b, c), pad[2:, 1:-1]), ((c, d), pad[1:-1, 2:]), ((d, a), pad[:-2, 1:-1])):
        open_ = ~nb[qi, qj]
        s, e = p[open_], q[open_]
        walls += [np.c_[e, s, s + n], np.c_[e, s + n, e + n]]
    F = np.vstack([top, bottom, *walls])
    return trimesh.Trimesh(vertices=V, faces=F, process=False)


def build_model(case: Case, disp: dict, rig: GumRig | None = None) -> trimesh.Trimesh:
    """The printable model of one stage (raises PrintModelError with the reason when it cannot be made closed)."""
    from .planner import yaw_of
    rig = rig or GumRig(case)
    gum = trimesh.Trimesh(vertices=rig.vertices(disp), faces=rig.gum.faces, process=False)
    teeth = [case.placed(i, v, yaw_of(disp, i)) for i, v in disp.items()]
    tooth_pts = np.concatenate([_surface_samples(m, GRID_MM / 2) for m in teeth])
    gum_pts = _surface_samples(gum, GRID_MM / 2)
    allp = np.r_[tooth_pts, gum_pts]
    x0, y0 = allp[:, :2].min(axis=0) - 2 * GRID_MM
    shape = tuple((np.ceil((allp[:, :2].max(axis=0) + 2 * GRID_MM - [x0, y0]) / GRID_MM) + 1).astype(int))
    G, T = _raster(gum_pts, x0, y0, shape), _raster(tooth_pts, x0, y0, shape)

    hit = np.isfinite(G) | np.isfinite(T)
    closed = ndimage.binary_closing(hit, iterations=CLOSE_CELLS) | hit
    foot = ndimage.binary_fill_holes(closed)
    G = _fill(G, np.isfinite(G), foot)                # sockets under crowns, an extracted crown's site, pinholes
    H = np.where(foot, np.maximum(G, T), -np.inf)

    z_base = min(float(case.mesh[i].bounds[0][2]) for i in case.ids) - BASE_BELOW_MARGIN_MM
    foot &= H > z_base + MIN_THICK_MM
    lab, n = ndimage.label(foot)
    if n == 0:
        raise PrintModelError("nothing above the base plane")
    foot = lab == 1 + int(np.argmax(ndimage.sum(foot, lab, range(1, n + 1))))
    holes, nh = ndimage.label(~foot)
    if nh:
        size = ndimage.sum(np.ones_like(foot), holes, range(1, nh + 1)) * GRID_MM ** 2
        edge = set(np.unique(np.r_[holes[0], holes[-1], holes[:, 0], holes[:, -1]]))
        small = [k + 1 for k in range(nh) if size[k] < MAX_HOLE_MM2 and k + 1 not in edge]
        foot |= np.isin(holes, small)
    Q = _clean_quads(foot[:-1, :-1] & foot[1:, :-1] & foot[:-1, 1:] & foot[1:, 1:])
    used = np.zeros_like(foot)
    for di in (0, 1):
        for dj in (0, 1):
            used[di:used.shape[0] - 1 + di, dj:used.shape[1] - 1 + dj] |= Q
    H = _fill(H, np.isfinite(H) & foot, used)         # heights for cells added by hole and corner filling
    H = np.maximum(H, z_base + MIN_THICK_MM)

    raw = _solid(H, Q, float(x0), float(y0), z_base)
    if not (raw.is_watertight and raw.is_volume):
        raise PrintModelError("model mesh is not closed")
    solid = manifold3d.Manifold(manifold3d.Mesh(vert_properties=np.asarray(raw.vertices, np.float32),
                                                tri_verts=np.asarray(raw.faces, np.uint32)))
    if solid.status() != manifold3d.Error.NoError:
        raise PrintModelError(f"model mesh is not manifold ({solid.status().name})")
    out = solid.simplify(SIMPLIFY_MM).to_mesh()
    m = trimesh.Trimesh(vertices=np.asarray(out.vert_properties)[:, :3], faces=out.tri_verts, process=False)
    if not (m.is_watertight and m.is_volume):
        raise PrintModelError("simplified model mesh is not closed")
    return m


def print_models(case: Case, stages: list[dict], case_id: str) -> tuple[dict[str, bytes], dict]:
    """{file name: binary STL} for every stage that could be built, and a report of what was made or why not."""
    try:
        rig = GumRig(case)
    except PrintModelError as e:
        return {}, {"status": "skipped", "n_files": 0, "reason": str(e),
                    "reason_ko": "잇몸 스캔(gingiva.stl)이 없어 단계별 프린트용 모형을 만들지 않았습니다."}
    files, failed, faces = {}, [], []
    for si, disp in enumerate(stages, 1):
        try:
            m = build_model(case, disp, rig)
        except PrintModelError as e:
            failed.append({"stage": si, "reason": str(e)})
            continue
        files[model_name(case_id, si)] = m.export(file_type="stl")
        faces.append(len(m.faces))
    report = {"status": "ok" if not failed else ("partial" if files else "failed"), "n_files": len(files),
              "n_stages": len(stages), "failed": failed, "max_faces": max(faces, default=0)}
    return files, report


def readme(report: dict) -> str:
    lines = ["cuAlign 단계별 프린트용 상악 모형 (PoC)", ""]
    if report["status"] == "skipped":
        lines.append(f"모형을 만들지 않았습니다: {report['reason_ko']} ({report['reason']})")
    else:
        lines += [f"단계 {report['n_stages']}개 중 {report['n_files']}개 모형 (binary STL, mm, 닫힌 메시 확인).",
                  "치아 + 단계별로 변형한 잇몸 + 평평한 받침. 삽입 방향(+z)의 언더컷은 메워져 있고 속 비우기·각인은 없습니다.",
                  "장치 파일이 아니며 제작 전 의사·기공 검토가 필요합니다."]
        lines += [f"단계 {f['stage']:02d} 모형 실패: {f['reason']}" for f in report["failed"]]
    lines.append("stage_NN/<치아번호>.stl 치아별 파일은 이전과 같습니다.")
    return "\n".join(lines) + "\n"
