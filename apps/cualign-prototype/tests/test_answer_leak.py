"""ReAct reasoning must not leak into the streamed final answer (/chat/stream, 2026-09-26 sandbox capture).

NAT's react_agent `_stream_fn` buffered the text of every agent LLM call; in native tool-calling mode the model's
pre-tool-call reasoning ("... Action: cualign__select_plan") was prepended to the Korean answer. The fixture is the
shape of that capture with synthetic ids only."""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from langchain_core.messages import AIMessageChunk, ToolMessage

from cualign.agent import react_patch

react_patch.apply()

REASONING_1 = 'We need to propose a target.\nAction: cualign__propose_target\nAction Input: {"strategy": "ipr"}'
REASONING_2 = ("We have a plan that passed. We should call select_plan with this plan_id.\n"
               'Action: cualign__select_plan\nAction Input: {"plan_id": "p0000test"}')
ANSWER = ("선택된 계획 ID: p0000test\n전략: IPR\n단계: 30단계(약 7개월)\n발치 허용: 아니요\n규칙 검사: 통과\n"
          "이 계획은 초안입니다. 최종 판단은 의사가 합니다.")
AGENT = {"langgraph_node": "agent"}


def _chunks(call_id: str, text: str, step: int) -> list:
    half = len(text) // 2
    return [(AIMessageChunk(content=part, id=call_id), {**AGENT, "langgraph_step": step})
            for part in (text[:half], text[half:])]


async def _collect(items: list) -> list:
    async def src():
        for item in items:
            yield item
    return [item async for item in react_patch.last_agent_call_only(src())]


def _text(items: list) -> str:
    return "".join(m.content for m, meta in items if isinstance(m, AIMessageChunk) and meta.get("langgraph_node") == "agent")


def test_only_the_last_agent_call_reaches_the_answer():
    tool = (ToolMessage(content="{}", tool_call_id="t1"), {"langgraph_node": "tool"})
    items = _chunks("run-1", REASONING_1, 1) + [tool] + _chunks("run-2", REASONING_2, 3) + [tool] + _chunks("run-3", ANSWER, 5)
    out = asyncio.run(_collect(items))
    assert _text(out) == ANSWER
    assert "Action" not in _text(out)
    assert sum(1 for m, _ in out if isinstance(m, ToolMessage)) == 2   # non-agent items pass through


def test_clean_single_answer_passes_unchanged():
    items = _chunks("run-1", ANSWER, 1)
    assert asyncio.run(_collect(items)) == items


def test_chunks_without_id_are_split_by_graph_step():
    items = [(AIMessageChunk(content=m.content), meta) for m, meta in _chunks("", REASONING_2, 1) + _chunks("", ANSWER, 3)]
    assert _text(asyncio.run(_collect(items))) == ANSWER


def test_streamed_workflow_answer_has_no_reasoning(tmp_path):
    """Real NAT react_agent stream + middleware, every LLM a local fake: the stream equals the last call's text."""
    pytest.importorskip("nat.runtime.loader")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import yaml
    from evals.golden_a.fake_llm import FakeLLM
    from evals.golden_a.runner import build_config
    from nat.data_models.api_server import ChatRequest
    from nat.runtime.loader import load_workflow

    class _Writer:
        """Real NIM streams the reasoning text before the tool calls; FakeLLM sends both in one delta."""
        def __init__(self, raw):
            self.raw = raw

        def write(self, data: bytes):
            line = data.decode()
            if line.startswith("data: {"):
                body = json.loads(line[6:])
                delta = body["choices"][0]["delta"]
                if delta.get("content") and delta.get("tool_calls"):
                    calls = delta.pop("tool_calls")
                    self.raw.write(f"data: {json.dumps(body, ensure_ascii=False)}\n\n".encode())
                    body["choices"][0]["delta"] = {"tool_calls": calls}
                    data = f"data: {json.dumps(body, ensure_ascii=False)}\n\n".encode()
            self.raw.write(data)

    class SplitLLM(FakeLLM):
        def _handler(self):
            base = super()._handler()

            class Handler(base):
                def do_POST(self):
                    self.wfile = _Writer(self.wfile)
                    super().do_POST()
            return Handler

    script = [{"content": "We need the limits first.\nAction: cualign__clinical_limits\nAction Input: {}",
               "tool_calls": [("cualign__clinical_limits", {})]},
              {"content": ANSWER}]

    async def go():
        with SplitLLM(script=script) as llm:
            cfg = tmp_path / "workflow.yml"
            cfg.write_text(yaml.safe_dump(build_config(all_llms=llm.llm_config()), allow_unicode=True), encoding="utf-8")
            async with load_workflow(str(cfg)) as workflow:
                async with workflow.run(ChatRequest(messages=[{"role": "user", "content": "한계값 알려줘"}])) as runner:
                    return "".join([str(c) async for c in runner.result_stream(to_type=str)])

    out = asyncio.run(asyncio.wait_for(go(), timeout=600))   # a hang guard only: under a parallel --slow run the build takes long
    assert "Action" not in out and "We need" not in out
    assert out.strip().endswith("최종 판단은 의사가 합니다.")
