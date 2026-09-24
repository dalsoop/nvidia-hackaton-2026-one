"""A case = one upper arch as {tooth_id: mesh}. Loaded from per-tooth STL files or generated synthetically.

Collision volume between neighbouring crowns is measured as the intersection volume of their
(decimated) convex hulls via the manifold engine. This is deliberately strict: if the boolean
engine is missing we raise instead of silently returning 0 (that fallback hid a dead collision
check in an earlier spike).
"""
from __future__ import annotations

import glob
import os
from pathlib import Path

import numpy as np
import trimesh

from .arch import Arch
from .limits import UPPER


class Case:
    def __init__(self, meshes: dict[int, trimesh.Trimesh], name: str = "case", hull_faces: int = 120):
        try:
            import manifold3d  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("manifold3d is required for collision volumes (pip install manifold3d)") from e
        self.name = name
        self.mesh = {int(i): m for i, m in meshes.items()}
        self.ids = sorted(self.mesh)
        self.hull: dict[int, trimesh.Trimesh] = {}
        for i in self.ids:
            h = self.mesh[i].convex_hull
            if len(h.faces) > hull_faces:
                h = h.simplify_quadric_decimation(face_count=hull_faces)
                h = h.convex_hull
            self.hull[i] = h
        self.pos0 = {i: self.mesh[i].centroid.copy() for i in self.ids}
        self.arch = Arch(np.array([self.pos0[i] for i in self.ids]))
        self.baseline = self._pair_overlaps({i: np.zeros(3) for i in self.ids})
        self._gum: trimesh.Trimesh | None = None   # display-only gingiva, built lazily (see gum.py)

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
        return cls(meshes, name=Path(folder).name)

    @classmethod
    def synthetic(cls, preset: str = "moderate", seed: int = 0, **kw) -> "Case":
        from .synth import PRESETS, make_case
        from .planner import crowding_mm
        # Build once, measure the crowding the planner will actually see, and rebuild once with the residual
        # folded in, so a preset's measured crowding equals its nominal value (real crown shapes + the fitted
        # arch otherwise drift by ~1 mm from the placement arc).
        target = kw.get("crowding_mm", PRESETS.get(preset, PRESETS["moderate"])["crowding_mm"])
        case = cls(make_case(preset, seed=seed, **kw), name=f"synthetic:{preset}")
        err = crowding_mm(case) - target
        if abs(err) > 0.15:
            kw2 = {**kw, "crowding_mm": target - err}
            case = cls(make_case(preset, seed=seed, **kw2), name=f"synthetic:{preset}")
        return case

    # ------------------------------------------------------------------ geometry
    def _overlap(self, a: int, b: int, da, db) -> float:
        ha = self.hull[a].copy(); ha.apply_translation(da)
        hb = self.hull[b].copy(); hb.apply_translation(db)
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

    def mesiodistal_width(self, i: int) -> float:
        """Crown extent along its own principal axis that is closest to the arch tangent.

        Using the crown's own axis (not the raw tangent) keeps the width stable when a tooth is rotated.
        """
        t = self.arch.tangent(self.arch.s_of(self.pos0[i]))
        V = self.mesh[i].vertices[:, :2]
        X = V - V.mean(0)
        _, _, Vt = np.linalg.svd(X, full_matrices=False)
        axis = Vt[int(np.argmax(np.abs(Vt @ t)))]
        proj = V @ axis
        return float(proj.max() - proj.min())

    # ------------------------------------------------------------------ export
    def viewer_json(self, max_faces: int = 1500) -> dict:
        """Per-tooth vertices/faces for the browser viewer (decimated for transfer)."""
        teeth = {}
        for i in self.ids:
            m = self.mesh[i]
            if len(m.faces) > max_faces:
                m = m.simplify_quadric_decimation(face_count=max_faces)
            teeth[str(i)] = {"v": np.round(m.vertices, 3).tolist(), "f": m.faces.tolist()}
        order = sorted(self.ids, key=lambda i: self.arch.s_of(self.pos0[i], 0.0))
        if self._gum is None:
            from .gum import make_gum
            self._gum = make_gum(self.arch, self.mesh, self.pos0)
        g = self._gum
        return {"name": self.name, "arch": "upper", "ids": self.ids, "arch_order": order, "teeth": teeth,
                "gum": {"v": np.round(g.vertices, 3).tolist(), "f": g.faces.tolist()}}
