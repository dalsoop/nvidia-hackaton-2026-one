"""Procedural gingiva for the viewer: a rounded ridge swept along the case's fitted arch, under the crowns.

Display only — never part of collision checks or exports. Built from the arch (so it also works for uploaded
per-tooth scans) and from each crown's gingival level, so the ridge hugs the teeth of crowded and aligned
cases alike. Coordinates follow the case: occlusal plane z=0, crowns below (-z).
"""
from __future__ import annotations

import numpy as np
import trimesh

from .arch import Arch

RIDGE_HALF_WIDTH = 7.0     # mm, buccal-lingual half width of the ridge at the gum line
RIDGE_DEPTH = 14.0         # mm, how far the gum extends below the gum line
OVERLAP = 1.0              # mm the gum climbs onto the crown above the root cut
END_MARGIN = 5.0           # mm past the last tooth on each side


def make_gum(arch: Arch, teeth: dict[int, trimesh.Trimesh], pos0: dict[int, np.ndarray],
             n_along: int = 120, n_around: int = 14) -> trimesh.Trimesh:
    ids = sorted(teeth)
    s_teeth = np.array([arch.s_of(pos0[i]) for i in ids])
    # Gum line per tooth: crown's lowest point (root cut) plus a small overlap onto the crown.
    z_teeth = np.array([teeth[i].bounds[0][2] + OVERLAP for i in ids])
    order = np.argsort(s_teeth)
    s_teeth, z_teeth = s_teeth[order], z_teeth[order]

    pts, cum = arch.samples(0.0)
    s_lo, s_hi = s_teeth[0] - END_MARGIN, s_teeth[-1] + END_MARGIN
    ss = np.linspace(s_lo, s_hi, n_along)
    z_line = np.interp(ss, s_teeth, z_teeth)
    # outward normal, same convention as Arch.samples(offset): away from the inside of the U
    inside = pts.mean(0)
    verts = []
    for s, z0 in zip(ss, z_line):
        p = arch.point(float(s))
        t = arch.tangent(float(s))
        n = np.array([-t[1], t[0]])
        p_local = arch.to_local(np.array([p[0], p[1], 0.0]))
        if np.dot(p_local - inside, arch.to_local(np.array([p[0] + n[0], p[1] + n[1], 0.0])) - p_local) < 0:
            n = -n
        # half-ellipse cross-section from lingual (-n) over the top to buccal (+n), then straight down.
        for k in range(n_around):
            a = np.pi * k / (n_around - 1)               # 0..pi
            w = -np.cos(a) * RIDGE_HALF_WIDTH            # -W .. +W
            bulge = np.sin(a) * 2.0                      # rounded crest
            verts.append([p[0] + n[0] * w, p[1] + n[1] * w, z0 + bulge - 2.0])
        for k in range(n_around):
            a = np.pi * k / (n_around - 1)
            w = np.cos(a) * RIDGE_HALF_WIDTH * 1.15      # bottom ring, slightly wider, reversed so the loop closes
            verts.append([p[0] + n[0] * w, p[1] + n[1] * w, z0 - RIDGE_DEPTH])
    V = np.array(verts)
    ring = 2 * n_around
    faces = []
    for i in range(n_along - 1):
        for k in range(ring):
            a, b = i * ring + k, i * ring + (k + 1) % ring
            c, d = (i + 1) * ring + k, (i + 1) * ring + (k + 1) % ring
            faces += [[a, c, b], [b, c, d]]
    # end caps (fan)
    for base in (0, (n_along - 1) * ring):
        centre = len(V)
        V = np.vstack([V, V[base:base + ring].mean(0)])
        for k in range(ring):
            faces.append([centre, base + (k + 1) % ring, base + k] if base == 0 else [centre, base + k, base + (k + 1) % ring])
    m = trimesh.Trimesh(vertices=V, faces=np.array(faces), process=False)
    m.fix_normals()
    return m
