"""Run NAT's real graph with an offline model that needs the previous call to advance."""
import asyncio
import json

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import StructuredTool
from pydantic import Field

from cualign.agent import register  # noqa: F401  apply the same patches as the service
from nat.plugins.langchain.agent.react_agent.agent import ReActAgentGraph, create_react_agent_prompt
from nat.plugins.langchain.agent.react_agent.register import ReActAgentWorkflowConfig


class HistoryModel(FakeMessagesListChatModel):
    tool_name: str
    arguments: dict
    reasoning: str = "Thought: First I need to call the tool."
    seen: list = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.seen.append(messages)
        # A tool result alone does not tell the model which action/arguments produced it.
        remembered = any(
            isinstance(m, AIMessage) and self.tool_name in m.content
            and json.dumps(self.arguments) in m.content for m in messages
        )
        result_seen = any(isinstance(m, HumanMessage) and "tool-result" in m.content for m in messages)
        message = AIMessage(content="Final Answer: 작업 완료") if remembered and result_seen else AIMessage(
            content=self.reasoning,
            tool_calls=[{"name": self.tool_name, "args": self.arguments, "id": "call-test"}],
        )
        return ChatResult(generations=[ChatGeneration(message=message)])


def graph_for(model, tool):
    return ReActAgentGraph(
        llm=model, tools=[tool], use_native_tool_calling=True,
        prompt=create_react_agent_prompt(ReActAgentWorkflowConfig(tool_names=[tool.name], llm_name="offline")),
    )


@pytest.mark.parametrize("name,args", [
    ("cualign__get_constraints", {"unused": ""}),
    ("cualign__set_constraints", {"lock": [13], "stage_cap": None}),
])
@pytest.mark.parametrize("reasoning", ["Thought: First I need to call the tool.", ""])
def test_native_call_history_advances_instead_of_repeating(name, args, reasoning):
    calls = []

    def operation(unused: str = "", lock: list[int] | None = None, stage_cap: int | None = None) -> str:
        calls.append((unused, lock, stage_cap))
        return "tool-result"

    tool = StructuredTool.from_function(operation, name=name, description="Offline test operation")
    model = HistoryModel(responses=[], tool_name=name, arguments=args, reasoning=reasoning)

    async def run():
        graph = await graph_for(model, tool).build_graph()
        return await graph.ainvoke({"messages": [HumanMessage(content="조건을 확인하고 수정해줘")]},
                                  config={"recursion_limit": 6})

    result = asyncio.run(run())
    assert result["final_answer"] == "작업 완료"
    assert len(calls) == 1
    assert len(model.seen) == 2
