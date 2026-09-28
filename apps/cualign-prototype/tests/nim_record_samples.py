"""Record the agent's answers for the sample cases (core/recorded.py), with the real NIM, in the screen's step flow.

For each sample (the demo case poseidon-000097 first) the turns are run through `nat serve` and /chat/stream exactly as
the screen sends them (the turn's `step` as a top-level body field), and a turn that passed is saved as
src/cualign/core/samples/recorded/<case_id>/<step>.json. The sentences are recorded.REQUESTS, the chips' own:
  setup    the card's «이 케이스의 처방 넣기» sentence (the prescription), step setup: conditions only, a question back
  target   «이 조건으로 목표 배열을 만들어줘.», step target: the target arrangement only, a question back (+ the strategy)
  stages   «이 목표로 단계를 만들어줘.», step stages: the plan, selected and reviewed
  cap      «8개월 안에 끝나게 단계를 만들어줘.», step stages: the plan under a time cap
  compare  «확장안이랑 IPR안 둘 다 만들어서 비교해줘.», step stages: the strategies compared, one selected
stages, cap and compare are the three chips the target step offers (app.js nextChips), so each is recorded the way the
screen reaches it: the case opened again (activate drops a cap an earlier turn left) and setup -> target -> the chip, in
a conversation of its own. Chaining them (cap on the stages plan, compare after cap) recorded a comparison under a cap
nobody asked for. setup and target are saved from the first of these conversations.
A planning turn passes when its answer is Korean with the disclaimer and no app tooth number or internal term, and a
plan was selected and reviewed (review passed) and the answer's summary names that plan's strategy (what a replay
selects); a comparison must also name at least two strategies. A setup or target
turn passes when it stopped where its step says (step_done event, no plan) and asked back in Korean; a comparison under
an extraction prescription passes as a Korean question back with no plan selected (then `review` is null and a replay
makes no plan). No plan is stored: a replay recomputes. Recordings of earlier runs (and the old plan.json) are removed
for the case first.

Runs against a fresh store (out/nim-live/record-store): a plan another run left must not become the base plan.
Never prints the API key. Costs real NVIDIA usage: up to nine turns per case (three conversations of three turns).
Run: uv run --frozen python -X utf8 tests/nim_record_samples.py [case_id ...] [--only step,step]   (default: all three samples,
every step; --only re-records the named steps of those cases, keeping the rest)
"""
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from nim_e2e_live_check import answer_checks, pick, turn  # noqa: E402
from nim_live_check import free_port, wait_ready  # noqa: E402

ORDER = ("poseidon-000097", "poseidon-000001", "poseidon-000131")
FINAL = ("extraction", "lock", "ipr_exclude", "ipr_limit_mm", "stage_cap", "order")


def _model() -> str:
    cfg = yaml.safe_load((ROOT / "configs" / "workflow.yml").read_text(encoding="utf-8"))
    return cfg["llms"]["nim_super"]["model_name"]


def _clean(rec: dict) -> bool:
    return rec["korean"] and not rec["universal_numbers"] and not rec["internal_terms"] and rec["plan_error"] is None


def _question(rec: dict) -> bool:
    return _clean(rec) and "?" in rec["answer"] and not rec["plan_selected"]


def _compares(answer: str) -> bool:
    """A comparison names at least two strategies (one line per plan), not only the plan it chose."""
    from cualign.core import recorded
    return len({recorded.strategy_in(line) for line in answer.splitlines()} - {None}) >= 2


LEAD = ("setup", "target")
CHIPS = ("stages", "cap", "compare")   # what the target step offers: each chip is its own conversation from the target


def _conversations(only):
    """The step lists to run: setup -> target -> one chip per conversation (the chips asked for); with only setup or
    target asked for, one conversation that stops at the last of them."""
    chips = [c for c in CHIPS if not only or c in only]
    if chips:
        return [[*LEAD, c] for c in chips]
    return [list(LEAD[: max(LEAD.index(s) for s in only if s in LEAD) + 1])]


