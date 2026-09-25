"""Exercise request context through ASGI task boundaries. Guardrails: test_rails_middleware.py."""
import asyncio
import json

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from cualign.agent.context import CURRENT_RUN
from cualign.core.constraints import Constraints
from cualign.core.service import PlanningService
from cualign.core import store as store_module
from cualign.server import plan_events


def test_selected_event_parent_and_context_cleanup(tmp_path, monkeypatch):
    s = store_module.Store()
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    monkeypatch.setattr(plan_events, "STORE", s)
    svc = PlanningService(s)
    parent = svc.stages(svc.target("moderate", "expansion_ipr", Constraints(lock=(13,))))
    app = FastAPI()
    seen = {}
    @app.post("/chat/stream")
    async def chat(request: Request):
        body = await request.json()
        assert "cualign" not in body
        async def generate():
            async def compute():
                run = CURRENT_RUN.get()
                seen["run"] = run
                a = svc.stages(svc.target(run.case_id, "expansion_ipr", run.constraints), run.base_plan_id)
                b = svc.stages(svc.target(run.case_id, "ipr", run.constraints), run.base_plan_id)
                run.plan_ids.update((a,b))
                run.selected_plan_id = a
                seen["chosen"], seen["last"] = a, b
            await asyncio.create_task(compute())
            yield 'data: {"value":"설명에 계획 ID가 없어도 됩니다."}\n\n'
        return StreamingResponse(generate(), media_type="text/event-stream")
    app.add_middleware(plan_events.PlanEventsASGI)
    with TestClient(app) as client:
        res = client.post("/chat/stream", json={"messages":[{"role":"user","content":"수정"}],
            "cualign":{"request_id":"request-2","case_id":"moderate","base_plan_id":parent,"constraints":{"ipr_exclude":[7]}}})
        assert res.status_code == 200
        assert "event: plan_selected" in res.text
        payload = res.text.split("event: plan_selected\ndata: ")[1].split("\n")[0]
        event = json.loads(payload)
        assert event["plan_id"] == seen["chosen"] != seen["last"]
        assert event["parent_plan_id"] == parent and event["request_id"] == "request-2"
        assert seen["run"].constraints.lock == (13,)
        assert seen["run"].closed
        assert CURRENT_RUN.get() is None
        bad = client.post("/chat/stream", json={"messages":[], "cualign":{"case_id":"severe","base_plan_id":parent}})
        assert bad.status_code == 400


def test_generated_but_unselected_plan_is_not_auto_selected(tmp_path, monkeypatch):
    s = store_module.Store()
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    monkeypatch.setattr(plan_events, "STORE", s)
    app = FastAPI()
    @app.post("/chat/stream")
    async def chat():
        async def generate():
            run = CURRENT_RUN.get()
            svc = PlanningService(s)
            pid = svc.stages(svc.target(run.case_id,"expansion_ipr",run.constraints))
            run.plan_ids.add(pid)
            yield 'data: {"value":"done"}\n\n'
        return StreamingResponse(generate(), media_type="text/event-stream")
    app.add_middleware(plan_events.PlanEventsASGI)
    with TestClient(app) as client:
        res = client.post("/chat/stream",json={"messages":[],"cualign":{"case_id":"moderate"}})
        assert "event: plan_error" in res.text
        assert "event: plan_selected" not in res.text


def test_skipped_review_runs_before_plan_is_offered(tmp_path, monkeypatch):
    s = store_module.Store()
    monkeypatch.setattr(store_module, "OUT_DIR", tmp_path)
    monkeypatch.setattr(plan_events, "STORE", s)
    svc = PlanningService(s)
    calls = []
    async def review(plan_id):
        calls.append(plan_id)
        return s.set_review(plan_id, {"status": "passed", "attempts": 1, "message": "메모", "error": None})
    app = FastAPI()
    app.state.cualign_review = review
    agent_reviews = {}
    @app.post("/chat/stream")
    async def chat():
        async def generate():
            run = CURRENT_RUN.get()
            pid = svc.stages(svc.target(run.case_id, "expansion_ipr", run.constraints))
            run.plan_ids.add(pid)
            run.selected_plan_id = pid
            if agent_reviews.get("failed"):  # the agent did call the reviewer this time, and it failed
                s.set_review(pid, {"status": "failed", "attempts": 2, "message": "검토 실패", "error": "timeout"})
            yield 'data: {"value":"done"}\n\n'
        return StreamingResponse(generate(), media_type="text/event-stream")
    app.add_middleware(plan_events.PlanEventsASGI)
    def selected(res):
        return json.loads(res.text.split("event: plan_selected\ndata: ")[1].split("\n")[0])
    with TestClient(app) as client:
        event = selected(client.post("/chat/stream", json={"messages": [], "cualign": {"case_id": "moderate"}}))
        assert event["reviewed_by_server"] is True and event["review"]["status"] == "passed"
        assert calls == [event["plan_id"]]
        agent_reviews["failed"] = True
        event = selected(client.post("/chat/stream", json={"messages": [], "cualign": {"case_id": "moderate"}}))
        assert event["reviewed_by_server"] is False and event["review"]["error"] == "timeout"
        assert len(calls) == 1  # a failure the agent got is not overridden; the dentist may ask again
