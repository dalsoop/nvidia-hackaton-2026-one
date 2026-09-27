"""Write a scan whose orientation cannot be decided (basis "none") but that is ready to plan (#104, v2 board 09-c).

Closed synthetic crowns without a gingiva file give the orientation step nothing to vote on, so the server keeps the
input frame. Upload the folder's STLs as one scan (POST /api/patients/{pid}/scans) to see «방향을 정하지 못했습니다».

Run: uv run --frozen python scripts/orientation_none_scan.py [out_dir]   (default: out/orientation-none)
"""
import sys
from pathlib import Path

from cualign.core.case import Case

out = Path(sys.argv[1] if len(sys.argv) > 1 else "out/orientation-none")
out.mkdir(parents=True, exist_ok=True)
for i, m in Case.synthetic("mild").mesh.items():
    m.copy().export(out / f"{i}.stl")
print(f"{len(list(out.glob('*.stl')))} closed crowns, no gingiva.stl -> {out.resolve()}")
