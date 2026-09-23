"""Scan → per-tooth meshes.

An intraoral scanner exports ONE mesh per arch (teeth + gingiva). Splitting it into teeth is a separate
step. We wrap ToothGroupNetwork (3DTeethSeg'22 winner, checkpoints in-repo) as an external tool:

    python inference_mid.py --input_path <dir with <case>_upper.obj> --save_path <dir>   -> <case>_upper.json

and then cut the scan mesh by the predicted per-vertex labels. FDI labels (11..28 upper) are mapped to
Universal numbering, which the rest of cuAlign uses.

Status: the label→mesh split is unit-tested on a synthetic merged arch. Running ToothGroupNetwork itself
needs its checkout + torch/CUDA (`CUALIGN_TGN_DIR`); we did not run it in this repo — see docs/segmentation.md.
If you do not have it, upload already-separated <id>.stl files instead.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import trimesh

# FDI -> Universal, upper arch
FDI_TO_UNIVERSAL = {18: 1, 17: 2, 16: 3, 15: 4, 14: 5, 13: 6, 12: 7, 11: 8,
                    21: 9, 22: 10, 23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16}


def stl_to_obj(stl_path: str | os.PathLike, obj_path: str | os.PathLike) -> str:
    m = trimesh.load(str(stl_path), force="mesh")
    m.export(str(obj_path))
    return str(obj_path)


def run_toothgroupnetwork(input_dir: str | os.PathLike, save_dir: str | os.PathLike,
                          tgn_dir: str | None = None) -> None:
    """Invoke the upstream inference script. Requires a ToothGroupNetwork checkout with its checkpoints."""
    tgn_dir = tgn_dir or os.environ.get("CUALIGN_TGN_DIR")
    if not tgn_dir or not Path(tgn_dir, "inference_mid.py").exists():
        raise FileNotFoundError("ToothGroupNetwork checkout not found; set CUALIGN_TGN_DIR (see docs/segmentation.md)")
    subprocess.run([sys.executable, "inference_mid.py", "--input_path", str(input_dir), "--save_path", str(save_dir)],
                   cwd=tgn_dir, check=True)


def split_by_labels(mesh: trimesh.Trimesh, vertex_labels: np.ndarray, numbering: str = "fdi",
                    min_faces: int = 20) -> dict[int, trimesh.Trimesh]:
    """Cut one arch mesh into per-tooth meshes using per-vertex labels (0 = gingiva).

    A face belongs to the label held by the majority of its three vertices.
    """
    labels = np.asarray(vertex_labels).astype(int)
    if len(labels) != len(mesh.vertices):
        raise ValueError("one label per vertex expected")
    fl = labels[mesh.faces]                                   # (F, 3)
    # majority vote per face
    face_label = np.where(fl[:, 0] == fl[:, 1], fl[:, 0], np.where(fl[:, 0] == fl[:, 2], fl[:, 0], fl[:, 1]))
    out: dict[int, trimesh.Trimesh] = {}
    for lab in np.unique(face_label):
        if lab == 0:
            continue
        tid = FDI_TO_UNIVERSAL.get(int(lab), int(lab)) if numbering == "fdi" else int(lab)
        sub = mesh.submesh([np.where(face_label == lab)[0]], append=True)
        if isinstance(sub, list):
            sub = trimesh.util.concatenate(sub)
        if len(sub.faces) >= min_faces:
            out[tid] = sub
    return out


def split_scan(obj_path: str | os.PathLike, json_path: str | os.PathLike, out_dir: str | os.PathLike) -> list[int]:
    """Apply a ToothGroupNetwork result json ({"labels": [...per vertex], ...}) to the scan mesh; write <id>.stl."""
    mesh = trimesh.load(str(obj_path), force="mesh", process=False)
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    teeth = split_by_labels(mesh, np.asarray(data["labels"]))
    os.makedirs(out_dir, exist_ok=True)
    for tid, m in teeth.items():
        m.export(os.path.join(out_dir, f"{tid}.stl"))
    return sorted(teeth)
