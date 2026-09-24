"""Build per-tooth crown templates from the CC-BY "Dental arches" scan (Lydran96, Sketchfab).

Input : the model's source STL (`Arcata.stl`, ~62 MB, both arches with roots, one connected component per tooth).
Output: src/cualign/core/templates/<universal_id>.stl (14 upper teeth, mm, occlusal face at z=0, MD axis along x,
        crown + 3 mm of root, ~4k faces each) + ATTRIBUTION.md with the CC-BY credit line.

  uv run python scripts/import_tooth_templates.py <path/to/Arcata.stl>

The scan is in cm and anatomically oriented (upper arch above the lower one, crowns pointing down). We keep the
upper arch only, scale to mm, flip it so the occlusal surface faces +z like the synthetic crowns, and number the
teeth 2..15 along the arch from the viewer's left (same convention as cualign.core.synth).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import trimesh

OUT = Path(__file__).resolve().parents[1] / "src" / "cualign" / "core" / "templates"
CREDIT = ('This work is based on "Dental arches" (https://sketchfab.com/3d-models/dental-arches-a17fda74c85344709624e9e39a6634b6) '
          'by Lydran96 (https://sketchfab.com/Lydran96) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)')
SCALE = 10.0          # cm -> mm
ROOT_KEEP_MM = 3.0    # keep this much root below the crown (collision hulls stay crown-dominated)
FACES = 4000
# Universal id -> anatomical crown height (mm), Wheeler's averages rounded
CROWN_H = {2: 7.0, 3: 7.5, 4: 8.0, 5: 8.5, 6: 10.0, 7: 9.0, 8: 10.5, 9: 10.5, 10: 9.0, 11: 10.0, 12: 8.5, 13: 8.0, 14: 7.5, 15: 7.0}


def main(stl: str) -> int:
    m = trimesh.load(stl, process=True, force="mesh")
    m.merge_vertices()
    parts = [p for p in m.split(only_watertight=False) if len(p.faces) > 1000 and p.is_watertight]
    print(f"components: {len(parts)} watertight teeth")
    z = np.array([p.centroid[2] for p in parts])
    upper = [p for p, zc in zip(parts, z) if zc > z.mean()]      # upper arch sits above the lower one
    if len(upper) != 14:
        print(f"expected 14 upper teeth, got {len(upper)}")
        return 1
    # Anatomical frame: upper crowns point down (-z). Rotate 180 deg about x so occlusal faces +z (synth convention).
    R = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])
    for p in upper:
        p.apply_transform(R)
        p.apply_scale(SCALE)
    c = np.array([p.centroid for p in upper])
    # Anterior = the arch apex, i.e. the tooth farthest from the chord between the two end teeth (found by PCA order).
    ctr = c[:, :2].mean(0)
    ang = np.arctan2(c[:, 1] - ctr[1], c[:, 0] - ctr[0])
    order = np.argsort(ang)
    # Make the angular order start at one end of the arch: the largest angular gap is the open (posterior) side.
    a = ang[order]
    gaps = np.diff(np.concatenate([a, [a[0] + 2 * np.pi]]))
    start = (int(np.argmax(gaps)) + 1) % 14
    order = np.roll(order, -start)
    ends = c[order[0], :2], c[order[-1], :2]
    mid = (ends[0] + ends[1]) / 2
    apex = c[order[7], :2]
    to_apex = apex - mid
    theta = np.pi / 2 - np.arctan2(to_apex[1], to_apex[0])       # rotate so anterior points +y
    Rz = trimesh.transformations.rotation_matrix(theta, [0, 0, 1])
    for p in upper:
        p.apply_transform(Rz)
    c = np.array([p.centroid for p in upper])
    order = list(order)
    if c[order[0], 0] > c[order[-1], 0]:      # number 2..15 from x- to x+ (viewer's left to right, as in synth)
        order.reverse()
    ids = list(range(2, 16))
    print("arch order centroids (x, y):", [tuple(np.round(c[k, :2], 1)) for k in order])
    OUT.mkdir(parents=True, exist_ok=True)
    for tid, k in zip(ids, order):
        p = upper[k]
        k0, k1 = order[max(ids.index(tid) - 1, 0)], order[min(ids.index(tid) + 1, 13)]
        t = c[k1, :2] - c[k0, :2]
        phi = np.arctan2(t[1], t[0])
        q = p.copy()
        q.apply_transform(trimesh.transformations.rotation_matrix(-phi, [0, 0, 1], point=p.centroid))
        q.apply_translation([-q.centroid[0], -q.centroid[1], -q.bounds[1][2]])   # xy centred, occlusal at z=0
        # crown height by tooth type (textbook, mm); keep crown + ROOT_KEEP_MM of root
        zcut = -(CROWN_H[tid] + ROOT_KEEP_MM)
        box = trimesh.creation.box(extents=[60, 60, 60], transform=trimesh.transformations.translation_matrix([0, 0, zcut + 30]))
        q = trimesh.boolean.intersection([q, box], engine="manifold")   # keep crown + a little root; stays watertight
        if len(q.faces) > FACES:
            q = q.simplify_quadric_decimation(face_count=FACES)
        q.export(OUT / f"{tid}.stl")
        print(f"tooth {tid:2d}: MD {q.extents[0]:5.2f} BL {q.extents[1]:5.2f} H {q.extents[2]:5.2f} mm · faces {len(q.faces)} · watertight {q.is_watertight}")
    (OUT / "ATTRIBUTION.md").write_text(
        "# Tooth templates — attribution\n\n" + CREDIT + "\n\n"
        "Processed by scripts/import_tooth_templates.py: upper arch only, cm→mm, occlusal face at z=0, "
        "crown + 3 mm root, decimated to ~4k faces. Used as crown shapes for the synthetic cases in cualign.core.synth.\n",
        encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
