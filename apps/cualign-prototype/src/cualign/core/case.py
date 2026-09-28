"""A case = one upper arch as {tooth_id: mesh}. Loaded from per-tooth STL files or generated synthetically.

Collision volume between neighbouring crowns is measured as the intersection volume of their
(decimated) convex hulls via the manifold engine. This is deliberately strict: if the boolean
engine is missing we raise instead of silently returning 0 (that fallback hid a dead collision
check in an earlier spike).
"""
from __future__ import annotations

import copy
import glob
import os
from pathlib import Path

import numpy as np
import trimesh

from .arch import Arch
from .limits import UPPER

MD_WINDOW_DEG = 35.0     # search the mesiodistal axis within this angle of the arch tangent (incisors)
MD_WINDOW_OTHER_DEG = 15.0   # ... and for canines, premolars, molars: their rhomboid outlines narrow along a diagonal
# Incisor outlines are long and thin, so their axis (and a rotation about the long axis) can be read from the outline;
# golden set B confirms 15–20° incisor rotations but reads a 12° molar and a 15° canine rotation as ~0°, and real
# canines/molars read 18–36° with no rotation visible. Only incisors get rotation measured and corrected; the other
# crowns turn with the arch tangent instead (planner._place). Five other estimators (outline PCA, minimum rectangle,
# contact chord, labial contour line, template registration of the top-view depth map) were tried on golden set B
# and the three bundled scans on 2026-09-28 and none recovers a known spin on canines/premolars/molars
# (.report/1-target-rotation.md).
YAW_MEASURABLE = frozenset({7, 8, 9, 10, 23, 24, 25, 26})
MD_TURN_COST = 0.03      # mm of extent per degree the axis must save to turn away from the tangent
# A width axis the outline cannot decide: turning the other way from the tangent narrows the crown too, by at least
# YAW_AMBIGUOUS_MM and YAW_AMBIGUOUS_SHARE of what the chosen way does (the tangent sits on a ridge of the extent curve —
# a rounded or diagonal outline). Such a crown reads 0° (no rotation measured). Poseidon 000001's 11 read +24.3° so:
# 0.76 mm narrower its way, 0.48 mm (0.63) the other, its incisal edge ~9° the other way. A real rotation narrows on
# one side only: golden set B's template incisors rotated 8–20° at most 0.24, 000131's 12 (+15.8°) 0.02.
YAW_AMBIGUOUS_MM = 0.2
YAW_AMBIGUOUS_SHARE = 0.5
# Crowding is measured the clinical way (#59): a tooth's width between its contact points, not its full outline. On a
# curved arch the crown's straight-line extent also takes in the corners that flare into the embrasures, 0.15–1.1 mm per
# side, 0.7–1.5 mm buccal or lingual of the contact (Poseidon3D 000174, no treatment needed, averaged +0.8 mm per
# tooth over its contact spacing). The contacts sit in the middle of the proximal surface, so the width is read in the
# central bucco-lingual band of the crown only.
CONTACT_BAND = 0.2       # half-width of that band, as a share of the crown's bucco-lingual half-depth
CONTACT_NEAR_MM = 0.3    # surface points of two neighbours this close (beyond their minimum) form the contact zone


