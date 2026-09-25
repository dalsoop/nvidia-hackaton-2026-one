"""Run golden-set A specs against the real NAT workflow in-process and write Trace JSON for the judge.

    python -m evals.golden_a.runner --plan                          # what would run, how many model calls (free)
    python -m evals.golden_a.runner --specs A01,A04 --k 3           # live: needs NVIDIA_API_KEY, uses NIM quota
    python -m evals.golden_a.judge --traces out/golden_a/<run>      # score the written traces

How a run is recorded
  * tool calls: NAT intermediate steps (FUNCTION_START/END) — names, arguments and results as the agent saw them,
    no log-text parsing. Calls of the reviewer's own tools (cualign_ro__*) are marked agent="reviewer".
  * ReAct parse retries and NAT tool-call retries: counted from NAT's log records ("Retrying ReAct Agent",
    "Tool call attempt ... failed").
  * multi-turn specs: every turn is sent as a ChatRequest carrying the previous user/assistant messages; the
    in-process cuAlign STORE keeps plans between turns and is reset between runs.
  * fault injection (spec.fault_injection.reviewer = "empty"): the reviewer agent's LLM is pointed at a local fake
    server that returns empty completions (the KNOWN_ISSUES failure). The planner keeps the real model.

Guardrails are not in this path (they wrap the HTTP front end), same as `nat run`.
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import contextlib
import copy
import json
import logging
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import yaml

from .judge import Spec, load_specs
from .trace import ToolCall, Trace, Turn, normalize_tool_name

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / "configs" / "workflow.yml"


# ---------------------------------------------------------------------------------------------- config
def build_config(llm: str = "nim_super", reviewer_llm: dict | None = None, all_llms: dict | None = None) -> dict:
    """workflow.yml with the planner model selected, optionally the reviewer (or every LLM) replaced."""
    cfg = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    cfg.pop("general", None)   # front end (FastAPI worker, CORS) is not used in-process
    if all_llms is not None:
        cfg["llms"] = {name: dict(all_llms) for name in cfg["llms"]}
    cfg["workflow"]["llm_name"] = llm
    if reviewer_llm is not None:
        cfg["llms"]["fault_reviewer"] = reviewer_llm
        cfg["functions"]["reviewer"]["llm_name"] = "fault_reviewer"
    return cfg


# ---------------------------------------------------------------------------------------------- capture
def _parse(value: Any) -> Any:
    if hasattr(value, "content") and not isinstance(value, (str, dict)):   # ToolMessage and friends
        value = value.content
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    if isinstance(value, str):
        s = value.strip()
        for loader in (json.loads, ast.literal_eval):
            try:
                v = loader(s)
            except (ValueError, SyntaxError, TypeError):
                continue
            if isinstance(v, list) and len(v) == 1:
                v = v[0]
            return v
        return value
    return value


_ERR_RE = re.compile(r"^\s*(Error|Tool call failed|Traceback|[A-Za-z]+(Error|Exception)\b)")


class _StepCollector:
    """Turns NAT intermediate steps into ordered ToolCalls (by start order)."""

    def __init__(self):
        self.starts: dict[str, tuple[int, str, Any]] = {}
        self.calls: list[tuple[int, ToolCall]] = []
        self.seq = 0

    def on_next(self, step) -> None:
        # cuAlign tools and the reviewer are NAT functions: FUNCTION_START/END (the workflow itself is "<workflow>")
        p = step.payload
        et = str(p.event_type)
        if (p.name or "").startswith("<"):
            return
        if et.endswith("FUNCTION_START"):
            self.seq += 1
            self.starts[p.UUID] = (self.seq, p.name or "", getattr(p.data, "input", None) if p.data else None)
        elif et.endswith("FUNCTION_END"):
            seq, name, raw_in = self.starts.pop(p.UUID, (self.seq + 1, p.name or "", None))
            raw_out = getattr(p.data, "output", None) if p.data else None
            tool, agent = normalize_tool_name(name)
            args = _parse(raw_in)
            args = args if isinstance(args, dict) else ({"raw": args} if args not in (None, "") else {})
            if tool == "reviewer":
                args = {"plan_id": str(args.get("plan_id") or args.get("input_message") or args.get("raw") or "").strip()}
            result = _parse(raw_out)
            error = None
            if isinstance(result, str) and _ERR_RE.match(result):
                error, result = result[:500], None
            self.calls.append((seq, ToolCall(name=tool, args=args, result=result if result != "" else None,
                                             error=error, agent=agent)))

    def ordered(self) -> list[ToolCall]:
        return [c for _, c in sorted(self.calls, key=lambda x: x[0])]


class _LogCounter(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.INFO)
        self.parse_retries = 0
        self.errors: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        if "Retrying ReAct Agent" in msg:
            self.parse_retries += 1
        elif "Tool call attempt" in msg and "failed" in msg:
            self.errors.append("retry " + re.sub(r"\s+", " ", msg)[:280])
        elif "Tool call failed after all retry attempts" in msg:
            self.errors.append(msg[:280])


@contextlib.contextmanager
def _fresh_store(out_dir: Path):
    """Empty the process-global cuAlign STORE for one run and point plan persistence at a temp dir."""
    from cualign.core import store as store_mod
    old_out = store_mod.OUT_DIR
    store_mod.OUT_DIR = out_dir
    s = store_mod.STORE
    s.__dict__.update(store_mod.Store().__dict__)   # every field, so e.g. case_constraints cannot leak between runs
    try:
        yield
    finally:
        store_mod.OUT_DIR = old_out


# ---------------------------------------------------------------------------------------------- run
async def run_spec(spec: Spec, config: dict, agent_label: str, work_dir: Path) -> Trace:
    """One run of one spec: every turn through the same in-process workflow and STORE."""
    from nat.builder.context import Context
    from nat.data_models.api_server import ChatRequest
    from nat.runtime.loader import load_workflow

    cfg_path = work_dir / f"workflow-{spec.id}.yml"
    cfg_path.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding="utf-8")
    counter = _LogCounter()
    nat_logger = logging.getLogger("nat")
    old_level = nat_logger.level
    nat_logger.setLevel(logging.INFO)   # retry messages are INFO; in-process the default level would drop them
    nat_logger.addHandler(counter)
    turns: list[Turn] = []
    history: list[dict] = []
    t0 = time.time()
    store = _fresh_store(work_dir / "out")
    store.__enter__()
    try:
        async with load_workflow(str(cfg_path)) as workflow:
            for user in spec.turns:
                history.append({"role": "user", "content": user})
                collector = _StepCollector()
                counter.parse_retries, counter.errors = 0, []
                errors: list[str] = []
                answer = ""
                try:
                    async with workflow.run(ChatRequest(messages=copy.deepcopy(history))) as runner:
                        done = asyncio.Event()
                        Context.get().intermediate_step_manager.subscribe(
                            on_next=collector.on_next, on_error=lambda e: done.set(), on_complete=done.set)
                        answer = await runner.result(to_type=str)
                        with contextlib.suppress(asyncio.TimeoutError):
                            await asyncio.wait_for(done.wait(), timeout=10)
                except Exception as e:  # a crashed turn is recorded, not raised: the judge scores it as a failure
                    errors.append(f"{type(e).__name__}: {str(e)[:400]}")
                turns.append(Turn(user=user, calls=collector.ordered(), answer=answer or "",
                                  errors=errors + list(counter.errors), parse_retries=counter.parse_retries))
                history.append({"role": "assistant", "content": answer or ""})
    finally:
        nat_logger.removeHandler(counter)
        nat_logger.setLevel(old_level)
        store.__exit__(None, None, None)
    return Trace(spec_id=spec.id, agent=agent_label, turns=turns,
                 meta={"seconds": round(time.time() - t0, 1), "config_llm": config["workflow"]["llm_name"],
                       "fault_injection": spec.fault_injection})


async def run_specs(specs: list[Spec], k: int | None, llm: str, out: Path, llm_override: dict | None = None) -> list[Path]:
    """Run each spec k times (sequential: the cuAlign STORE is process-global). Returns written trace paths."""
    from .fake_llm import FakeLLM

    out.mkdir(parents=True, exist_ok=True)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        for spec in specs:
            for n in range(1, (k or spec.k_runs) + 1):
                with contextlib.ExitStack() as stack:
                    reviewer = None
                    if spec.fault_injection.get("reviewer") == "empty":
                        reviewer = stack.enter_context(FakeLLM(mode="empty")).llm_config("fault-empty")
                    cfg = build_config(llm, reviewer_llm=reviewer, all_llms=llm_override)
                    label = f"nat:{llm}" if llm_override is None else "nat:fake"
                    tr = await run_spec(spec, cfg, label, Path(tmp))
                path = out / f"{spec.id}__{label.replace(':', '-')}__run{n}.json"
                tr.save(path)
                written.append(path)
                print(f"[{spec.id} run {n}] {tr.meta['seconds']}s · turns {len(tr.turns)} · "
                      f"tool calls {sum(len(t.calls) for t in tr.turns)} -> {path.name}", flush=True)
    return written


def plan_summary(specs: list[Spec], k: int | None) -> str:
    runs = sum(k or s.k_runs for s in specs)
    turns = sum((k or s.k_runs) * len(s.turns) for s in specs)
    return (f"{len(specs)} specs · {runs} runs · {turns} agent turns (each turn = several LLM calls). "
            "Sequential; expect roughly 20-90 s per turn on nemotron-3-super.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--specs", default="", help="comma-separated ids (default: all)")
    ap.add_argument("--k", type=int, default=None, help="runs per spec (default: spec.k_runs)")
    ap.add_argument("--llm", default="nim_super", help="workflow llm name in configs/workflow.yml")
    ap.add_argument("--out", default=None, help="trace folder (default out/golden_a/<timestamp>)")
    ap.add_argument("--plan", action="store_true", help="print what would run and exit (no model calls)")
    args = ap.parse_args(argv)

    specs_all = load_specs()
    ids = [x.strip() for x in args.specs.split(",") if x.strip()] or list(specs_all)
    unknown = [x for x in ids if x not in specs_all]
    if unknown:
        print(f"unknown specs: {unknown}"); return 2
    specs = [specs_all[x] for x in ids]
    print(plan_summary(specs, args.k))
    if args.plan:
        return 0

    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    if not os.environ.get("NVIDIA_API_KEY", "").startswith("nvapi-"):
        print("[error] NVIDIA_API_KEY missing (.env)"); return 2
    out = Path(args.out or ROOT / "out" / "golden_a" / time.strftime("%Y%m%d-%H%M%S"))
    asyncio.run(run_specs(specs, args.k, args.llm, out))
    print(f"\ntraces: {out}\njudge:  python -m evals.golden_a.judge --traces {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