async def record_case(client, url, case_id, log, out, only=None):
    """`only`: record these steps only (setup and target still run, unsaved, so the conversation and the case flow are
    the same as on screen); without it every step, after removing the case's earlier recordings."""
    from cualign.core import recorded
    from cualign.core.samples import SAMPLES
    sample = SAMPLES[case_id]
    if not only:
        shutil.rmtree(recorded.RECORDED_DIR / case_id, ignore_errors=True)   # earlier runs and the old plan.json
    results = {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for steps in _conversations(only):
        r = await client.post(url + f"/api/cases/{case_id}/activate", timeout=120)   # back to the prescription, as on screen
        if r.status_code != 200:
            out[case_id] = {**results, "error": f"activate {r.status_code} {r.text[:120]}"}
            return
        messages, base = [], None
        for step in steps:
            text = sample.request if step == "setup" else recorded.REQUESTS[step]
            ctx = {"request_id": f"rec-{step}", "case_id": case_id, "base_plan_id": base, "constraints": {}}
            messages, ev, rec = await turn(client, url, messages, text, ctx, log, step=recorded.TURN_STEP[step])
            done = pick(ev, "step_done")
            rec["step_done"] = done
            saved = None
            common = {"step": step, "request": text, "recorded_at": now, "model": _model()}
            if (only and step not in only) or step in results:   # a turn run only to reach a later step: not recorded, file kept
                if rec["plan_selected"]:
                    base = rec["plan_selected"]
                print(f"{case_id} {step}: run to reach {steps[-1]} ({rec['elapsed_s']}s, stopped at {(done or {}).get('step')})", flush=True)
                continue
            if step == "setup" and done and done.get("step") == "setup" and _question(rec):
                final = {k: v for k, v in done["constraints"].items() if k in FINAL}
                saved = recorded.save(case_id, step, {**common, "constraints": final, "answer_md": rec["answer"].strip(), "review": None})
            elif step == "target" and done and done.get("step") == "target" and _question(rec):
                t = (await client.get(url + f"/api/cases/{case_id}/targets/{done['target_id']}", timeout=30)).json()
                final = {k: v for k, v in t["constraints"].items() if k in FINAL}
                saved = recorded.save(case_id, step, {**common, "constraints": final, "answer_md": rec["answer"].strip(), "review": None,
                                                       "strategy": t["strategy"]})
            elif rec["plan_selected"] and _clean(rec) and rec["disclaimer"] and (rec["review"] or {}).get("status") == "passed" \
                    and (step != "compare" or _compares(rec["answer"])):
                d = (await client.get(url + f"/api/plans/{rec['plan_selected']}", timeout=30)).json()
                if recorded.selected_strategy(rec["answer"]) == d["strategy"]:   # a replay selects the plan the answer names
                    final = {k: v for k, v in d["constraints"].items() if k in FINAL}
                    saved = recorded.save(case_id, step, {**common, "constraints": final, "answer_md": rec["answer"].strip(), "review": rec["review"]})
                base = rec["plan_selected"]
            elif step == "compare" and sample.constraints.get("extraction") and _question(rec):   # asked back, no plan made
                answer = re.sub(r"^\s*Final Answer:\s*", "", rec["answer"]).strip()
                saved = recorded.save(case_id, step, {**common, "constraints": {}, "answer_md": answer, "review": None})
            results[step] = {"saved": str(saved.relative_to(ROOT)) if saved else None, "elapsed_s": rec["elapsed_s"], "tools": rec["tools"],
                             "plan_selected": rec["plan_selected"], "review": (rec["review"] or {}).get("status"),
                             "step_done": (done or {}).get("step"), **answer_checks(rec["answer"])}
            print(f"{case_id} {step}: {'saved ' + str(saved.name) if saved else 'NOT saved'} ({rec['elapsed_s']}s, tools {len(rec['tools'])})", flush=True)
    out[case_id] = results


async def main(case_ids, only=None):
    load_dotenv(ROOT / ".env")
    if not os.environ.get("NVIDIA_API_KEY", "").startswith("nvapi-"):
        raise SystemExit("NVIDIA_API_KEY is not set (put it in apps/cualign-prototype/.env)")
    port = free_port()
    url = f"http://127.0.0.1:{port}"
    store = ROOT / "out" / "nim-live" / "record-store"   # a fresh store: a plan another run left must not become the base plan
    shutil.rmtree(store, ignore_errors=True)
    store.mkdir(parents=True)
    env = {**os.environ, "PYTHONUTF8": "1", "CUALIGN_OUT": str(store)}
    (ROOT / "out" / "nim-live").mkdir(parents=True, exist_ok=True)
    logfile = open(ROOT / "out" / "nim-live" / "record-server.log", "w", encoding="utf-8")
    proc = subprocess.Popen([sys.executable, "-m", "nat.cli.main", "serve", "--config_file", str(ROOT / "configs" / "workflow.yml"),
                             "--host", "127.0.0.1", "--port", str(port)], cwd=str(ROOT), env=env, stdout=logfile, stderr=subprocess.STDOUT)
    log, out = [], {}
    try:
        await wait_ready(url, proc)
        async with httpx.AsyncClient() as client:
            for case_id in case_ids:
                await record_case(client, url, case_id, log, out, only=only)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
        logfile.close()
    (ROOT / "out" / "nim-live" / "record.json").write_text(json.dumps({"results": out, "log": log}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    if "--only" in args:                      # --only target,compare : record those steps only (case ids before it)
        i = args.index("--only")
        only = set(args[i + 1].split(","))
        args = args[:i] + args[i + 2:]
    asyncio.run(main(args or list(ORDER), only=only))
