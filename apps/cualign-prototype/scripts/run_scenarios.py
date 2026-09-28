"""Run the three demo scenarios live against NIM with `nat run` and cache the logs under docs/demo/.

    python scripts/run_scenarios.py [--llm nim_super|nim_lightning] [--only 1,2,3]

The key is read from .env into the environment only; any `nvapi-...` string is masked before writing logs.
Cached logs are the fallback if the live model call fails during a demo.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = {
    1: ("pass", "moderate 케이스로. 발치 없이 12개월 안에 끝나는 계획 짜줘. 앞니 총생부터 풀고."),
    2: ("honest-fail", "severe 케이스로. 발치는 절대 안 돼. 8개월 안에 끝나는 계획으로 짜줘."),
    3: ("compare", "severe 케이스로. 발치안이랑 비발치안 둘 다 만들어서 비교해줘. 기간 제한은 없어."),
    4: ("interview", "moderate 케이스 계획 짜줘."),
    5: ("revise", "moderate 케이스, 발치 없이, 기간 제한 없이. IPR 은 앞니 7,8,9,10번 빼고, 3번과 14번은 움직이지 마."),
}
NOISE = ("Deprecation", "joserfc", "from authlib", "warnings.warn", "UserWarning", "nim_url")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", default="nim_super")
    ap.add_argument("--only", default="1,2,3,4,5")
    ap.add_argument("--native", default="true", help="use_native_tool_calling (lightning 30B works better with false)")
    args = ap.parse_args()
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    if not os.environ.get("NVIDIA_API_KEY", "").startswith("nvapi-"):
        print("[error] NVIDIA_API_KEY missing (.env)"); return 2
    out_dir = ROOT / "docs" / "demo"; out_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1", CUALIGN_OUT=str(ROOT / "out"))
    summary = []
    for n in [int(x) for x in args.only.split(",") if x.strip()]:
        tag, text = SCENARIOS[n]
        cmd = [sys.executable, "-m", "nat.cli.main", "run", "--config_file", str(ROOT / "configs" / "workflow.yml"),
               "--override", "workflow.llm_name", args.llm,
               "--override", "workflow.use_native_tool_calling", args.native, "--input", text]
        t0 = time.time()
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, cwd=ROOT)
        dt = time.time() - t0
        raw = (p.stdout or "") + "\n" + (p.stderr or "")
        raw = re.sub(r"nvapi-[A-Za-z0-9_\-]+", "nvapi-***", raw)
        keep = [ln for ln in raw.splitlines() if ln.strip() and not any(s in ln for s in NOISE)]
        tools = re.findall(r"cualign__[a-z_]+", raw)
        final = ""
        if "Workflow Result:" in raw:
            final = raw.split("Workflow Result:")[-1].strip()[:1500]
        mode = "native" if args.native.lower() == "true" else "react"
        log = out_dir / f"scenario-{n}-{tag}-{args.llm}-{mode}.log"
        log.write_text(f"# scenario {n} ({tag}) · llm={args.llm} · exit={p.returncode} · {dt:.1f}s\n# input: {text}\n\n"
                       + "\n".join(keep[-400:]), encoding="utf-8")
        summary.append((n, tag, p.returncode, round(dt, 1), len(tools), final.replace("\n", " ")[:160]))
        print(f"[{n} {tag}] exit={p.returncode} {dt:.1f}s tool-calls={len(tools)} -> {log.name}")
        print("   ", final.replace("\n", " ")[:300])
    md = ["| # | scenario | exit | seconds | tool calls | final answer (head) |", "|---|---|---|---|---|---|"]
    md += [f"| {a} | {b} | {c} | {d} | {e} | {f} |" for a, b, c, d, e, f in summary]
    # the summary is a document, so its name is kebab-case (CONTRIBUTING «문서 파일 이름»); the logs keep the llm name
    (out_dir / f"summary-{args.llm.replace('_', '-')}-{mode}.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
