"""Label→mesh split on a synthetic merged arch (stands in for a ToothGroupNetwork result)."""
import numpy as np
import trimesh

from cualign.core.segmentation import FDI_TO_UNIVERSAL, split_by_labels
from cualign.core.synth import make_case

UNIVERSAL_TO_FDI = {v: k for k, v in FDI_TO_UNIVERSAL.items()}


def test_split_recovers_every_tooth():
    teeth = make_case("mild")
    parts, labels = [], []
    for tid, m in teeth.items():
        parts.append(m)
        labels.append(np.full(len(m.vertices), UNIVERSAL_TO_FDI[tid]))
    gum = trimesh.creation.box(extents=[70, 40, 2]); gum.apply_translation([0, 16, -12])
    parts.append(gum); labels.append(np.zeros(len(gum.vertices), int))
    merged = trimesh.util.concatenate(parts)
    labels = np.concatenate(labels)
    out = split_by_labels(merged, labels, min_faces=4)
    assert set(out) == set(teeth)
    for tid, m in out.items():
        assert np.allclose(m.centroid, teeth[tid].centroid, atol=1e-6)
