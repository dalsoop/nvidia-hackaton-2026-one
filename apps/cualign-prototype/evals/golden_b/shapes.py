"""Ground-truth-first test arches for the calculation core. Independent of cuAlign's core: numpy + trimesh only.

Every quantity the core estimates is fixed here first — mesiodistal widths, the ideal arch and its length,
the space deficit (crowding), rotations and vertical offsets — and the meshes are built from it. The arch
families (catenary, ellipse, skewed parabola, parabola) are chosen on purpose; the core fits a polynomial, so the
parabola is the only "easy" family.

Frame (same as the core): upper arch, occlusal plane z = 0, crowns towards -z, anterior at +y, Universal numbering
2..15 from the viewer's left.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import trimesh

UPPER = list(range(2, 16))
# Universal upper 2..15: textbook-like mesiodistal widths (mm). Values are inputs, not claims about patients.
WIDTHS = {2: 9.0, 3: 10.0, 4: 6.5, 5: 7.0, 6: 7.5, 7: 6.5, 8: 8.5, 9: 8.5, 10: 6.5, 11: 7.5, 12: 7.0, 13: 6.5, 14: 10.0, 15: 9.0}
DEPTH = {2: 11.0, 3: 11.0, 4: 9.0, 5: 9.0, 6: 8.0, 7: 6.0, 8: 7.0, 9: 7.0, 10: 6.0, 11: 8.0, 12: 9.0, 13: 9.0, 14: 11.0, 15: 11.0}
HEIGHT = {2: 7.0, 3: 7.5, 4: 8.0, 5: 8.5, 6: 10.0, 7: 9.0, 8: 10.5, 9: 10.5, 10: 9.0, 11: 10.0, 12: 8.5, 13: 8.0, 14: 7.5, 15: 7.0}
TEMPLATES = Path(__file__).resolve().parents[2] / "src" / "cualign" / "core" / "templates"   # crown shapes only


# ------------------------------------------------------------------------------------------------ arch curves
class Curve:
    """Planar U-shaped curve, anterior at +y, traversed from the viewer's left (tooth 2) to the right (tooth 15)."""

    def __init__(self, family: str, scale: float = 1.0, n: int = 20000):
        self.family, self.scale = family, scale
        u = np.linspace(0.0, 1.0, n)
        self.xy = self._xy(u) * scale
        seg = np.linalg.norm(np.diff(self.xy, axis=0), axis=1)
        self.s = np.concatenate([[0.0], np.cumsum(seg)])
        self.length = float(self.s[-1])

    def _xy(self, u: np.ndarray) -> np.ndarray:
        f = self.family
        if f == "parabola":                        # the core's polynomial can fit this exactly
            x = 25.0 * (2 * u - 1)
            return np.stack([x, 28.0 * (1 - (x / 25.0) ** 2)], 1)
        if f == "catenary":
            a, X = 12.0, 25.0
            x = X * (2 * u - 1)
            y = a * (np.cosh(X / a) - np.cosh(x / a))
            return np.stack([x, y * 28.0 / y.max()], 1)
        if f == "ellipse":                         # U-shape from an elliptic arc
            t = np.pi * (1.1 - 1.2 * u) - 0.05 * np.pi
            return np.stack([24.0 * np.cos(t), 30.0 * np.sin(t)], 1)
        if f == "circle":                         # only for checking offset_length against (R + e) * phi
            t = np.pi * (1.0 - u)
            return np.stack([25.0 * np.cos(t), 25.0 * np.sin(t)], 1)
        if f == "skewed":                          # asymmetric parabola (left and right halves differ)
            x = np.where(u < 0.5, -27.0 * (1 - 2 * u), 22.0 * (2 * u - 1))
            X = np.where(x < 0, 27.0, 22.0)
            return np.stack([x, 28.0 * (1 - (x / X) ** 2)], 1)
        raise ValueError(f)

    def at(self, s: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Point, unit tangent and outward unit normal at arc length s (clamped to the curve)."""
        s = float(np.clip(s, 0.0, self.length))
        k = int(np.clip(np.searchsorted(self.s, s), 1, len(self.s) - 1))
        f = (s - self.s[k - 1]) / max(self.s[k] - self.s[k - 1], 1e-12)
        p = self.xy[k - 1] + f * (self.xy[k] - self.xy[k - 1])
        t = self.xy[k] - self.xy[k - 1]
        t = t / np.linalg.norm(t)
        return p, t, np.array([-t[1], t[0]])    # left -> right over the top: (-ty, tx) points outward

    def offset_length(self, e: float, s0: float, s1: float) -> float:
        """Length of the curve offset outward by e, between the normals at arc lengths s0 and s1."""
        k0, k1 = np.searchsorted(self.s, [s0, s1])
        pts = self.xy[k0:k1 + 1]
        t = np.gradient(pts, axis=0)
        t /= np.linalg.norm(t, axis=1, keepdims=True)
        off = pts + e * np.stack([-t[:, 1], t[:, 0]], 1)
        return float(np.linalg.norm(np.diff(off, axis=0), axis=1).sum())


def curve_of_length(family: str, length: float) -> Curve:
    """The family's curve uniformly scaled so its total arc length equals `length`."""
    base = Curve(family).length
    return Curve(family, scale=length / base)


# ------------------------------------------------------------------------------------------------ crowns
def crown(i: int, kind: str) -> trimesh.Trimesh:
    """Crown in its own frame: MD axis = x (extent exactly WIDTHS[i]), BL = y, occlusal face at z = 0, crown to -z."""
    w, d, h = WIDTHS[i], DEPTH[i], HEIGHT[i]
    if kind == "box":
        m = trimesh.creation.box(extents=[w, d, h])
        m.apply_translation([0, 0, -h / 2])
    elif kind == "ellipsoid":
        m = trimesh.creation.icosphere(subdivisions=3)
        m.apply_scale([w / 2, d / 2, h / 2])
        m.apply_translation([0, 0, -h / 2])
    elif kind == "template":                     # real crown shape (concave), rescaled so the MD extent is exactly w
        m = trimesh.load(TEMPLATES / f"{i}.stl", process=True)
        lo, hi = m.bounds
        m.apply_translation([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -hi[2]])
        m.apply_scale([w / m.extents[0], d / m.extents[1], h / m.extents[2]])
    else:
        raise ValueError(kind)
    return m


def _place(m: trimesh.Trimesh, p: np.ndarray, t: np.ndarray, z: float = 0.0, yaw_deg: float = 0.0) -> trimesh.Trimesh:
    """Rotate so local x follows tangent t (plus an extra yaw about the crown's vertical axis), then move to p."""
    a = np.arctan2(t[1], t[0]) + np.radians(yaw_deg)
    T = trimesh.transformations.rotation_matrix(a, [0, 0, 1])
    T[:3, 3] = [p[0], p[1], z]
    out = m.copy()
    out.apply_transform(T)
    return out


# ------------------------------------------------------------------------------------------------ cases
@dataclass
class Truth:
    """What the core should find. Lengths in mm, angles in degrees."""
    widths: dict[int, float]
    arch_length: float                # distal contact of 2 to distal contact of 15 along the ideal arch
    crowding: float                   # sum(widths) - arch_length
    yaw: dict[int, float] = field(default_factory=dict)       # rotation about the crown's vertical axis
    dz: dict[int, float] = field(default_factory=dict)        # vertical offset from the occlusal plane
    curve: Curve | None = None
    s_center: dict[int, float] = field(default_factory=dict)  # arc-length position of each crown centre
    span_crowding: float | None = None    # clinical crowding over SPAN (build_crowded_arch)
    contact_widths: dict[int, float] = field(default_factory=dict)


def build_arch(family: str = "catenary", crowding: float = 0.0, kind: str = "box",
               yaw: dict[int, float] | None = None, dz: dict[int, float] | None = None,
               gap: float = 0.05, bulge: float | None = None) -> tuple[dict[int, trimesh.Trimesh], Truth]:
    """Upper arch with a known space deficit.

    crowding = 0: crowns sit in contact (plus `gap`) along the ideal arch of length sum(widths).
    crowding = D > 0: the ideal arch is shortened by D; the end crowns keep their distal contacts at the arch ends
    and the interior crowns are spaced evenly between them, alternately displaced outward/inward by `bulge`
    (default D/2) — the usual look of a crowded arch. The deficit is exact by construction.
    """
    yaw, dz = yaw or {}, dz or {}
    total = sum(WIDTHS.values())
    n_gaps = len(UPPER) - 1
    L = total - crowding + (n_gaps * gap if crowding == 0 else 0.0)
    cv = curve_of_length(family, L)
    s = {}
    if crowding == 0:
        pos = 0.0
        for i in UPPER:
            s[i] = pos + WIDTHS[i] / 2
            pos += WIDTHS[i] + gap
    else:
        s[2], s[15] = WIDTHS[2] / 2, L - WIDTHS[15] / 2
        inner = UPPER[1:-1]
        span_lo, span_hi = WIDTHS[2], L - WIDTHS[15]
        need = sum(WIDTHS[i] for i in inner)
        f = (span_hi - span_lo) / need
        pos = span_lo
        for i in inner:
            s[i] = pos + f * WIDTHS[i] / 2
            pos += f * WIDTHS[i]
    b = crowding / 2 if bulge is None else bulge
    meshes = {}
    for k, i in enumerate(UPPER):
        p, t, n = cv.at(s[i])
        if crowding > 0 and 0 < k < len(UPPER) - 1:
            p = p + (b if k % 2 else -b) * n
        meshes[i] = _place(crown(i, kind), p, t, z=dz.get(i, 0.0), yaw_deg=yaw.get(i, 0.0))
    # crowding = sum of widths - available arch length (negative = spacing; the aligned arch keeps `gap` between crowns)
    truth = Truth(widths=dict(WIDTHS), arch_length=round(L, 6), crowding=round(total - L, 6),
                  yaw=dict(yaw), dz=dict(dz), curve=cv, s_center=s)
    return meshes, truth


# ------------------------------------------------------------------------------------------------ clinical crowding
SPAN = list(range(4, 14))     # arch length discrepancy span: second premolar to second premolar (Universal 4..13)
CONTACT_BAND = 0.2            # contacts lie in the central 40 % of the crown's bucco-lingual depth


def contact_width(i: int, kind: str) -> float:
    """Mesiodistal width at the contacts, by definition: the crown's extent along its own MD axis (local x) within the
    central bucco-lingual band (|y - centre| <= CONTACT_BAND x half-depth). Boxes: exactly WIDTHS[i]."""
    m = crown(i, kind)
    pts = np.vstack([m.vertices, trimesh.sample.sample_surface(m, 4000, seed=1)[0]])
    y = pts[:, 1]
    mid, half = (y.max() + y.min()) / 2, (y.max() - y.min()) / 2
    x = pts[np.abs(y - mid) <= CONTACT_BAND * half, 0]
    return float(x.max() - x.min())


def build_crowded_arch(family: str = "catenary", deficit: float = 0.0, kind: str = "template",
                       blocked: tuple[int, ...] = (6, 11), gap: float = 0.05) -> tuple[dict[int, trimesh.Trimesh], Truth]:
    """Upper arch crowded the way real arches are: teeth that have no room stand out of the arch, they do not pass
    through their neighbours.

    Every crown sits on the ideal arch in contact with its neighbours (plus `gap`), except the `blocked` teeth: the
    deficit is shared among them, each keeps a slot `deficit / len(blocked)` narrower than its contact width, and it
    stands buccal of the arch by half its own and half its deepest neighbour's depth, so it overlaps its neighbours in
    the occlusal view only. Clinical crowding over SPAN is exact by construction:
    sum of contact widths - arc between the first molars' mesial contacts (Truth.span_crowding).
    """
    cw = {i: contact_width(i, kind) for i in UPPER}
    share = deficit / len(blocked) if blocked and deficit else 0.0
    if any(share > cw[i] for i in blocked):
        raise ValueError("deficit larger than the blocked teeth")
    occ = {i: cw[i] - (share if i in blocked else 0.0) for i in UPPER}     # arc each tooth occupies
    L = sum(occ.values()) + gap * (len(UPPER) - 1)
    cv = curve_of_length(family, L)
    s, contact_s, pos = {}, {}, 0.0
    for k, i in enumerate(UPPER):
        s[i] = pos + occ[i] / 2
        pos += occ[i]
        if k < len(UPPER) - 1:
            contact_s[(i, UPPER[k + 1])] = pos + gap / 2
            pos += gap
    meshes = {}
    for k, i in enumerate(UPPER):
        p, t, n = cv.at(s[i])
        if i in blocked and share:
            nb = [UPPER[j] for j in (k - 1, k + 1) if 0 <= j < len(UPPER)]
            p = p + n * (DEPTH[i] / 2 + max(DEPTH[j] for j in nb) / 2 + 0.3)
        meshes[i] = _place(crown(i, kind), p, t)
    available = contact_s[(13, 14)] - contact_s[(3, 4)]
    truth = Truth(widths=dict(WIDTHS), arch_length=round(L, 6), crowding=round(deficit, 6), curve=cv, s_center=s)
    truth.span_crowding = round(sum(cw[i] for i in SPAN) - available, 6)
    truth.contact_widths = cw
    return meshes, truth


def rigid(meshes: dict[int, trimesh.Trimesh], angle_deg: float, shift=(0.0, 0.0, 0.0)) -> dict[int, trimesh.Trimesh]:
    """Whole-case rotation about z plus translation: nothing the core estimates may change."""
    T = trimesh.transformations.rotation_matrix(np.radians(angle_deg), [0, 0, 1])
    T[:3, 3] = shift
    out = {}
    for i, m in meshes.items():
        c = m.copy()
        c.apply_transform(T)
        out[i] = c
    return out


def spin_tooth(meshes: dict[int, trimesh.Trimesh], i: int, angle_deg: float) -> dict[int, trimesh.Trimesh]:
    """Rotate one crown about its own vertical axis through its centroid (its MD width does not change)."""
    out = dict(meshes)
    m = meshes[i].copy()
    c = m.centroid
    T = trimesh.transformations.rotation_matrix(np.radians(angle_deg), [0, 0, 1], point=[c[0], c[1], 0.0])
    m.apply_transform(T)
    out[i] = m
    return out


def remesh(meshes: dict[int, trimesh.Trimesh]) -> dict[int, trimesh.Trimesh]:
    """Same surfaces, finer triangulation."""
    return {i: m.subdivide() for i, m in meshes.items()}
