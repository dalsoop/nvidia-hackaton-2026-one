"""Offline tests for the golden-set runner: the real NAT workflow and cuAlign tools, with every LLM replaced by a
local fake OpenAI server (no key, no network). Checks that the runner records what the agent actually did."""
import asyncio
import dataclasses
import sys
from pathlib import Path

import pytest

pytest.importorskip("nat.runtime.loader")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.golden_a.fake_llm import FakeLLM  # noqa: E402
from evals.golden_a.judge import judge, load_specs  # noqa: E402
from evals.golden_a.runner import build_config, run_spec, ui_greeting  # noqa: E402

SPECS = load_specs()
# The tools generate uuid ids; FakeLLM fills "$target_id" / "$plan_id" from the latest tool result.
PLAN_TURN = [{"tool_calls": [("cualign__load_case", {"case_id": "moderate"})]},
             {"tool_calls": [("cualign__set_constraints", {"stage_cap": 52, "allow_extraction": False})]},
             {"tool_calls": [("cualign__propose_target", {"strategy": "expansion_ipr"})]},
             {"tool_calls": [("cualign__plan_stages", {"target_id": "$target_id"})]},
             {"tool_calls": [("cualign__validate", {"plan_id": "$plan_id"})]}]


def _run(spec, script, tmp_path, reviewer_empty=False):
    spec = SPECS[spec] if isinstance(spec, str) else spec

    async def go():
        with FakeLLM(script=script) as planner:
            if reviewer_empty:
                with FakeLLM(mode="empty") as rv:
                    cfg = build_config(all_llms=planner.llm_config(), reviewer_llm=rv.llm_config("fault-empty"))
                    return await run_spec(spec, cfg, "nat:fake", tmp_path), planner.requests, rv.requests
            cfg = build_config(all_llms=planner.llm_config())
            return await run_spec(spec, cfg, "nat:fake", tmp_path), planner.requests, []
    return asyncio.run(asyncio.wait_for(go(), timeout=240))


def _labels(cap: str) -> str:
    return f"사용한 조건: 발치 없이, 단계 상한 {cap}"


def test_runner_sends_what_the_ui_sends(tmp_path):
    """A01: greeting, server context with the displayed form, the dentist's words. The agent plans with the form."""
    script = [{"tool_calls": [("cualign__load_case", {"case_id": "moderate"})]},
              {"tool_calls": [("cualign__propose_target", {"strategy": "expansion_ipr"})]},
              {"tool_calls": [("cualign__plan_stages", {"target_id": "$target_id"})]},
              {"tool_calls": [("cualign__validate", {"plan_id": "$plan_id"})]},
              {"tool_calls": [("cualign__select_plan", {"plan_id": "$plan_id"})]},
              {"tool_calls": [("reviewer", {"plan_id": "$plan_id"})]},
              {"content": f"plan_id: $plan_id\n{_labels('없음')}\n검토 메모 생성 실패(empty_response).\n"
                          "이 계획은 초안입니다. 최종 판단은 의사가 합니다."}]
    tr, requests, _ = _run("A01", script, tmp_path, reviewer_empty=True)   # the reviewer must not eat the script
    t = tr.turns[0]
    assert [c.name for c in t.calls if c.agent == "planner"][:4] == ["load_case", "propose_target", "plan_stages", "validate"]
    assert "crowding_mm" in t.calls[0].result            # computed by the real core, not by the fake
    v = [c for c in t.calls if c.name == "validate"][-1]
    assert v.result["constraints"]["stage_cap"] is None and v.result["constraints"]["allow_extraction"] is False
    # what the model received: server context (form defaults), the UI greeting, then the dentist's words
    prompt = " ".join(str(m.get("content")) for m in requests[0]["messages"])
    assert "cuAlign server context: " in prompt and '"allow_extraction": false' in prompt and '"stage_cap": null' in prompt
    assert SPECS["A01"].turns[0] in prompt
    # The greeting is sent (as the UI sends it) but NAT's react_agent trims history with start_on="human", so a
    # leading assistant message never reaches the model, in the UI as here. Pinned so a NAT change is noticed.
    assert ui_greeting("moderate") not in prompt
    assert judge(SPECS["A01"], tr).passed, [f["id"] for f in judge(SPECS["A01"], tr).failures]


def test_runner_carries_form_and_plan_between_turns(tmp_path):
    """After a turn the UI shows the run's constraints and the selected plan; the next request sends them back."""
    spec = dataclasses.replace(SPECS["A02"], turns=[*SPECS["A02"].turns, "다시 한 번 요약해줘."])
    script = [{"tool_calls": [("cualign__load_case", {"case_id": "moderate"})]},
              {"tool_calls": [("cualign__set_constraints", {"stage_cap": 52, "allow_extraction": False})]},
              {"tool_calls": [("cualign__propose_target", {"strategy": "expansion_ipr"})]},
              {"tool_calls": [("cualign__plan_stages", {"target_id": "$target_id"})]},
              {"tool_calls": [("cualign__validate", {"plan_id": "$plan_id"})]},
              {"tool_calls": [("cualign__select_plan", {"plan_id": "$plan_id"})]},
              {"content": f"plan_id: $plan_id\n{_labels('52단계(12개월)')}\n이 계획은 초안입니다. 최종 판단은 의사가 합니다."},
              {"content": "앞 계획 그대로입니다."}]
    tr, requests, _ = _run(spec, script, tmp_path)
    calls = tr.turns[0].calls
    v = [c for c in calls if c.name == "validate"][-1]
    assert v.result["constraints"]["stage_cap"] == 52                          # set_constraints reached validate
    assert v.result["plan_id"] in tr.turns[0].answer
    last = " ".join(str(m.get("content")) for m in requests[-1]["messages"])
    assert f'"base_plan_id": "{v.result["plan_id"]}"' in last and '"stage_cap": 52' in last
    assert SPECS["A02"].turns[0] in last and "앞 계획 그대로입니다." not in last


def test_reviewer_fault_injection_is_recorded(tmp_path):
    script = [*PLAN_TURN,
              {"tool_calls": [("cualign__select_plan", {"plan_id": "$plan_id"})]},   # the reviewer takes only the selected plan
              {"tool_calls": [("reviewer", {"plan_id": "$plan_id"})]},
              {"content": "plan_id: $plan_id. 검토 메모 생성 실패. 이 계획은 초안입니다. 최종 판단은 의사가 합니다."}]
    tr, _, reviewer_requests = _run("A15", script, tmp_path, reviewer_empty=True)
    t = tr.turns[0]
    rv = [c for c in t.calls if c.name == "reviewer"]
    assert reviewer_requests, "the reviewer agent must have called the fake empty LLM"
    assert rv and rv[-1].args["plan_id"] == t.calls[len(PLAN_TURN) - 1].result["plan_id"]
    assert rv[-1].result["status"] == "failed"           # the bounded reviewer reports the failure, not a memo
    assert rv[-1].result["error"] == "empty_response"


def test_planner_parse_failures_are_counted(tmp_path):
    """Empty planner output: NAT retries the ReAct parse, then the turn fails; both must be in the trace."""
    tr, _, _ = _run("A01", [{"content": ""}], tmp_path)
    t = tr.turns[0]
    assert t.answer == "" and t.errors                     # the crash is recorded, not raised
    assert t.parse_retries >= 1                            # INFO-level retry records were captured
