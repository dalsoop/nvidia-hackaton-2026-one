"""Run golden-set A specs against the real NAT workflow in-process and write Trace JSON for the judge.

    python -m evals.golden_a.runner --plan                          # what would run, how many model calls (free)
    python -m evals.golden_a.runner --specs A01,A04 --k 3           # live: needs NVIDIA_API_KEY, uses NIM quota
    python -m evals.golden_a.runner --nim-preflight 20 --min-success 0.95   # live, only if NIM answers 19 of 20 first
    python -m evals.golden_a.judge --traces out/golden_a/<run>      # score the written traces

How a run is recorded
  * tool calls: NAT intermediate steps (FUNCTION_START/END) — names, arguments and results as the agent saw them,
    no log-text parsing. Calls of the reviewer's own tools (cualign_ro__*) are marked agent="reviewer".
  * ReAct parse retries and NAT tool-call retries: counted from NAT's log records ("Retrying ReAct Agent",
    "Tool call attempt ... failed").
  * every turn is sent the way the UI sends it (static/app.js): the case is activated first, so the messages open
    with the UI greeting as an assistant message and carry the previous user/assistant turns; the form's
    constraints (defaults, or spec.form) go through plan_events.open_run, which writes them to the case and prepends
    the same "cuAlign server context" system message the server does. The next turn's form is what the UI shows
    after the plan_context event (the run's constraints) and its base plan is the selected plan. The in-process
    cuAlign STORE keeps plans between turns and is reset between runs.
  * fault injection (spec.fault_injection.reviewer = "empty"): the reviewer agent's LLM is pointed at a local fake
    server that returns empty completions (the KNOWN_ISSUES failure). The planner keeps the real model.

NVIDIA API overload (#51)
  * a turn that crashes because the API stayed overloaded (NIMStreamError, or "[503]"/"[429]" from a call that is not
    streamed) ends the run: its trace gets meta.unscorable and is saved as <spec>__<agent>__run<n>__unscorable<a>.json.
    The judge counts such traces as "판정 불가" (unscorable), not as failures, and leaves them out of the pass rate.
    The run is then started again, up to --unscorable-retries times (default 2).
  * --nim-preflight N sends N short streamed requests to the planner model first, one request each (no re-request),
    and stops before any spec runs when fewer than --min-success of them answer. The measured rate is written to
    <out>/preflight.json, which the judge prints with the report.

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
from nat.utils.io.yaml_tools import yaml_load

from .judge import Spec, load_specs
from .trace import ToolCall, Trace, Turn, is_overload_crash, normalize_tool_name

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / "configs" / "workflow.yml"


# ---------------------------------------------------------------------------------------------- config
def build_config(llm: str = "nim_super", reviewer_llm: dict | None = None, all_llms: dict | None = None) -> dict:
    """workflow.yml with the planner model selected, optionally the reviewer (or every LLM) replaced.

    Loaded the way NAT loads it, so `file://` references (the planner instructions in workspace/AGENTS.md) are
    already inlined when the result is written to a temporary config elsewhere."""
    cfg = yaml_load(WORKFLOW)
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


# ---------------------------------------------------------------------------------------------- UI request
def _js_number(x) -> str:
    """How a JSON number prints in a JS template literal (5.0 -> "5", 3.25 -> "3.25")."""
    x = float(x)
    return str(int(x)) if x.is_integer() else repr(x)


def ui_greeting(case_id: str) -> str:
    """The assistant message static/app.js adds when a case is activated (activateCase, greet=true)."""
    from cualign.core import planner
    from cualign.core.store import STORE
    cid, case = STORE.load_case(case_id)
    return (f"케이스 {cid} (상악 {len(case.ids)}개 치아, 총생 {_js_number(planner.crowding_mm(case))} mm) 를 불러왔습니다. "
            "계획을 시작하려면 제약을 알려 주세요. 발치할 치아가 있으면 번호로 알려 주세요(없으면 비발치). "
            "기간 상한이 있으면 함께 알려 주세요.")


def form_patch(c) -> dict:
    """static/app.js readConstraints(): every form field is sent, an empty stage cap as clear_stage_cap."""
    from cualign.core.fdi import to_fdi
    return {"extraction": list(c.extraction), "lock": list(c.lock), "ipr_exclude": list(c.ipr_exclude),
            "ipr_limit_mm": c.ipr_limit_mm, "ipr_surfaces": [[to_fdi(a), to_fdi(b), mm] for a, b, mm in c.ipr_surfaces],
            "stage_cap": c.stage_cap, "clear_stage_cap": c.stage_cap is None, "order": c.order}


# ---------------------------------------------------------------------------------------------- run
async def run_spec(spec: Spec, config: dict, agent_label: str, work_dir: Path) -> Trace:
    """One run of one spec: every turn through the same in-process workflow and STORE."""
    from nat.builder.context import Context
    from nat.data_models.api_server import ChatRequest
    from nat.runtime.loader import load_workflow

    from cualign.agent.context import CURRENT_RUN
    from cualign.agent.register import ContextPreload, context_preload
    from cualign.core.constraints import Constraints
    from cualign.server.plan_events import ChatContext, open_run

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
    unscorable = None
    # The same preload the server applies (worker.add_routes), so live timings include it (#48).
    preload = context_preload(ContextPreload.model_validate(
        ((config.get("function_groups") or {}).get("cualign") or {}).get("context_preload") or {}))
    store = _fresh_store(work_dir / "out")
    store.__enter__()
    try:
        history.append({"role": "assistant", "content": ui_greeting(spec.case)})
        form, base = Constraints.model_validate(spec.form), None
        async with load_workflow(str(cfg_path)) as workflow:
            for n, user in enumerate(spec.turns):
                history.append({"role": "user", "content": user})
                ctx = ChatContext(request_id=f"{spec.id}-{n}", case_id=spec.case, base_plan_id=base,
                                  constraints=form_patch(form))
                run, system = open_run(ctx, preload=preload)
                token = CURRENT_RUN.set(run)
                collector = _StepCollector()
                counter.parse_retries, counter.errors = 0, []
                errors: list[str] = []
                answer = ""
                try:
                    async with workflow.run(ChatRequest(messages=[system, *copy.deepcopy(history)])) as runner:
                        done = asyncio.Event()
                        Context.get().intermediate_step_manager.subscribe(
                            on_next=collector.on_next, on_error=lambda e: done.set(), on_complete=done.set)
                        answer = await runner.result(to_type=str)
                        with contextlib.suppress(asyncio.TimeoutError):
                            await asyncio.wait_for(done.wait(), timeout=10)
                except Exception as e:  # a crashed turn is recorded, not raised: the judge scores it as a failure
                    errors.append(f"{type(e).__name__}: {str(e)[:400]}")
                finally:
                    run.closed = True
                    CURRENT_RUN.reset(token)
                form, base = run.constraints, run.selected_plan_id or base   # the UI after plan_context/plan_selected
                turns.append(Turn(user=user, calls=collector.ordered(), answer=answer or "",
                                  errors=errors + list(counter.errors), parse_retries=counter.parse_retries))
                history.append({"role": "assistant", "content": answer or ""})
                if errors and is_overload_crash(errors[0]):   # the API, not the agent: later turns would say nothing
                    unscorable = f"turn {n}: {errors[0][:200]}"
                    break
    finally:
        nat_logger.removeHandler(counter)
        nat_logger.setLevel(old_level)
        store.__exit__(None, None, None)
    return Trace(spec_id=spec.id, agent=agent_label, turns=turns,
                 meta={"seconds": round(time.time() - t0, 1), "config_llm": config["workflow"]["llm_name"],
                       "fault_injection": spec.fault_injection, **({"unscorable": unscorable} if unscorable else {})})


async def run_specs(specs: list[Spec], k: int | None, llm: str, out: Path, llm_override: dict | None = None,
                    unscorable_retries: int = 2) -> list[Path]:
    """Run each spec k times (sequential: the cuAlign STORE is process-global). Returns written trace paths.

    A run the API did not let finish is kept as an unscorable trace and started again, at most unscorable_retries
    times; the last attempt is saved as the run whatever it was."""
    from .fake_llm import FakeLLM

    out.mkdir(parents=True, exist_ok=True)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        for spec in specs:
            for n in range(1, (k or spec.k_runs) + 1):
                for attempt in range(1, unscorable_retries + 2):
                    with contextlib.ExitStack() as stack:
                        reviewer = None
                        if spec.fault_injection.get("reviewer") == "empty":
                            reviewer = stack.enter_context(FakeLLM(mode="empty")).llm_config("fault-empty")
                        cfg = build_config(llm, reviewer_llm=reviewer, all_llms=llm_override)
                        label = f"nat:{llm}" if llm_override is None else "nat:fake"
                        tr = await run_spec(spec, cfg, label, Path(tmp))
                    tr.meta["attempt"] = attempt
                    stem = f"{spec.id}__{label.replace(':', '-')}__run{n}"
                    path = out / (f"{stem}__unscorable{attempt}.json" if tr.meta.get("unscorable") else f"{stem}.json")
                    tr.save(path)
                    written.append(path)
                    print(f"[{spec.id} run {n}{f' attempt {attempt}' if attempt > 1 else ''}] {tr.meta['seconds']}s · "
                          f"turns {len(tr.turns)} · tool calls {sum(len(t.calls) for t in tr.turns)}"
                          f"{' · 판정 불가 (NIM overload)' if tr.meta.get('unscorable') else ''} -> {path.name}", flush=True)
                    if not tr.meta.get("unscorable"):
                        break
    return written


# ---------------------------------------------------------------------------------------------- NIM preflight
def _llm_endpoint(llm: str) -> tuple[str, str]:
    """(base_url, model) of a workflow.yml LLM, as the NAT nim client resolves them."""
    entry = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["llms"][llm]
    return (entry.get("base_url") or "https://integrate.api.nvidia.com/v1").rstrip("/"), entry["model_name"]


def nim_call_once(base_url: str, model: str, api_key: str, timeout: float = 60.0) -> str | None:
    """One short streamed chat request, sent once. None when a content delta arrives, else what went wrong.

    The overload comes as HTTP 200 with an error line in the stream (#6) or as an HTTP 429/503; both count."""
    import urllib.error
    import urllib.request
    body = json.dumps({"model": model, "stream": True, "max_tokens": 8, "temperature": 0.0,
                       "messages": [{"role": "user", "content": "Reply with OK."}]}).encode()
    req = urllib.request.Request(f"{base_url}/chat/completions", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "text/event-stream",
                                          "Authorization": f"Bearer {api_key}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if line.startswith("data:"):
                    line = line[5:].strip()
                if not line or line == "[DONE]":
                    continue
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if isinstance(msg, dict) and msg.get("error"):
                    err = msg["error"]
                    return f"stream error {err.get('code', '?') if isinstance(err, dict) else ''}".strip()
                choices = msg.get("choices") if isinstance(msg, dict) else None
                if choices and (choices[0].get("delta") or {}).get("content"):
                    return None
            return "stream ended without content"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return type(e).__name__


def nim_preflight(n: int, call) -> dict:
    """Send n requests with call() -> error|None and measure the success rate (errors by kind, never the key)."""
    errors: dict[str, int] = {}
    t0 = time.time()
    for _ in range(n):
        err = call()
        if err:
            errors[err] = errors.get(err, 0) + 1
    ok = n - sum(errors.values())
    return {"calls": n, "ok": ok, "rate": round(ok / n, 3) if n else 0.0, "errors": errors,
            "seconds": round(time.time() - t0, 1), "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


def preflight_gate(out: Path, n: int, min_success: float, call, model: str = "") -> dict:
    """Measure, write <out>/preflight.json and decide: pre["passed"] is False when the rate is below min_success."""
    pre = {**nim_preflight(n, call), "model": model, "min_success": min_success}
    pre["passed"] = pre["rate"] >= min_success
    out.mkdir(parents=True, exist_ok=True)
    (out / "preflight.json").write_text(json.dumps(pre, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"NIM preflight: {pre['ok']}/{pre['calls']} ({pre['rate']:.0%}) in {pre['seconds']}s, "
          f"need {min_success:.0%} -> {'go' if pre['passed'] else 'HOLD'} {pre['errors'] or ''}", flush=True)
    return pre


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
    ap.add_argument("--unscorable-retries", type=int, default=2,
                    help="runs ended by NIM overload are started again this many times (default 2)")
    ap.add_argument("--nim-preflight", type=int, default=0, metavar="N",
                    help="first send N short requests to the model; stop unless --min-success of them answer")
    ap.add_argument("--min-success", type=float, default=0.95, help="preflight success rate needed (default 0.95)")
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
    if args.nim_preflight > 0:
        base_url, model = _llm_endpoint(args.llm)
        key = os.environ["NVIDIA_API_KEY"]
        pre = preflight_gate(out, args.nim_preflight, args.min_success,
                             lambda: nim_call_once(base_url, model, key), model=model)
        if not pre["passed"]:
            print(f"[hold] NIM is overloaded; no spec was run. preflight: {out / 'preflight.json'}")
            return 3
    asyncio.run(run_specs(specs, args.k, args.llm, out, unscorable_retries=args.unscorable_retries))
    print(f"\ntraces: {out}\njudge:  python -m evals.golden_a.judge --traces {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
