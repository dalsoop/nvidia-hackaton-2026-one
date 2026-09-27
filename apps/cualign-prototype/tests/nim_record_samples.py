"""Record the agent's answers for the sample cases (core/recorded.py), with the real NIM, step by step.

For each sample (the demo case poseidon-000097 first) the E2E rehearsal's three turns are run through `nat serve`
and /chat/stream exactly as the screen sends them, and a turn that passed is saved as
src/cualign/core/samples/recorded/<case_id>/<step>.json:
  plan     the card's «에이전트에게 계획 맡기기» sentence with the sample's constraints
  cap      «8개월 안에 끝나게 다시 짜줘.» on the selected plan
  compare  «확장안이랑 IPR안 둘 다 만들어서 비교해줘.» on the selected plan
A turn passes when its answer is Korean with the disclaimer and no app tooth number or internal term, and either a
plan was selected and reviewed (review passed) or, for a comparison under an extraction prescription, the model asked
back in Korean without a tool (then `review` is null and a replay makes no plan). No plan is stored: a replay recomputes.

Never prints the API key. Costs real NVIDIA usage: up to nine planning conversations.
Run: uv run --frozen python -X utf8 tests/nim_record_samples.py [case_id ...]   (default: all three samples)
"""
import asyncio
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from nim_e2e_live_check import answer_checks, tool_names, turn  # noqa: E402
from nim_live_check import free_port, wait_ready  # noqa: E402

ORDER = ("poseidon-000097", "poseidon-000001", "poseidon-000131")


def _model() -> str:
    cfg = yaml.safe_load((ROOT / "configs" / "workflow.yml").read_text(encoding="utf-8"))
    return cfg["llms"]["nim_super"]["model_name"]


def _clean(rec: dict) -> bool:
    return rec["korean"] and rec["disclaimer"] and not rec["universal_numbers"] and not rec["internal_terms"] and rec["plan_error"] is None


async def record_case(client, url, case_id, log, out):
    from cualign.core import recorded
    from cualign.core.samples import SAMPLES
    sample = SAMPLES[case_id]
    r = await client.post(url + f"/api/cases/{case_id}/activate", timeout=120)
    if r.status_code != 200 or "plan_error" in r.json():
        out[case_id] = {"error": f"activate {r.status_code} {r.text[:120]}"}
        return
    plans = (await client.get(url + f"/api/plans?case_id={case_id}", timeout=30)).json()["plans"]
    base = plans[0]["plan_id"] if plans else None
    messages, results = [], {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    steps = [("plan", sample.request, dict(sample.constraints)), ("cap", recorded.REQUESTS["cap"], {}),
             ("compare", recorded.REQUESTS["compare"], {})]
    for step, text, patch in steps:
        ctx = {"request_id": f"rec-{step}", "case_id": case_id, "base_plan_id": base, "constraints": patch}
        messages, ev, rec = await turn(client, url, messages, text, ctx, log)
        saved = None
        if rec["plan_selected"] and _clean(rec) and (rec["review"] or {}).get("status") == "passed":
            d = (await client.get(url + f"/api/plans/{rec['plan_selected']}", timeout=30)).json()
            final = {k: v for k, v in d["constraints"].items() if k in ("extraction", "lock", "ipr_exclude", "ipr_limit_mm", "stage_cap", "order")}
            saved = recorded.save(case_id, step, {"step": step, "request": text, "constraints": final, "answer_md": rec["answer"].strip(),
                                                   "review": rec["review"], "recorded_at": now, "model": _model()})
            base = rec["plan_selected"]
        elif step == "compare" and sample.constraints.get("extraction") and rec["tools"] == [] and rec["korean"] \
                and "?" in rec["answer"] and not rec["universal_numbers"] and not rec["internal_terms"]:
            answer = re.sub(r"^\s*Final Answer:\s*", "", rec["answer"])
            saved = recorded.save(case_id, step, {"step": step, "request": text, "constraints": {}, "answer_md": answer,
                                                   "review": None, "recorded_at": now, "model": _model()})
        results[step] = {"saved": str(saved.relative_to(ROOT)) if saved else None, "elapsed_s": rec["elapsed_s"], "tools": rec["tools"],
                         "plan_selected": rec["plan_selected"], "review": (rec["review"] or {}).get("status"), **answer_checks(rec["answer"])}
        print(f"{case_id} {step}: {'saved ' + str(saved.name) if saved else 'NOT saved'} ({rec['elapsed_s']}s, tools {len(rec['tools'])})")
    out[case_id] = results


async def main(case_ids):
    load_dotenv(ROOT / ".env")
    if not os.environ.get("NVIDIA_API_KEY", "").startswith("nvapi-"):
        raise SystemExit("NVIDIA_API_KEY is not set (put it in apps/cualign-prototype/.env)")
    port = free_port()
    url = f"http://127.0.0.1:{port}"
    env = {**os.environ, "PYTHONUTF8": "1", "CUALIGN_OUT": str(ROOT / "out")}
    (ROOT / "out" / "nim-live").mkdir(parents=True, exist_ok=True)
    logfile = open(ROOT / "out" / "nim-live" / "record-server.log", "w", encoding="utf-8")
    proc = subprocess.Popen([sys.executable, "-m", "nat.cli.main", "serve", "--config_file", str(ROOT / "configs" / "workflow.yml"),
                             "--host", "127.0.0.1", "--port", str(port)], cwd=str(ROOT), env=env, stdout=logfile, stderr=subprocess.STDOUT)
    log, out = [], {}
    try:
        await wait_ready(url, proc)
        async with httpx.AsyncClient() as client:
            for case_id in case_ids:
                await record_case(client, url, case_id, log, out)
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
    asyncio.run(main(sys.argv[1:] or list(ORDER)))