class Case:
    def __init__(self, meshes: dict[int, trimesh.Trimesh], name: str = "case", hull_faces: int = 120):
        try:
            import manifold3d  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("manifold3d is required for collision volumes (pip install manifold3d)") from e
        self.name = name
        self.mesh = {int(i): m for i, m in meshes.items()}
        self.ids = sorted(self.mesh)
        self._hull_faces = hull_faces
        self.hull: dict[int, trimesh.Trimesh] = {}
        for i in self.ids:
            h = self.mesh[i].convex_hull
            if len(h.faces) > hull_faces:
                h = h.simplify_quadric_decimation(face_count=hull_faces)
                h = h.convex_hull
            self.hull[i] = h
        self.pos0 = {i: self.mesh[i].centroid.copy() for i in self.ids}
        self._outline = {i: self.mesh[i].convex_hull.vertices[:, :2].copy() for i in self.ids}
        self._md: dict[int, tuple[float, float]] = {}
        self._cw: dict = {}
        self._contact: dict[tuple[int, int], np.ndarray] = {}
        self._surf: dict[int, np.ndarray] = {}
        self._base_all: dict[tuple[int, int], float] = {}
        # The arch runs through each crown's outline centre (centre of its extents along its own mesiodistal and
        # buccolingual axes), not its centroid: a scanned or concave crown's centroid sits off the contact line by up
        # to ~1 mm and lengthens or shortens the arch. The axes need an arch, so fit on centroids first, then refit.
        self.anchor = dict(self.pos0)
        self.arch = Arch(np.array([self.pos0[i] for i in self.ids]))
        self.anchor = {i: self._outline_centre(i) for i in self.ids}
        self.arch = Arch(np.array([self.anchor[i] for i in self.ids]))
        self.baseline = self._pair_overlaps({i: np.zeros(3) for i in self.ids})
        self._gum: trimesh.Trimesh | None = None   # display-only gingiva, built lazily (see gum.py)
        self.gum_scan: trimesh.Trimesh | None = None   # scanned gingiva.stl only (the print model needs a real one)

    # ------------------------------------------------------------------ constructors
    @classmethod
    def from_dir(cls, folder: str | os.PathLike, arch: list[int] = UPPER) -> "Case":
        folder = str(folder)
        files = glob.glob(os.path.join(folder, "*.stl"))
        meshes = {}
        for f in files:
            stem = Path(f).stem
            if not stem.isdigit():
                continue
            i = int(stem)
            if i in arch:
                meshes[i] = trimesh.load(f, process=True, force="mesh")
        if not meshes:
            raise FileNotFoundError(f"no <tooth_id>.stl files in {folder}")
        case = cls(meshes, name=Path(folder).name)
        gum = Path(folder) / "gingiva.stl"
        if gum.exists():   # scanned gingiva (display only) instead of the procedural ridge
            case._gum = case.gum_scan = trimesh.load(gum, process=True, force="mesh")
        return case

    @classmethod
    def synthetic(cls, preset: str = "moderate", seed: int = 0, **kw) -> "Case":
        from .synth import PRESETS, make_case
        from .planner import crowding_mm
        # The generator shortens the whole arch by full crown outlines; the planner measures the clinical way (#59:
        # contact widths between the first molars), which grows only ~0.6 mm per mm of shortening and reads the
        # uncrowded template arch as ~5 mm of spacing. Rebuild with the shortening solved (secant) until the measured
        # crowding is the preset's nominal value, so a preset keeps its difficulty.
        target = kw.get("crowding_mm", PRESETS.get(preset, PRESETS["moderate"])["crowding_mm"])
        pts = []
        comp = target
        for _ in range(5):
            case = cls(make_case(preset, seed=seed, **{**kw, "crowding_mm": comp}), name=f"synthetic:{preset}")
            got = crowding_mm(case)
            if abs(got - target) <= 0.15:
                break
            pts.append((comp, got))
            slope = (pts[-1][1] - pts[-2][1]) / (pts[-1][0] - pts[-2][0]) if len(pts) > 1 and pts[-1][0] != pts[-2][0] else 0.6
            comp += (target - got) / max(slope, 0.2)
        return case

    def with_meshes(self, meshes: dict[int, trimesh.Trimesh]) -> "Case":
        """A copy of this case with some crowns replaced (IPR-cut crowns, ipr_cut.py). Positions, arch, rotation
        pivots and the mesiodistal axes stay those of the scan; hulls, contact caches and the collision baseline are
        rebuilt for the new crowns. Display gum and gum scan are shared."""
        new = copy.copy(self)
        new.mesh = {**self.mesh, **{int(i): m for i, m in meshes.items()}}
        new.hull = dict(self.hull)
        for i in meshes:
            h = new.mesh[i].convex_hull
            if len(h.faces) > self._hull_faces:
                h = h.simplify_quadric_decimation(face_count=self._hull_faces).convex_hull
            new.hull[i] = h
        new._outline = {**self._outline, **{i: new.mesh[i].convex_hull.vertices[:, :2].copy() for i in meshes}}
        new._cw, new._contact, new._surf, new._base_all = {}, {}, {}, {}
        new._md = dict(self._md)
        new._span_cache = None
        new.baseline = new._pair_overlaps({i: np.zeros(3) for i in new.ids})
        return new

    # ------------------------------------------------------------------ geometry
    def transform(self, i: int, d, yaw_deg: float = 0.0) -> np.ndarray:
        """4x4 pose of crown i: turn by yaw_deg about the vertical axis through its centroid, then translate by d."""
        c = self.pos0[i]
        T = trimesh.transformations.rotation_matrix(np.radians(yaw_deg), [0, 0, 1], point=[c[0], c[1], 0.0])
        T[:3, 3] += np.asarray(d, float)
        return T

    def placed(self, i: int, d, yaw_deg: float = 0.0, hull: bool = False) -> trimesh.Trimesh:
        m = (self.hull if hull else self.mesh)[i].copy()
        m.apply_transform(self.transform(i, d, yaw_deg))
        return m

    def _overlap(self, a: int, b: int, da, db, ya: float = 0.0, yb: float = 0.0) -> float:
        ha = self.placed(a, da, ya, hull=True)
        hb = self.placed(b, db, yb, hull=True)
        A, B = ha.bounds, hb.bounds
        if not (np.all(A[0] < B[1]) and np.all(B[0] < A[1])):
            return 0.0
        r = trimesh.boolean.intersection([ha, hb], engine="manifold")
        if r is None or r.is_empty or len(r.faces) == 0:
            return 0.0
        return float(abs(r.volume))

    def neighbors(self) -> list[tuple[int, int]]:
        return [(self.ids[k], self.ids[k + 1]) for k in range(len(self.ids) - 1)]

    def _pair_overlaps(self, disp: dict[int, np.ndarray]) -> dict[tuple[int, int], float]:
        return {(a, b): self._overlap(a, b, disp[a], disp[b]) for a, b in self.neighbors()}

    def pair_baseline(self, a: int, b: int) -> float:
        """Overlap of any two crowns where they stand now (cached); the validator compares against it."""
        key = (min(a, b), max(a, b))
        if key not in self._base_all:
            self._base_all[key] = self.baseline.get(key) if key in self.baseline else self._overlap(*key, np.zeros(3), np.zeros(3))
        return self._base_all[key]

    @property
    def arch(self) -> Arch:
        return self._arch

    @arch.setter
    def arch(self, arch: Arch) -> None:
        """Setting the arch drops the cached widths and widens its span to the end crowns' distal contacts."""
        self._arch = arch
        self._md = {}
        self._cw = {}
        if self.ids:
            arch.end_pad = (self.mesiodistal_width(self.ids[0]) / 2, self.mesiodistal_width(self.ids[-1]) / 2)

    def _md_axis(self, i: int) -> tuple[float, float, float]:
        """(width mm, crown yaw deg relative to the arch tangent, axis angle rad) — see mesiodistal_width."""
        if i not in self._md:
            if i in (self.ids[0], self.ids[-1]) and len(self.ids) > 3:   # the global fit's end derivative is unreliable
                t = self.arch.end_direction(last=i == self.ids[-1], pad=0.0)
            else:
                t = self.arch.tangent(self.arch.s_of(self.anchor[i]))
            self._md[i] = self._axis_search(i, t)
        return self._md[i]

    def _axis_search(self, i: int, t: np.ndarray) -> tuple[float, float, float]:
        """Turn the axis from tangent t toward the crown's smallest extent while that pays MD_TURN_COST mm/deg."""
        a0 = np.arctan2(t[1], t[0])
        V = self._outline[i]

        def extent(deg):
            a = a0 + np.radians(deg)
            proj = V @ np.stack([np.cos(a), np.sin(a)])
            return proj.max(0) - proj.min(0)

        win = MD_WINDOW_DEG if i in YAW_MEASURABLE else MD_WINDOW_OTHER_DEG
        deg = np.arange(-win, win + 1e-9, 0.5)
        k = int(np.argmin(extent(deg) + MD_TURN_COST * np.abs(deg)))
        fine = np.arange(deg[k] - 0.5, deg[k] + 0.5 + 1e-9, 0.02)
        e = extent(fine)
        k = int(np.argmin(e + MD_TURN_COST * np.abs(fine)))
        return float(e[k]), float(fine[k]), float(a0 + np.radians(fine[k]))

    def _outline_centre(self, i: int) -> np.ndarray:
        """Centre of crown i's occlusal outline extents along its mesiodistal and buccolingual axes (z = centroid)."""
        a = self._md_axis(i)[2]
        u, v = np.array([np.cos(a), np.sin(a)]), np.array([-np.sin(a), np.cos(a)])
        pu, pv = self._outline[i] @ u, self._outline[i] @ v
        xy = u * (pu.max() + pu.min()) / 2 + v * (pv.max() + pv.min()) / 2
        return np.array([xy[0], xy[1], self.pos0[i][2]])

    def mesiodistal_width(self, i: int) -> float:
        """Crown extent (convex outline in the occlusal plane) along its mesiodistal axis.

        The axis starts at the arch tangent and turns towards the direction of the smallest extent only while that
        pays more than MD_TURN_COST mm per degree. A rotated box-like crown turns back to its own axis (its extent
        grows ~0.2 mm/deg off-axis); a rounded crown, whose extent barely changes near the axis, stays on the
        tangent instead of rolling off to a narrower diagonal. Checked against known widths in golden set B.
        """
        return self._md_axis(i)[0]

    def _surface_points(self, i: int) -> np.ndarray:
        """Dense points on crown i: its vertices, plus a fixed-seed surface sample for coarse meshes (e.g. boxes)."""
        if i not in self._surf:
            m = self.mesh[i]
            pts = m.vertices
            if len(pts) < 1500:
                pts = np.vstack([pts, trimesh.sample.sample_surface(m, 3000, seed=0)[0]])
            self._surf[i] = np.asarray(pts, float)
        return self._surf[i]

    @property
    def arch_order(self) -> list[int]:
        """Teeth in arch order: Universal numbers run along the arch. (Sorting by position on the fitted arch put 5
        before 4 when the molars were missing: the fit bends back past an end crown.)"""
        return sorted(self.ids)

    def contact_point(self, a: int, b: int) -> np.ndarray:
        """Contact of neighbouring crowns a and b: centre of the zone where their surfaces come closest (a shared cut
        edge for crowns segmented from one scan; the gap midpoint when they do not touch)."""
        key = (min(a, b), max(a, b))
        if key not in self._contact:
            from scipy.spatial import cKDTree
            pa, pb = self._surface_points(a), self._surface_points(b)
            d, j = cKDTree(pb).query(pa)
            near = d <= d.min() + CONTACT_NEAR_MM
            self._contact[key] = ((pa[near] + pb[j[near]]) / 2).mean(0)
        return self._contact[key]

    def contact_width(self, i: int, arch: Arch | None = None) -> float:
        """Mesiodistal width at the contacts: extent along the crown's mesiodistal axis within the central
        bucco-lingual band (CONTACT_BAND) of the crown. See CONTACT_BAND for why not the whole outline.
        `arch`: read the axis off this arch's tangent instead of the case's (the crowding measure passes the arch of the
        crowns standing in line, which a far-out crown does not bend)."""
        key = (i, arch) if arch is not None else i       # the arch itself: an id() can be reused once it is freed
        if key not in self._cw:
            a = (self._md_axis(i) if arch is None else self._axis_search(i, arch.tangent(arch.s_of(self.anchor[i]))))[2]
            u, n = np.array([np.cos(a), np.sin(a)]), np.array([-np.sin(a), np.cos(a)])
            V = self._surface_points(i)[:, :2]
            pn = V @ n
            mid, half = (pn.max() + pn.min()) / 2, (pn.max() - pn.min()) / 2
            band = np.abs(pn - mid) <= CONTACT_BAND * half
            pr = V[band] @ u if band.sum() >= 3 else V @ u
            self._cw[key] = float(pr.max() - pr.min())
        return self._cw[key]

    def crown_top(self, i: int) -> float:
        """Highest point of crown i (z; the occlusal plane is z = 0 and crowns hang towards -z)."""
        return float(self.mesh[i].bounds[1][2])

    def yaw_measurable(self, i: int) -> bool:
        return i in YAW_MEASURABLE

    def crown_yaw(self, i: int) -> float:
        """Rotation (deg) of crown i about its vertical axis relative to the arch tangent, as found by the width axis.
        Meaningful only where yaw_measurable(i); elsewhere it is the width axis's small turn, not a rotation. 0 when
        the outline cannot tell the way it turns (YAW_AMBIGUOUS_MM)."""
        yaw = self._md_axis(i)[1]
        return 0.0 if yaw and self._yaw_ambiguous(i, yaw) else yaw

    def _yaw_ambiguous(self, i: int, yaw: float) -> bool:
        """Whether crown i's extent also narrows turning the other way from the tangent (YAW_AMBIGUOUS_MM/_SHARE)."""
        if i in (self.ids[0], self.ids[-1]) and len(self.ids) > 3:
            t = self.arch.end_direction(last=i == self.ids[-1], pad=0.0)
        else:
            t = self.arch.tangent(self.arch.s_of(self.anchor[i]))
        a0 = np.arctan2(t[1], t[0])
        win = MD_WINDOW_DEG if i in YAW_MEASURABLE else MD_WINDOW_OTHER_DEG
        deg = np.arange(0.5, win + 1e-9, 0.5) * np.sign(yaw)
        a = a0 + np.radians(np.concatenate([[0.0], deg, -deg]))
        proj = self._outline[i] @ np.stack([np.cos(a), np.sin(a)])
        ext = proj.max(0) - proj.min(0)
        n = len(deg)
        own, other = ext[0] - ext[1:n + 1].min(), ext[0] - ext[n + 1:].min()
        return bool(other >= YAW_AMBIGUOUS_MM and other >= YAW_AMBIGUOUS_SHARE * own)

    # ------------------------------------------------------------------ export
    def viewer_json(self, max_faces: int = 1500) -> dict:
        """Per-tooth vertices/faces for the browser viewer (decimated for transfer)."""
        teeth = {}
        for i in self.ids:
            m = self.mesh[i]
            if len(m.faces) > max_faces:
                m = m.simplify_quadric_decimation(face_count=max_faces)
            teeth[str(i)] = {"v": np.round(m.vertices, 3).tolist(), "f": m.faces.tolist()}
        order = sorted(self.ids, key=lambda i: self.arch.s_of(self.anchor[i], 0.0))
        if self._gum is None:
            from .gum import make_gum
            self._gum = make_gum(self.arch, self.mesh, self.pos0)
        g = self._gum
        return {"name": self.name, "arch": "upper", "ids": self.ids, "arch_order": order, "teeth": teeth,
                "gum": {"v": np.round(g.vertices, 3).tolist(), "f": g.faces.tolist()}}

