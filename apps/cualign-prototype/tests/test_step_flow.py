"""The agent pushes the plan one step per turn (agent/steps.py, .report/15-step-flow.md).

Through the real NAT app with a local fake planner: a setup turn may only set conditions, a target turn may only make
the target arrangement, a stages turn does the rest and may take the target the previous turn made. A tool past the
step is refused with a normal result (the model reads it and stops), each finished step ends in a `step_done` SSE
event, and Store.flow keeps where the case stands for /activate."""
import json
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rails_fakes import FakeLLM, PlanningLLM
from test_rails_middleware import ask, serve, sse_event, store  # noqa: F401  (store is a fixture)
from cualign.agent import steps
from cualign.agent.context import CURRENT_RUN, PlanRun
from cualign.core import store as store_mod
from cualign.core.constraints import Constraints
from cualign.core.service import PlanningService
from cualign.server import api

PRESCRIPTION = "처방은 제1소구치 14·24 발치입니다. 이 처방으로 단계 계획을 짜 주세요."


def _call(n, name, args):
    return {"id": f"call_{n}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


class SetupLLM(FakeLLM):
    """A setup turn that oversteps: set_constraints, then propose_target (refused), then the question back."""

    def reply(self, req):
        n = len(self.requests)
        if n == 1:
            return {"role": "assistant", "content": "", "tool_calls": [_call(n, "cualign__set_constraints", {"extraction": [5, 12]})]}
        if n == 2:
            return {"role": "assistant", "content": "", "tool_calls": [_call(n, "cualign__propose_target", {"strategy": "extraction"})]}
        return {"role": "assistant", "content": "14·24 발치, IPR 없음으로 셋업했습니다. 이대로 목표 배열을 만들까요?"}


class TargetLLM(FakeLLM):
    """A target turn that oversteps: propose_target, then plan_stages (refused), then reviewer (refused), then the question."""

    def reply(self, req):
        n = len(self.requests)
        seen = json.dumps(req.get("messages", []), ensure_ascii=False)
        target = re.findall(r"target_id\W+(t[0-9a-f]+)", seen)
        if n == 1:
            return {"role": "assistant", "content": "", "tool_calls": [_call(n, "cualign__propose_target", {"strategy": "expansion_ipr"})]}
        if n == 2:
            return {"role": "assistant", "content": "", "tool_calls": [_call(n, "cualign__plan_stages", {"target_id": target[-1]})]}
        if n == 3:
            return {"role": "assistant", "content": "", "tool_calls": [_call(n, "reviewer", {"plan_id": "p000000"})]}
        return {"role": "assistant", "content": "목표 배열을 만들었습니다. 확장과 IPR 로 총생을 해소합니다. 단계로 나눌까요?"}


def _refusals(llm, name):
    """The refusal results the fake model received for `name` (NAT's ReAct loop hands tool results back as user text)."""
    return [m["content"] for req in llm.requests for m in req.get("messages", [])
            if m.get("role") == "user" and steps.REFUSED in str(m.get("content")) and f"'rejected': '{name}'" in str(m.get("content"))]


def _context(llm):
    """The cuAlign server context the first request carried (inside the ReAct prompt's conversation history)."""
    for m in llm.requests[0]["messages"]:
        content = str(m.get("content"))
        if "cuAlign server context: " in content:
            return json.loads(content.split("cuAlign server context: ", 1)[1].splitlines()[0])
    raise AssertionError("no server context in the first request")


def test_gating_table():
    assert steps.allowed("setup", "set_constraints") and steps.allowed("setup", "load_case")
    assert not steps.allowed("setup", "propose_target") and not steps.allowed("setup", "reviewer")
    assert steps.allowed("target", "propose_target") and not steps.allowed("target", "plan_stages")
    assert steps.allowed("stages", "reviewer") and steps.allowed(None, "export_stl")   # no step: everything, as before
    note = steps.refusal("setup", "propose_target")
    assert note["rejected"] == "propose_target" and steps.REFUSED in note["note"] and "되물으세요" in note["note"]


def test_setup_turn_sets_conditions_and_stops(tmp_path, monkeypatch, store):
    with SetupLLM() as llm, serve(tmp_path, monkeypatch, llm) as client:
        text = ask(client, "/chat/stream", [{"role": "user", "content": PRESCRIPTION}],
                   cualign={"case_id": "moderate", "request_id": "r-setup"}, step="setup")
    done = sse_event(text, "step_done")
    assert done["step"] == "setup" and done["request_id"] == "r-setup" and done["case_id"] == "moderate"
    assert done["constraints"]["extraction"] == [5, 12] and done["constraints"]["stage_cap"] is None   # Universal, as plan_context
    assert done["conditions_ko"].startswith("발치 치아 14·24번") or "14" in done["conditions_ko"]
    assert sse_event(text, "plan_context")["constraints"] == done["constraints"]
    assert "plan_selected" not in text and "plan_error" not in text and "이대로 목표 배열을 만들까요?" in text
    # the overstep was refused as a normal result and nothing was computed
    assert _refusals(llm, "propose_target")
    assert not [t for t in store.targets.values() if t["case_id"] == "moderate"] and store.plan_ids_for("moderate") == []
    assert store.flow["moderate"]["step"] == "setup" and store.flow["moderate"]["constraints"].extraction == (5, 12)
    # the setup turn's context told the model its step
    context = _context(llm)
    assert context["step"] == "setup" and "셋업" in context["step_ko"]


def test_target_turn_makes_the_target_and_stops(tmp_path, monkeypatch, store):
    with TargetLLM() as llm, serve(tmp_path, monkeypatch, llm) as client:
        text = ask(client, "/chat/stream", [{"role": "user", "content": "이대로 목표 배열을 만들어줘."}],
                   cualign={"case_id": "moderate", "request_id": "r-target"}, step="target")
        done = sse_event(text, "step_done")
        assert done["step"] == "target" and done["request_id"] == "r-target"
        tid = done["target_id"]
        assert tid in store.targets and store.targets[tid]["case_id"] == "moderate"
        summary = done["summary"]
        assert summary["strategy"] == "expansion_ipr" and summary["crowding_mm"] > 0 and summary["space_mm"] is not None
        assert summary["extraction"] == [] and all(len(p) == 3 and 11 <= p[0] <= 28 for p in summary["ipr"])
        assert "plan_selected" not in text and "plan_error" not in text and "단계로 나눌까요?" in text
        assert store.plan_ids_for("moderate") == [] and store.flow["moderate"] == {"step": "target", "constraints": store.flow["moderate"]["constraints"],
                                                                                    "target_id": tid, "plan_id": None}
        assert _refusals(llm, "plan_stages") and _refusals(llm, "reviewer")
        # the target as the screen draws it: a plan-shaped response with one stage
        t = client.get(f"/api/cases/moderate/targets/{tid}").json()
        assert t["target_id"] == tid and t["strategy"] == "expansion_ipr" and t["violations"] == [] and t["passed"] is True
        assert len(t["stages"]) == 1 and len(t["rotations"]) == 1 and t["pivots"] and t["summary"] == summary
        assert set(t["stages"][0]) and all(len(v) == 3 for v in t["stages"][0].values())
        assert t["target"]["removed"] == [] and "ipr_mm_per_surface" in t["target"] and "ipr_exclude" in t["target"]
        assert t["constraints"]["extraction"] == []
        assert client.get(f"/api/cases/mild/targets/{tid}").status_code == 404 and client.get("/api/cases/moderate/targets/t0").status_code == 404
        # opening the case again restores where it stands
        opened = client.post("/api/cases/moderate/activate").json()
        assert opened["flow"]["step"] == "target" and opened["flow"]["target_id"] == tid and opened["active_plan"] is None


def test_stages_turn_takes_the_target_the_previous_turn_made(tmp_path, monkeypatch, store):
    """After a target turn the stages turn's context carries target_id; the fake planner (like the instructions say)
    calls plan_stages with it, so the plan is built on that very target and no new one is made."""
    cid, case = store.load_case("moderate")
    tid = PlanningService(store).target(cid, "expansion", store.constraints_for(cid))
    store.set_flow(cid, "target", constraints=store.constraints_for(cid), target_id=tid, plan_id=None)
    with PlanningLLM("**확장 전략으로 계획을 만들었습니다.** 이 계획은 초안입니다. 최종 판단은 의사가 합니다.") as llm, \
            serve(tmp_path, monkeypatch, llm) as client:
        text = ask(client, "/chat/stream", [{"role": "user", "content": "단계로 나눠줘."}],
                   cualign={"case_id": "moderate", "request_id": "r-stages"}, step="stages")
    context = _context(llm)
    assert context["step"] == "stages" and context["target_id"] == tid
    selected = sse_event(text, "plan_selected")
    done = sse_event(text, "step_done")
    assert done == {"step": "stages", "request_id": "r-stages", "case_id": "moderate", "plan_id": selected["plan_id"], "target_id": tid}
    assert store.plans[selected["plan_id"]]["target_id"] == tid
    assert [t for t in store.targets if store.targets[t]["case_id"] == cid] == [tid]      # no new target
    assert store.flow[cid] == {"step": "stages", "constraints": store.flow[cid]["constraints"], "target_id": tid, "plan_id": selected["plan_id"]}
    # a turn without a step is a stages turn, as before (the fake makes its own target then)
    with PlanningLLM("**확장 전략으로 계획을 만들었습니다.** 이 계획은 초안입니다. 최종 판단은 의사가 합니다.") as llm, \
            serve(tmp_path, monkeypatch, llm) as client:
        text = ask(client, "/chat/stream", [{"role": "user", "content": "계획 짜줘."}], cualign={"case_id": "mild"})
    assert sse_event(text, "step_done")["step"] == "stages" and sse_event(text, "plan_selected")
    assert _context(llm)["step"] == "stages"


def test_a_bad_step_is_400():
    from cualign.server.plan_events import ChatContext
    with pytest.raises(ValueError):
        ChatContext(case_id="moderate", step="export")


def test_reviewer_is_refused_before_the_stages_step(store):
    import asyncio
    from cualign.agent.reviewer import review_plan
    cid, _ = store.load_case("moderate")
    ids = PlanningService(store).compare(cid, store.constraints_for(cid), ["expansion"])
    run = PlanRun("r", cid, None, store.constraints_for(cid), step="target", selected_plan_id=ids[0])
    token = CURRENT_RUN.set(run)
    try:
        out = asyncio.run(review_plan(ids[0], llm=None, store=store))
    finally:
        CURRENT_RUN.reset(token)
    assert out["rejected"] == "reviewer" and steps.REFUSED in out["note"]
    assert store.plans[ids[0]]["review"]["status"] == "not_requested"


def test_target_summary_reads_the_planner_info():
    info = {"crowding_mm": 4.2, "space_gain_mm": 3.9, "space_deficit_mm": 0.3, "strategy": "ipr", "extraction": [],
            "ipr_applied_teeth": [6, 7, 8, 9, 12], "ipr_mm_per_surface": 0.25, "expansion_mm_per_side": 0.0}
    s = steps.target_summary(info)
    assert s["ipr"] == [[13, 12, 0.25], [12, 11, 0.25], [11, 21, 0.25]] and s["extraction"] == [] and s["space_mm"] == 3.9
    s = steps.target_summary({**info, "strategy": "extraction", "extraction": [5, 12], "ipr_mm_per_surface": 0.0})
    assert s["extraction"] == [14, 24] and s["ipr"] == []
