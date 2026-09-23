"""Arch form fitted to crown centroids: a polynomial curve in a PCA-aligned frame, parameterised by arc length.

Why not a circle: dental arches are U-shaped (parabola/catenary-like). A polar model around the
centroid underestimates the arc length and turns an aligned arch into fake crowding.
"""
from __future__ import annotations

import numpy as np


class Arch:
    def __init__(self, centroids: np.ndarray, degree: int = 4, margin: float = 8.0, n_samples: int = 2000):
        P = np.asarray(centroids, float)
        self.c = P.mean(0)
        X = P[:, :2] - self.c[:2]
        _, _, Vt = np.linalg.svd(X, full_matrices=False)
        self.axes = Vt                      # rows: local x (major), local y (minor)
        L = X @ Vt.T
        # Orientation: anterior teeth sit at the extreme of the minor axis. Make that +y.
        mid = np.abs(L[:, 0]) < np.percentile(np.abs(L[:, 0]), 40)
        if L[mid, 1].mean() < L[~mid, 1].mean():
            self.axes[1] *= -1
            L = X @ self.axes.T
        deg = degree if len(P) >= degree + 3 else 2
        self.poly = np.polyfit(L[:, 0], L[:, 1], deg)
        self.xmin, self.xmax = L[:, 0].min() - margin, L[:, 0].max() + margin
        self.n_samples = n_samples
        self._cache: dict[float, tuple[np.ndarray, np.ndarray]] = {}

    # ------------------------------------------------------------------ frames
    def to_local(self, p_world: np.ndarray) -> np.ndarray:
        return (np.asarray(p_world)[:2] - self.c[:2]) @ self.axes.T

    def to_world_xy(self, p_local: np.ndarray) -> np.ndarray:
        return np.asarray(p_local) @ self.axes + self.c[:2]

    # ------------------------------------------------------------------ curve
    def samples(self, offset: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
        """Dense points on the curve offset outward by `offset` mm, and their cumulative arc length."""
        if offset in self._cache:
            return self._cache[offset]
        xs = np.linspace(self.xmin, self.xmax, self.n_samples)
        ys = np.polyval(self.poly, xs)
        pts = np.stack([xs, ys], 1)
        if offset:
            d = np.gradient(pts, axis=0)
            t = d / np.linalg.norm(d, axis=1, keepdims=True)
            n = np.stack([-t[:, 1], t[:, 0]], 1)
            # outward = away from the curve's own centroid (inside the U)
            inside = pts.mean(0)
            sign = np.sign(((pts - inside) * n).sum(1))
            sign[sign == 0] = 1
            pts = pts + n * sign[:, None] * offset
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        cum = np.concatenate([[0.0], np.cumsum(seg)])
        self._cache[offset] = (pts, cum)
        return pts, cum

    def s_of(self, p_world: np.ndarray, offset: float = 0.0) -> float:
        pts, cum = self.samples(offset)
        q = self.to_local(p_world)
        k = int(np.argmin(((pts - q) ** 2).sum(1)))
        return float(cum[k])

    def point(self, s: float, offset: float = 0.0) -> np.ndarray:
        """World xy of the point at arc length s on the (offset) curve."""
        pts, cum = self.samples(offset)
        x = np.interp(s, cum, pts[:, 0])
        y = np.interp(s, cum, pts[:, 1])
        return self.to_world_xy(np.array([x, y]))

    def tangent(self, s: float, offset: float = 0.0) -> np.ndarray:
        pts, cum = self.samples(offset)
        k = int(np.clip(np.searchsorted(cum, s), 1, len(cum) - 1))
        t = pts[k] - pts[k - 1]
        t = t / (np.linalg.norm(t) or 1.0)
        return t @ self.axes   # world xy direction
