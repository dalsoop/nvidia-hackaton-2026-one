"""Turn a verbose `nat run` log (docs/demo/scenario-*.log, written by scripts/run_scenarios.py) into a Trace.

Reads only what NAT prints: `Calling tools:` / `Tool's input:` / `Tool's response:` blocks, tool retry failures,
ReAct parse retries and the `Workflow Result:`. Single-turn only (one `nat run --input`).
run_scenarios.py keeps the last 400 log lines, so a long run can lose its first tool calls; that is flagged in
trace.meta["truncated"] rather than guessed around.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

from .trace import ToolCall, Trace, Turn, normalize_tool_name

ANSI = re.compile(r"\x1b\[[0-9;]*m")
SEP = re.compile(r"^-{20,}\s*$")
DEMO_LOG_SPEC = {"scenario-1": "A04", "scenario-2": "A05", "scenario-3": "A06", "scenario-4": "A01", "scenario-5": "A08"}


def _literal(text: str):
    text = text.strip()
    try:
        v = ast.literal_eval(text)
    except (ValueError, SyntaxError):
        return text
    if isinstance(v, list) and len(v) == 1:   # NAT prints tool output wrapped in a one-element list
        v = v[0]
    return v


def parse_nat_log(path: str | Path, spec_id: str | None = None) -> Trace:
    raw = Path(path).read_text(encoding="utf-8")
    lines = [ANSI.sub("", ln) for ln in raw.splitlines()]
    header = {}
    for ln in lines[:3]:
        if ln.startswith("# input:"):
            header["input"] = ln[len("# input:"):].strip()
        elif ln.startswith("# scenario"):
            header["title"] = ln[2:].strip()
    turn = Turn(user=header.get("input", ""))
    k = 0
    while k < len(lines):
        ln = lines[k]
        if ln.startswith("Calling tools:"):
            name, agent = normalize_tool_name(ln.split(":", 1)[1].strip())
            args, resp = {}, []
            k += 1
            if k < len(lines) and lines[k].startswith("Tool's input:"):
                args = _literal(lines[k].split(":", 1)[1])
                args = args if isinstance(args, dict) else {"raw": args}
                k += 1
            if k < len(lines) and lines[k].startswith("Tool's response:"):
                first = lines[k].split(":", 1)[1]
                resp = [first] if first.strip() else []
                k += 1
                while k < len(lines) and not SEP.match(lines[k]):
                    resp.append(lines[k]); k += 1
            result = _literal("\n".join(resp))
            if name == "reviewer":
                args = {"plan_id": str(args.get("input_message", args.get("raw", ""))).strip()}
                agent = "planner"
            call = ToolCall(name=name, args=args, result=result if result != "" else None, agent=agent)
            if isinstance(result, str) and result.startswith(("Error", "Tool call failed")):
                call.error, call.result = result, None
            turn.calls.append(call)
            continue
        m = re.search(r"Tool call attempt \d+/\d+ failed for tool (\S+?):?\s+(.*)", ln)
        if m:
            # an internal NAT retry of one logical call: record it as an error event, not as another planner call
            turn.errors.append(f"retry {m.group(1)}: {m.group(2)[:280]}")
        elif "Tool call failed after all retry attempts" in ln:
            turn.errors.append(ln.strip()[:300])
        elif "Retrying ReAct Agent" in ln:
            turn.parse_retries += 1
        elif ln.startswith("Workflow Result:"):
            body = []
            k += 1
            while k < len(lines) and not SEP.match(lines[k]):
                body.append(lines[k]); k += 1
            turn.answer = "\n".join(body).strip()
            continue
        k += 1
    # run_scenarios.py writes 2 header lines + a blank line + the last 400 non-empty log lines
    saved = len(raw.splitlines()) - 3
    meta = {"source": str(path), "title": header.get("title", ""), "truncated": saved >= 400}
    agent = "-".join(Path(path).stem.split("-")[-2:])   # scenario-2-honest-fail-nim_super-native -> nim_super-native
    return Trace(spec_id=spec_id, agent=f"nat:{agent}", turns=[turn], meta=meta)
