"""Arch form fitted to crown centroids: a parametric polynomial curve in the world xy plane, parameterised by arc length.

Why parametric: dental arches are U-shaped and often asymmetric. A graph y = f(x) in a PCA frame bends at the ends
and its arc length drifts with the fit degree (up to ~2 mm between degrees 2 and 6). Here x(u) and y(u) are fitted
separately over the normalised chord length u of the centroids (given in arch order), with the two end crowns
pinned, so the arc length between the end crowns follows the arch rather than the fit.

Why not a circle: a polar model around the centroid underestimates the arc length and turns an aligned arch into
fake crowding.

Outward normal: one sign for the whole curve (away from the inside of the U), never decided per sample — a per-sample
sign flips where the curve crosses the centroid and makes offset curves jump.
"""
from __future__ import annotations

import numpy as np

END_WEIGHT = 1e3        # weight of the two end crowns in the fit (≈ pinned)
END_FIT_POINTS = 4      # crowns in the local fit that gives the direction at each end


class Arch:
    def __init__(self, centroids: np.ndarray, degree: int = 5, margin: float = 8.0, n_samples: int = 2000):
        """centroids: crown centroids in arch order (Universal 2..15 for the upper arch). margin: mm the curve is
        extended past each end crown (for placing crowns beyond the ends and for the gum)."""
        P = np.asarray(centroids, float)
        self.c = P.mean(0)
        self.axes = np.eye(2)                    # kept for callers of the old PCA-frame API: the frame is the world
        xy = P[:, :2]
        d = np.linalg.norm(np.diff(xy, axis=0), axis=1)
        u = np.concatenate([[0.0], np.cumsum(d)])
        u = u / (u[-1] or 1.0)
        deg = int(min(degree, len(P) - 1)) if len(P) > 2 else 1
        w = np.ones(len(P))
        w[[0, -1]] = END_WEIGHT
        self.cx = np.polyfit(u, xy[:, 0], deg, w=w)
        self.cy = np.polyfit(u, xy[:, 1], deg, w=w)
        self.dcx, self.dcy = np.polyder(self.cx), np.polyder(self.cy)
        speed0 = float(np.hypot(np.polyval(self.dcx, 0.0), np.polyval(self.dcy, 0.0))) or 1.0
        speed1 = float(np.hypot(np.polyval(self.dcx, 1.0), np.polyval(self.dcy, 1.0))) or 1.0
        self.u_lo, self.u_hi = -margin / speed0, 1.0 + margin / speed1
        self.n_samples = n_samples
        self._u = np.linspace(self.u_lo, self.u_hi, n_samples)
        base = self._xy(self._u)
        t = self._tan(self._u)
        n = np.stack([-t[:, 1], t[:, 0]], 1)
        inside = self._xy(np.linspace(0.0, 1.0, 200)).mean(0)
        self.sign = 1.0 if float(((base - inside) * n).sum()) >= 0 else -1.0
        self._n = n * self.sign
        self._cache: dict[float, tuple[np.ndarray, np.ndarray]] = {}
        _, cum = self.samples(0.0)
        self.s_first = float(np.interp(0.0, self._u, cum))     # arc length of the first / last centroid
        self.s_last = float(np.interp(1.0, self._u, cum))
        self._P = xy
        self.end_pad = (0.0, 0.0)   # half widths of the end crowns; Case sets them so the ends are the distal contacts

    # ------------------------------------------------------------------ polynomial
    def _xy(self, u) -> np.ndarray:
        return np.stack([np.polyval(self.cx, u), np.polyval(self.cy, u)], -1)

    def _tan(self, u) -> np.ndarray:
        d = np.stack([np.polyval(self.dcx, u), np.polyval(self.dcy, u)], -1)
        return d / np.maximum(np.linalg.norm(d, axis=-1, keepdims=True), 1e-12)

    def _u_of_s(self, s: float) -> float:
        """Curve parameter at arc length s; linear extrapolation past the sampled ends."""
        _, cum = self.samples(0.0)
        if s <= 0.0:
            return self.u_lo + s * (self._u[1] - self._u[0]) / max(cum[1] - cum[0], 1e-12)
        if s >= cum[-1]:
            return self.u_hi + (s - cum[-1]) * (self._u[-1] - self._u[-2]) / max(cum[-1] - cum[-2], 1e-12)
        return float(np.interp(s, cum, self._u))

    # ------------------------------------------------------------------ frames (world; kept for old callers)
    def to_local(self, p_world: np.ndarray) -> np.ndarray:
        return np.asarray(p_world, float)[:2].copy()

    def to_world_xy(self, p_local: np.ndarray) -> np.ndarray:
        return np.asarray(p_local, float).copy()

    # ------------------------------------------------------------------ curve
    def samples(self, offset: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
        """Dense points on the curve offset outward by `offset` mm, and their cumulative arc length."""
        if offset in self._cache:
            return self._cache[offset]
        pts = self._xy(self._u)
        if offset:
            pts = pts + self._n * offset
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
        return np.array([np.interp(s, cum, pts[:, 0]), np.interp(s, cum, pts[:, 1])])

    def tangent(self, s: float, offset: float = 0.0) -> np.ndarray:
        """Unit tangent (world xy) at arc length s of the base curve; offset curves share it."""
        return self._tan(self._u_of_s(s))

    def normal(self, s: float) -> np.ndarray:
        """Outward unit normal (world xy) at arc length s."""
        t = self.tangent(s)
        return self.sign * np.array([-t[1], t[0]])

    def end_direction(self, last: bool = False, pad: float | None = None) -> np.ndarray:
        """Direction of travel (tooth 2 -> 15) at the distal contact of the first or last crown.

        A global polynomial's end derivative is unreliable (±15° on known arches), so the ends come from a local
        quadratic through the four distal-most crowns in their own principal frame, pinned at the end crown and
        followed past it by the crown's half width (end_pad, or `pad`).
        """
        P = self._P[::-1] if last else self._P
        k = min(END_FIT_POINTS, len(P))
        Q = P[:k]
        c = Q.mean(0)
        _, _, Vt = np.linalg.svd(Q - c)
        L = (Q - c) @ Vt.T
        w = np.ones(k)
        w[0] = END_WEIGHT
        p = np.polyfit(L[:, 0], L[:, 1], 2 if k >= 4 else 1, w=w)
        dp = np.polyder(p)
        back = -np.sign(L[1, 0] - L[0, 0]) or -1.0          # local x direction pointing past the end crown
        x = L[0, 0]
        if pad is None:
            pad = self.end_pad[1] if last else self.end_pad[0]
        for _ in range(20):                                   # walk `pad` mm along the local curve
            x += back * (pad / 20) / np.sqrt(1 + np.polyval(dp, x) ** 2)
        d = -back * np.array([1.0, np.polyval(dp, x)])      # pointing back into the arch
        d = (d / np.linalg.norm(d)) @ Vt
        return -d if last else d

    def expansion_gain(self, offset: float) -> float:
        """Length gained between the normals at the two distal contacts when the arch is offset outward by `offset`.

        For an offset curve the gain is exactly offset x (turning angle between the end directions); it depends only on
        the ends, not on how far the curve is extrapolated. The global fit only picks the 2π branch of the angle.
        """
        a, b = self.end_direction(False), self.end_direction(True)
        raw = np.arctan2(b[1], b[0]) - np.arctan2(a[1], a[0])
        t = self._tan(np.linspace(0.0, 1.0, 400))
        ang = np.unwrap(np.arctan2(t[:, 1], t[:, 0]))
        fit = ang[-1] - ang[0]
        turn = fit + ((raw - fit + np.pi) % (2 * np.pi) - np.pi)
        # moving along the left normal (-ty, tx) by e scales ds by (1 - e * dtheta/ds); outward = sign * left normal
        return float(-self.sign * offset * turn)
