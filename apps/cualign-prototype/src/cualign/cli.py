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
    """Rule-based reading of the request (the agent does this with Nemotron; this is the offline stand-in).
    extraction: None when the request does not say (the case's own prescription decides, #46), [] for non-extraction,
    the prescribed teeth ("14번과 24번 발치", "14·24 발치"; the dentist writes FDI, stored as Universal [5, 12], #56 #113),
    "teeth-needed" when extraction is mentioned without teeth — the app does not pick them — "not-fdi" when a named
    tooth is not an upper-arch FDI number (11..18, 21..28), or "ambiguous" when teeth come with a refusal or a change
    ("14번과 24번 발치 금지", "이전엔 14번 발치였고 이번엔 비발치"): a prescription is never guessed."""
    c = {"extraction": None, "months": None, "stage_cap": None, "order": "simultaneous",
         "ipr_surfaces": parse_ipr_surfaces(text)}
    # teeth first: "이전 안은 비발치였고 이번엔 14번과 24번 발치" is a prescription of 14 and 24, not non-extraction
    from cualign.core.fdi import from_fdi
    teeth_list = r"((?:\d{1,2}\s*번?\s*(?:[,·]|과|와|및)?\s*)+)"
    m = re.search(teeth_list + r"번?\s*(?:치아\s*)?발치", text) or re.search(r"발치\s*치아\s*[:：]?\s*" + teeth_list, text)
    fdi = sorted({int(n) for n in re.findall(r"\d{1,2}", m.group(1))}) if m else []
    negated = re.search(r"비발치|금지|말고|취소|대신|이전|예전|전에는|발치\s*(?:는\s*)?(?:없이|하지\s*마|안\s*(?:돼|함))", text)
    if fdi and negated:
        c["extraction"] = "ambiguous"
    elif fdi:
        try:
            c["extraction"] = sorted(from_fdi(f) for f in fdi)
        except ValueError:                      # "5번과 12번": not FDI, so not a prescription the app can read
            c["extraction"] = "not-fdi"
    elif "비발치" in text or ("발치" in text and any(k in text for k in ("없", "피", "싫", "안 돼", "안돼", "금지"))):
        c["extraction"] = []
    elif "발치" in text:
        c["extraction"] = "teeth-needed"
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


def parse_ipr_surfaces(text: str) -> list[list[float]] | None:
    """The per-contact IPR prescription in a request (#57), as [[a, b, mm], ...] in Universal numbers; None when the
    request names no contact. "11-21·11-12·21-22 각 0.4mm": those contacts, 0.4 each. "14-15·24-25부터 앞쪽으로 총
    3.6mm": every contact from each named one forward to the midline, the total shared evenly. "총 X" without 앞쪽으로
    shares X over the named contacts; a contact without an amount is not a prescription (None)."""
    from cualign.core.fdi import from_fdi
    if not re.search(r"IPR", text, re.I):
        return None
    pairs = [(int(a), int(b)) for a, b in re.findall(r"(\d{2})\s*[-–]\s*(\d{2})", text)]
    if not pairs:
        return None
    try:
        pairs = sorted({tuple(sorted((from_fdi(a), from_fdi(b)))) for a, b in pairs})
    except ValueError:
        return None
    each = re.search(r"각\s*(\d+(?:\.\d+)?)\s*mm", text)
    total = re.search(r"총\s*(\d+(?:\.\d+)?)\s*mm", text)
    if re.search(r"(부터|에서)\s*앞쪽으로", text):
        contacts = set()
        for a, b in pairs:            # forward = towards the 8|9 contact
            lo, hi = (a, 8) if b <= 8 else (9, b)
            contacts |= {(k, k + 1) for k in range(lo, hi)} | {(8, 9)}
        pairs = sorted(contacts)
    if each:
        mm = float(each.group(1))
    elif total:
        mm = round(float(total.group(1)) / len(pairs), 4)
    else:
        return None
    return [[a, b, mm] for a, b in pairs]


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
    if c["extraction"] == "ambiguous":
        raise SystemExit("[확인 필요] 발치할 치아와 금지·변경 표현이 함께 있어 처방을 판단할 수 없습니다. "
                         "\"14번과 24번 발치\" 또는 \"발치 없이\"처럼 처방만 적어 주세요.")
    if c["extraction"] == "teeth-needed":
        raise SystemExit("[확인 필요] 발치할 치아 번호를 함께 적어 주세요(FDI, 예: \"14번과 24번 발치\"). 앱은 발치 치아를 고르지 않습니다.")
    if c["extraction"] == "not-fdi":
        raise SystemExit("[확인 필요] 발치 치아는 상악 FDI 번호(11~18, 21~28)로 적어 주세요(예: \"14번과 24번 발치\").")
    res = rule_based_plan(args.case, extraction=c["extraction"], stage_cap=c["stage_cap"], order=c["order"],
                          ipr_surfaces=c["ipr_surfaces"])
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
    if os.name != "nt":
        os.execv(sys.executable, cmd)
    # os.execv on Windows starts a new process and ends this one, so serve returned at once and left the server behind (#83)
    # nat serve dies with this process, and this process with the uv.exe or shell that started it (winjob.py)
    from cualign import winjob
    if not winjob.kill_children_with_this_process():
        print("[warn] could not tie nat serve to this process — stop the server by its port if it outlives serve")
    launcher = winjob.launcher_pid()
    if launcher is not None:
        winjob.exit_when_gone(launcher)
    raise SystemExit(subprocess.call(cmd))


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
