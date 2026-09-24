"""SkillSpector scans of skills/cualign-clinical-rules: static (--no-llm) and semantic on Nemotron via NIM.

    python scripts/scan_skill.py [--skillspector <path to skillspector executable>]

Semantic scan needs NVIDIA_INFERENCE_KEY (SkillSpector's variable name); we map it from NVIDIA_API_KEY in .env.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skillspector", default=shutil.which("skillspector"))
    ap.add_argument("--model", default="nvidia/nemotron-3-super-120b-a12b")
    args = ap.parse_args()
    if not args.skillspector:
        print("[error] skillspector not found (pip install skillspector)")
        return 2
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    env = dict(os.environ)
    env.setdefault("NVIDIA_INFERENCE_KEY", env.get("NVIDIA_API_KEY", ""))
    env["SKILLSPECTOR_PROVIDER"] = "nv_build"
    env["SKILLSPECTOR_MODEL"] = args.model
    skill = str(ROOT / "skills" / "cualign-clinical-rules")
    runs = [("static", ["--no-llm", "--output", str(ROOT / "skills" / "skillspector-report-static.md")]),
            ("semantic", ["--output", str(ROOT / "skills" / "skillspector-report.md")])]
    rc = 0
    for tag, extra in runs:
        cmd = [args.skillspector, "scan", skill, "--format", "markdown", *extra]
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, cwd=ROOT)
        out = (p.stdout + p.stderr)
        for k in ("NVIDIA_INFERENCE_KEY", "NVIDIA_API_KEY"):
            if env.get(k):
                out = out.replace(env[k], "nvapi-***")
        print(f"[{tag}] exit={p.returncode}")
        print("\n".join(ln for ln in out.splitlines() if any(s in ln for s in ("Score", "Recommendation", "Report saved", "Error", "error"))))
        rc |= p.returncode
    return rc


if __name__ == "__main__":
    sys.exit(main())
