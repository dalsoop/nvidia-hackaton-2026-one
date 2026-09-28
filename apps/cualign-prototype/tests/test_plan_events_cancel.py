"""건너뛰기 cuts the agent turn (plan_events.cancel): the stream closing stops the workflow NAT leaves running, the
recorded answer comes at once, and what the cut turn still produces lands nowhere. The agent here is shaped like NAT's
streaming route (the workflow in a task of its own feeding a queue, never cancelled by NAT) with a 10 s planning
tool behind register.step_gated; no NIM."""
import asyncio
import json
import logging
import time

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from cualign.agent import register
from cualign.agent.context import CURRENT_RUN, track_task
from cualign.core.constraints import Constraints
from cualign.core.store import STORE
from cualign.server import plan_events
from cualign.server.api import add_api_routes

CASE = "poseidon-000001"


def fake_app(seen):
    app = FastAPI()
    add_api_routes(app)

    async def plan(inp):
        """a planning tool's body (seconds of planner work; it stops between strategies once the turn is cut)"""
        run = CURRENT_RUN.get()
        seen["tool_started"] = time.perf_counter()
        t = time.perf_counter()
        while time.perf_counter() - t < 10 and not run.cancelled:
            time.sleep(0.01)
        tid = STORE.put_target(run.case_id, {}, {}, Constraints())   # its result, landing after the cut
        run.target_ids.add(tid)
        seen["late_target"] = tid
        return {"target_id": tid}

    async def set_lock(inp):
        cid, _ = register.current_case()
        STORE.case_constraints[cid] = Constraints(lock=(13,))
        return {}

    tool, change = register.step_gated("plan_stages", plan), register.step_gated("set_constraints", set_lock)

    @app.post("/chat/stream")
    async def chat(request: Request):
        await request.json()
        q = asyncio.Queue()

        async def workflow():
            track_task()   # what the rails middleware does at the workflow's entry
            try:
                await q.put('data: {"type":"intermediate_data"}\n\n')
                await tool({})
                seen["after_tool"] = True
                await change({})
                CURRENT_RUN.get().selected_plan_id = "p-late"
                await q.put('data: {"choices":[{"delta":{"content":"늦은 답"}}]}\n\n')
            except asyncio.CancelledError:
                seen["workflow_cancelled"] = True
                raise
            finally:
                await q.put(None)

        async def gen():
            asyncio.create_task(workflow())   # NAT does not cancel this task when the client goes
            while (item := await q.get()) is not None:
                yield item
        return StreamingResponse(gen(), media_type="text/event-stream")

    app.add_middleware(plan_events.PlanEventsASGI)
    return app


async def open_turn(app, sent, gone):
    """Drive /chat/stream as uvicorn would: the body, then (on `gone`) the client closing the connection."""
    body = json.dumps({"messages": [{"role": "user", "content": "x"}], "step": "stages",
                       "cualign": {"request_id": "cut-me", "case_id": CASE}}).encode()
    first = True

    async def receive():
        nonlocal first
        if first:
            first = False
            return {"type": "http.request", "body": body, "more_body": False}
        await gone.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1", "method": "POST",
             "scheme": "http", "path": "/chat/stream", "raw_path": b"/chat/stream", "query_string": b"",
             "root_path": "", "headers": [(b"content-type", b"application/json")], "client": ("127.0.0.1", 1),
             "server": ("127.0.0.1", 8003), "app": app}
    await app(scope, receive, send)


def test_skip_cuts_the_turn_and_the_recorded_answer_comes_at_once(caplog):
    seen, sent = {}, []

    async def main():
        app = fake_app(seen)
        gone = asyncio.Event()
        turn = asyncio.create_task(open_turn(app, sent, gone))
        while "tool_started" not in seen:
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.3)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            gone.set()                       # 건너뛰기: the screen aborts the fetch ...
            t0 = time.perf_counter()
            head = await c.get(f"/api/cases/{CASE}/replay/setup")   # ... and asks for the recorded answer
            seen["head_ms"] = (time.perf_counter() - t0) * 1000
            rep = await c.post(f"/api/cases/{CASE}/replay", json={"step": "setup", "base_plan_id": None})
            seen["replay_ms"] = (time.perf_counter() - t0) * 1000
        await asyncio.wait_for(turn, 5)
        while "late_target" not in seen:   # the tool's thread ends on its own; its result must land nowhere
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.2)
        return head, rep

    with caplog.at_level(logging.INFO, logger="cualign"):
        head, rep = asyncio.run(main())
    # (a) at once: the recording's head in well under 0.5 s, the setup replay too (the 10 s tool held neither)
    assert head.status_code == 200 and head.json()["step"] == "setup" and head.json()["recorded"]
    assert rep.status_code == 200 and rep.json()["step"] == "setup"
    assert seen["head_ms"] < 500 and seen["replay_ms"] < 500, seen
    # (b) the cut turn changes nothing: its workflow task was cancelled (no later tool call, no step_done), its late
    # target is dropped, the case keeps the replay's conditions and flow
    assert seen.get("workflow_cancelled") and not seen.get("after_tool")
    assert seen["late_target"] not in STORE.targets
    assert STORE.case_constraints[CASE].lock == () and STORE.flow[CASE]["step"] == "setup"
    assert not any(b"step_done" in m.get("body", b"") for m in sent)
    assert CASE not in plan_events.RUNS
    # (c) the log says so
    assert any("turn cut-me" in r.getMessage() and "cancelled" in r.getMessage() for r in caplog.records)
    assert any("cut while a tool ran" in r.getMessage() for r in caplog.records)


def test_replay_cuts_a_turn_whose_stream_is_still_open(caplog):
    """/replay does not wait for the running turn even when its stream has not closed yet."""
    seen, sent = {}, []

    async def main():
        app = fake_app(seen)
        gone = asyncio.Event()
        turn = asyncio.create_task(open_turn(app, sent, gone))
        while "tool_started" not in seen:
            await asyncio.sleep(0.01)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            t0 = time.perf_counter()
            rep = await c.post(f"/api/cases/{CASE}/replay", json={"step": "setup", "base_plan_id": None})
            seen["replay_ms"] = (time.perf_counter() - t0) * 1000
        gone.set()
        await asyncio.wait_for(turn, 5)
        while "late_target" not in seen:
            await asyncio.sleep(0.01)
        return rep

    with caplog.at_level(logging.INFO, logger="cualign"):
        rep = asyncio.run(main())
    assert rep.status_code == 200 and seen["replay_ms"] < 500, seen
    assert seen.get("workflow_cancelled") and seen["late_target"] not in STORE.targets
    assert any("the recorded answer was asked for" in r.getMessage() for r in caplog.records)


def test_recorded_head_is_the_recording_without_computing(monkeypatch):
    """GET .../replay/<step>: the step, date and reasoning of the recording; 404 where the POST gives 404."""
    app = FastAPI()
    add_api_routes(app)

    async def main():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            return (await c.get("/api/cases/poseidon-000097/replay/setup"), await c.get("/api/cases/poseidon-000097/replay/plan"),
                    await c.get("/api/cases/moderate/replay/setup"), await c.get("/api/cases/poseidon-000097/replay/nope"))
    setup, plan, none, bad = asyncio.run(main())
    assert setup.status_code == 200 and setup.json()["reasoning"] and setup.json()["step_ko"] == "셋업"
    assert plan.status_code == 200 and plan.json()["step"] == "stages" and "reasoning" not in plan.json()
    assert none.status_code == 404 and bad.status_code == 404
