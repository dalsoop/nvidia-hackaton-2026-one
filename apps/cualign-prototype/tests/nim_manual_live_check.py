"""직접 이동 then a real NIM stages turn: does the agent stage the hand-edited target as it is?

Against a running server (`uv run cualign serve`, key in .env): the sample's recorded setup and target turns (no model),
one crown moved by hand (POST …/manual, 21 buccal +0.5 mm), then one /chat/stream stages turn like the screen's
「단계 만들기」. Passes when the selected plan was staged from that very target (step_done's target_id, the plan's target info with
source manual and this parent, `manual` on the plan row, the crown's last stage where it was put) and the agent made no new target (no propose_target call).
Costs real NVIDIA usage: one stages turn with the reviewer and the Guardrails rails. Never prints the key.
With --from-scan the edit starts from the scan instead (처음부터 수동 배치: the recorded setup turn only, then POST
…/targets/scan); the plan's strategy must then stay "manual".
Writes the trace to out/nim-live/manual-stages.json (manual-stages-scan.json with --from-scan).
Run: uv run --frozen python tests/nim_manual_live_check.py [http://127.0.0.1:8000] [poseidon-000097] [--from-scan]
"""
import asyncio
import json
import sys
import uuid
from pathlib import Path

import httpx

from nim_live_check import converse, pick, tool_steps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "nim-live"
TOOTH = "9"                      # Universal 9 = FDI 21
MESSAGE = "직접 옮긴 이 목표 배열 그대로 단계를 만들어줘."   # the 「단계 만들기」 chip after 직접 이동 (app.js nextChips)


async def main():
    from_scan = "--from-scan" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--from-scan"]
    url = args[0] if args else "http://127.0.0.1:8000"
    case = args[1] if len(args) > 1 else "poseidon-000097"
    OUT.mkdir(parents=True, exist_ok=True)
    log = []
    async with httpx.AsyncClient(timeout=120) as client:
        (await client.post(f"{url}/api/cases/{case}/activate")).raise_for_status()
        for step in ("setup",) if from_scan else ("setup", "target"):
            r = await client.post(f"{url}/api/cases/{case}/replay", json={"step": step})
            r.raise_for_status()
        if from_scan:
            r = await client.post(f"{url}/api/cases/{case}/targets/scan")
            r.raise_for_status()
        base_tid = r.json()["target_id"]
        base = (await client.get(f"{url}/api/cases/{case}/targets/{base_tid}")).json()
        d, b = base["stages"][0][TOOTH], base["frames"][TOOTH]["buccal"]
        moved = [d[k] + 0.5 * b[k] for k in range(3)]
        r = await client.post(f"{url}/api/cases/{case}/targets/{base_tid}/manual",
                              json={"teeth": {TOOTH: {"d": moved, "yaw": base["rotations"][0].get(TOOTH, 0.0)}}})
        r.raise_for_status()
        manual_tid = r.json()["target_id"]
        print(f"target {base_tid} -> hand-edited {manual_tid} (FDI 21 buccal +0.5 mm)")

        ctx = {"case_id": case, "request_id": "manual-" + uuid.uuid4().hex[:8], "base_plan_id": None}
        events, answer, elapsed = await converse(client, url, MESSAGE, ctx, log, step="stages")
        tools = [n.split("Function Start: ")[1] for n in tool_steps(events) if n.startswith("Function Start: ")]
        sel = pick(events, "plan_selected") or {}
        done = pick(events, "step_done") or {}
        pid = sel.get("plan_id")
        checks = {"plan_selected": bool(pid), "no_propose_target": not any(t.endswith("propose_target") for t in tools)}
        plan = row = None
        if pid:
            plan = (await client.get(f"{url}/api/plans/{pid}")).json()
            row = next((p for p in (await client.get(f"{url}/api/plans?case_id={case}")).json()["plans"] if p["plan_id"] == pid), None)
            last = plan["stages"][-1][TOOTH]
            checks.update({
                "plan_from_manual_target": (plan.get("target") or {}).get("source") == "manual"
                                           and (plan.get("target") or {}).get("parent_target_id") == base_tid,
                "plan_row_manual": bool(row and row.get("manual")),
                "crown_where_put": max(abs(last[k] - moved[k]) for k in range(3)) < 1e-3,
                "step_done_target": done.get("target_id") == manual_tid,
            })
            if from_scan:
                checks["strategy_manual"] = plan.get("strategy") == "manual"
    result = {"case": case, "from_scan": from_scan, "base_target": base_tid, "manual_target": manual_tid, "plan_id": pid, "elapsed_s": round(elapsed, 1),
              "tools": tools, "checks": checks, "passed": all(checks.values()),
              "plan": {"strategy": plan.get("strategy"), "passed": plan.get("passed"), "review": plan.get("review"), "n_stages": len(plan["stages"]),
                       "target_source": (plan.get("target") or {}).get("source")} if plan else None,
              "answer": answer, "trace": log}
    name = "manual-stages-scan.json" if from_scan else "manual-stages.json"
    (OUT / name).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{elapsed:.1f}s tools: {tools}")
    print("answer:", answer.strip()[:500])
    for k, v in checks.items():
        print(("PASS " if v else "FAIL ") + k)
    print("PASSED" if result["passed"] else "FAILED", "->", OUT / name)
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
