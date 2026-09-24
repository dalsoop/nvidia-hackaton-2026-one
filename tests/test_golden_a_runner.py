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
              {"tool_calls": [("cualign__load_case", {"case_id": "moderate"})]},              # turn 2
              {"tool_calls": [("cualign__propose_target", {"strategy": "expansion_ipr"})]},
              {"tool_calls": [("cualign__plan_stages", {"target_id": "t1", "order": "simultaneous"})]},
              {"tool_calls": [("cualign__validate", {"plan_id": "p1", "stage_cap": 52})]},
              {"content": "plan_id: p1. 이 계획은 초안입니다. 최종 판단은 의사가 합니다."}]
    tr, requests, _ = _run("A02", script, tmp_path)
    assert [t.user for t in tr.turns] == SPECS["A02"].turns
    names = [c.name for c in tr.turns[1].calls]
    assert names == ["load_case", "propose_target", "plan_stages", "validate"]
    assert tr.turns[1].calls[-1].args["stage_cap"] == 52 and "passed" in tr.turns[1].calls[-1].result
    # NAT's ReAct agent folds earlier turns into the prompt ("Previous conversation history: ...")
    prompt = " ".join(str(m.get("content")) for m in requests[1]["messages"])
    assert SPECS["A02"].turns[0] in prompt and ASK in prompt and SPECS["A02"].turns[1] in prompt


def test_reviewer_fault_injection_is_recorded(tmp_path):
    script = [{"tool_calls": [("cualign__load_case", {"case_id": "moderate"})]},
              {"tool_calls": [("cualign__propose_target", {"strategy": "expansion_ipr"})]},
              {"tool_calls": [("cualign__plan_stages", {"target_id": "t1", "order": "simultaneous"})]},
              {"tool_calls": [("cualign__validate", {"plan_id": "p1", "stage_cap": 52})]},
              {"tool_calls": [("reviewer", {"input_message": "p1"})]},
              {"content": "plan_id: p1. 검토 메모 생성 실패. 이 계획은 초안입니다. 최종 판단은 의사가 합니다."}]
    tr, _, reviewer_requests = _run("A15", script, tmp_path, reviewer_empty=True)
    t = tr.turns[0]
    rv = [c for c in t.calls if c.name == "reviewer"]
    assert reviewer_requests, "the reviewer agent must have called the fake empty LLM"
    assert rv and not rv[-1].ok                           # empty / error output, not a memo
    assert t.parse_retries > 0 or t.errors                # NAT's retries are visible in the trace
