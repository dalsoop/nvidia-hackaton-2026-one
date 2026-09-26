"""cualign CLI — everything that works without an LLM.

  cualign cases build [--out data/cases]        write the synthetic presets as <id>.stl folders
  cualign plan "발치 없이 12개월 안에" [--case moderate] rule-based version of the agent loop (no NIM needed)
  cualign bench                                 write bench/results.md
  cualign serve                                 nat serve with configs/workflow.yml (needs NVIDIA_API_KEY)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def parse_constraints(text: str) -> dict:
    """Rule-based reading of the request (the agent does this with Nemotron; this is the offline stand-in)."""
    c = {"allow_extraction": True, "months": None, "stage_cap": None, "order": "simultaneous"}
    if "발치" in text and any(k in text for k in ("없", "피", "싫", "안 돼", "안돼", "금지")):
        c["allow_extraction"] = False
    m = re.search(r"(\d+)\s*개월", text)
    if m:
        from cualign.core.limits import stage_cap_from_months
        c["months"] = int(m.group(1)); c["stage_cap"] = stage_cap_from_months(c["months"])
    m = re.search(r"(\d+)\s*장", text)
    if m:
        c["stage_cap"] = int(m.group(1))
    if "앞니 먼저" in text or "앞니부터" in text or "총생부터" in text:
        c["order"] = "anterior_first"
    return c


def cmd_cases(args):
    from cualign.core.case import Case
    from cualign.core.synth import PRESETS, save_case
    for name in PRESETS:
        save_case(Case.synthetic(name).mesh, Path(args.out) / name)     # calibrated to the preset's crowding
        print(f"[cases] {name:11s} -> {Path(args.out) / name}")


def cmd_plan(args):
    from cualign.server.api import rule_based_plan
    if args.export:
        raise SystemExit("[거부] CLI 초안은 미승인입니다. UI에서 계획 생성·의사 승인 후 다운로드하세요.")
    t0 = time.time()
    c = parse_constraints(args.request)
    print(f"[요청] {args.request}\n[제약] {json.dumps(c, ensure_ascii=False)}")
    res = rule_based_plan(args.case, c["allow_extraction"], c["stage_cap"], c["order"])
    for r in res["tried"]:
        flag = "통과" if r["passed"] else f"실패 {r['by_type']}"
        print(f"[시도] {r['strategy']:14s} {r['n_stages']:3d}장 {r['months']:4.1f}개월  {flag}")
    if res["chosen"]:
        print(f"[결과] {res['chosen']['strategy']} · {res['chosen']['n_stages']}장 · {res['chosen']['months']}개월 · plan {res['chosen']['plan_id']}")
    else:
        b = res["best_failed"]
        print(f"[결과] 허용 전략 전부 실패 — 최선 {b['strategy']} ({b['by_type']}). 조건 완화가 필요합니다.")
    print(f"[완료] {time.time() - t0:.1f}s · 이 계획은 초안입니다. 최종 판단은 의사가 합니다.")


def cmd_bench(args):
    sys.path.insert(0, str(ROOT / "bench"))
    import bench  # type: ignore
    bench.main(out=args.out)


def cmd_serve(args):
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    os.environ.setdefault("NAT_TELEMETRY_ENABLED", "0")  # no NAT CLI usage telemetry, and no consent prompt
    from cualign.keys import nvidia_key_available
    if not nvidia_key_available():
        print("[warn] NVIDIA_API_KEY not set — the agent will fail; /ui and the rule-based fallback still work")
    cmd = [sys.executable, "-m", "nat.cli.main", "serve", "--config_file", str(ROOT / "configs" / "workflow.yml"),
           "--host", args.host, "--port", str(args.port)]
    os.execv(sys.executable, cmd)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="cualign")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("cases"); p.add_argument("action", choices=["build"]); p.add_argument("--out", default="data/cases"); p.set_defaults(fn=cmd_cases)
    p = sub.add_parser("plan"); p.add_argument("request"); p.add_argument("--case", default="moderate"); p.add_argument("--export", default=None); p.set_defaults(fn=cmd_plan)
    p = sub.add_parser("bench"); p.add_argument("--out", default="bench/results.md"); p.set_defaults(fn=cmd_bench)
    p = sub.add_parser("serve"); p.add_argument("--host", default="0.0.0.0"); p.add_argument("--port", type=int, default=8000); p.set_defaults(fn=cmd_serve)
    args = ap.parse_args(argv)
    args.fn(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
