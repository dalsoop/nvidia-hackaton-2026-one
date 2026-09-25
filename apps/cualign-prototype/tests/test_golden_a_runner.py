"""Offline tests for the golden-set runner: the real NAT workflow and cuAlign tools, with every LLM replaced by a
local fake OpenAI server (no key, no network). Checks that the runner records what the agent actually did."""
import asyncio
import sys
from pathlib import Path

import pytest

pytest.importorskip("nat.runtime.loader")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.golden_a.fake_llm import FakeLLM  # noqa: E402
from evals.golden_a.judge import judge, load_specs  # noqa: E402
from evals.golden_a.runner import build_config, run_spec  # noqa: E402

SPECS = load_specs()
ASK = "발치는 허용되나요? 치료 기간 상한은 몇 개월인가요?"
# The tools generate uuid ids; FakeLLM fills "$target_id" / "$plan_id" from the latest tool result.
PLAN_TURN = [{"tool_calls": [("cualign__load_case", {"case_id": "moderate"})]},
             {"tool_calls": [("cualign__set_constraints", {"stage_cap": 52, "allow_extraction": False})]},
             {"tool_calls": [("cualign__propose_target", {"strategy": "expansion_ipr"})]},
             {"tool_calls": [("cualign__plan_stages", {"target_id": "$target_id"})]},
             {"tool_calls": [("cualign__validate", {"plan_id": "$plan_id"})]}]


def _run(spec_id, script, tmp_path, reviewer_empty=False):
    async def go():
        with FakeLLM(script=script) as planner:
            if reviewer_empty:
                with FakeLLM(mode="empty") as rv:
                    cfg = build_config(all_llms=planner.llm_config(), reviewer_llm=rv.llm_config("fault-empty"))
                    return await run_spec(SPECS[spec_id], cfg, "nat:fake", tmp_path), planner.requests, rv.requests
            cfg = build_config(all_llms=planner.llm_config())
            return await run_spec(SPECS[spec_id], cfg, "nat:fake", tmp_path), planner.requests, []
    return asyncio.run(asyncio.wait_for(go(), timeout=240))


def test_runner_records_real_tool_results(tmp_path):
    tr, _, _ = _run("A01", [{"tool_calls": [("cualign__load_case", {"case_id": "moderate"})]}, {"content": ASK}], tmp_path)
    t = tr.turns[0]
    assert t.answer == ASK
    assert [(c.name, c.agent) for c in t.calls] == [("load_case", "planner")]
    assert t.calls[0].args == {"case_id": "moderate"} and t.calls[0].result["case_id"] == "moderate"
    assert "crowding_mm" in t.calls[0].result            # computed by the real core, not by the fake
    assert judge(SPECS["A01"], tr).passed


def test_runner_multi_turn_keeps_history_and_store(tmp_path):
    script = [{"content": ASK},                                                               # turn 1: interview
              *PLAN_TURN,                                                                     # turn 2
              {"content": "plan_id: $plan_id. 이 계획은 초안입니다. 최종 판단은 의사가 합니다."}]
    tr, requests, _ = _run("A02", script, tmp_path)
    assert [t.user for t in tr.turns] == SPECS["A02"].turns
    calls = tr.turns[1].calls
    assert [c.name for c in calls] == ["load_case", "set_constraints", "propose_target", "plan_stages", "validate"]
    assert calls[3].args["target_id"] == calls[2].result["target_id"]          # placeholders got the real ids
    v = calls[-1]
    assert v.args["plan_id"] == calls[3].result["plan_id"] and "passed" in v.result
    assert v.result["constraints"]["stage_cap"] == 52                          # set_constraints reached validate
    assert v.result["plan_id"] in tr.turns[1].answer
    # NAT's ReAct agent folds earlier turns into the prompt ("Previous conversation history: ...")
    prompt = " ".join(str(m.get("content")) for m in requests[1]["messages"])
    assert SPECS["A02"].turns[0] in prompt and ASK in prompt and SPECS["A02"].turns[1] in prompt


def test_reviewer_fault_injection_is_recorded(tmp_path):
    script = [*PLAN_TURN,
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
