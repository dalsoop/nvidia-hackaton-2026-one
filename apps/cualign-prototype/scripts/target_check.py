"""Before/after check of the target planner on the bundled samples: per case+strategy stages, moves, rotations and
rule violations -> JSON, and optionally a top-view picture of stage 0 vs target (crown outlines, centres, long-axis
arrows, FDI numbers, rotation) -> PNG.

  uv run --frozen --with matplotlib python scripts/target_check.py <tag> [--png-dir DIR]

<tag> names the run ("before", "after", a commit) and goes into the file names. The table is printed and written to
out/target-check/ab_<tag>.json. With --png-dir, the three real samples are drawn to DIR/<case>_<strategy>_<tag>.png
(synthetic cases have no picture). To compare two states of the planner, run once per state with different tags and
diff the two JSON files / look at the PNGs side by side (matplotlib is only needed for --png-dir).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / "src"))
from cualign.core import planner  # noqa: E402
from cualign.core.case import Case  # noqa: E402
from cualign.core.constraints import Constraints  # noqa: E402
from cualign.core.fdi import to_fdi  # noqa: E402

SAMPLES = APP / "src" / "cualign" / "core" / "samples"
OUT = APP / "out" / "target-check"

CASES = [
    ("poseidon-000097", "extraction", {"extraction": [5, 12]}),
    ("poseidon-000001", "expansion_ipr", {"extraction": [], "ipr_exclude": [2, 3, 14, 15], "ipr_limit_mm": 0.25}),
    ("poseidon-000131", "ipr", {"extraction": [], "ipr_exclude": [2, 3, 4, 5, 6, 11, 12, 13, 14, 15], "ipr_limit_mm": 0.25}),
    ("synthetic:moderate", "expansion_ipr", {}),
    ("synthetic:severe", "extraction", {"extraction": [5, 12]}),
]


def load(cid: str) -> Case:
    if cid.startswith("synthetic:"):
        return Case.synthetic(cid.split(":")[1])
    return Case.from_dir(SAMPLES / cid)


def run(cid, strategy, cons) -> tuple[dict, Case, dict]:
    case = load(cid)
    c = Constraints(**cons) if cons else None
    t0 = time.time()
    target, info = planner.propose_target(case, strategy, constraints=c)
    stages, sinfo = planner.plan_stages(case, target)
    viol = planner.validate(case, stages, space_deficit_mm=info["space_deficit_mm"], constraints=c, target_info=info)
    moves = {i: (None if v is None else round(float(np.linalg.norm(v)), 2)) for i, v in target.items()}
    row = {"case": cid, "strategy": strategy, "seconds": round(time.time() - t0, 1),
           "crowding_mm": info["crowding_mm"], "space_deficit_mm": info["space_deficit_mm"],
           "expansion_mm_per_side": info["expansion_mm_per_side"],
           "n_stages": sinfo["n_stages"], "months": sinfo["months"], "max_move_mm": info["max_move_mm"],
           "mean_move_mm": info["mean_move_mm"], "rotation_deg": {str(i): y for i, y in info["rotation_deg"].items()},
           "moves_mm": {str(i): m for i, m in moves.items()}, "violations": planner.summarize(viol),
           "viol_detail": [dict(x) for x in viol[:12]], "notes": info["notes"]}
    return row, case, target


def draw(case: Case, target: dict, path: Path, title: str):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.spatial import ConvexHull
    fig, axes = plt.subplots(1, 2, figsize=(15, 7.5))
    for ax, which in zip(axes, ("stage 0", "target")):
        for i in case.ids:
            d = target.get(i)
            if which == "target" and d is None:
                continue
            yaw = planner.yaw_of(target, i) if which == "target" else 0.0
            disp = np.zeros(3) if which == "stage 0" else d
            V = case.placed(i, disp, yaw, hull=True).vertices[:, :2]
            poly = V[ConvexHull(V).vertices]
            ax.fill(poly[:, 0], poly[:, 1], alpha=0.15, color="C0")
            ax.plot(np.append(poly[:, 0], poly[0, 0]), np.append(poly[:, 1], poly[0, 1]), color="C0", lw=0.8)
            c = case.anchor[i][:2] + disp[:2]
            a = case._md_axis(i)[2] + np.radians(yaw)
            u = np.array([np.cos(a), np.sin(a)])
            ax.annotate("", xy=c + 4 * u, xytext=c - 4 * u, arrowprops=dict(arrowstyle="->", color="C3", lw=1.4))
            ax.plot(c[0], c[1], "k.", ms=3)
            ax.text(c[0], c[1] + 1.0, f"{to_fdi(i)}" + (f"\n{yaw:+.0f}°" if yaw else ""), ha="center", fontsize=7)
        ax.set_aspect("equal")
        ax.set_title(f"{title} - {which}")
        ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)


def main():
    tag = sys.argv[1]
    png_dir = Path(sys.argv[sys.argv.index("--png-dir") + 1]) if "--png-dir" in sys.argv else None
    out = []
    for cid, strategy, cons in CASES:
        row, case, target = run(cid, strategy, cons)
        out.append(row)
        print(f"{cid:22s} {strategy:14s} stages {row['n_stages']:3d} max {row['max_move_mm']:.2f} mean {row['mean_move_mm']:.2f} "
              f"rot {len(row['rotation_deg'])} viol {row['violations']}  ({row['seconds']}s)")
        if png_dir and not cid.startswith("synthetic"):
            png_dir.mkdir(parents=True, exist_ok=True)
            draw(case, target, png_dir / f"{cid}_{strategy}_{tag}.png", f"{cid} {strategy} [{tag}]")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"ab_{tag}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
