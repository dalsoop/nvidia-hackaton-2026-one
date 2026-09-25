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
from cualign.agent.react_history_patch import already_recorded
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


@pytest.mark.parametrize("log,tool,tool_input,expected", [
    ('Action: t\nAction Input: {"lock": [13]}', "t", '{"lock": [13]}', True),
    ("Thought: x\n  Action : t\nAction Input:{ 'x': 1 }", "t", "{ 'x': 1 }", True),  # not JSON: text compare
    ('Action: t\nAction Input: {  "lock" :[13] }', "t", '{"lock": [13]}', True),  # spacing only
    ('Action: t\nAction Input: {"lock": [3]}', "t", '{"lock": [13]}', False),  # a different input
    ('Action: other\nAction Input: {"lock": [13]}', "t", '{"lock": [13]}', False),
    ("Calling t", "t", '{"lock": [13]}', False),  # NAT's fallback log names no input
])
def test_already_recorded_compares_inputs_as_json(log, tool, tool_input, expected):
    assert already_recorded(log, tool, tool_input) is expected


class ScriptedModel(FakeMessagesListChatModel):
    """First reply is `first`; once the tool result is in the prompt it answers."""
    first: AIMessage
    seen: list = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.seen.append(messages)
        done = any(isinstance(m, HumanMessage) and "tool-result" in m.content for m in messages)
        message = AIMessage(content="Final Answer: 작업 완료") if done else self.first
        return ChatResult(generations=[ChatGeneration(message=message)])


def run_scripted(first):
    calls = []

    def operation(lock: list[int] | None = None) -> str:
        calls.append(lock)
        return "tool-result"

    tool = StructuredTool.from_function(operation, name="cualign__set_constraints", description="Offline test")
    model = ScriptedModel(responses=[], first=first)

    async def run():
        graph = await graph_for(model, tool).build_graph()
        return await graph.ainvoke({"messages": [HumanMessage(content="13번 고정")]}, config={"recursion_limit": 6})

    result = asyncio.run(run())
    assert result["final_answer"] == "작업 완료" and len(model.seen) == 2
    history = [m.content for m in model.seen[1] if isinstance(m, AIMessage)]
    assert len(history) == 1
    return calls, history[0]


def test_text_action_is_not_recorded_twice():
    """Native mode, but the model writes the call as ReAct text (spacing differs from json.dumps)."""
    calls, log = run_scripted(AIMessage(content='Thought: 고정한다.\nAction: cualign__set_constraints\n'
                                                'Action Input: {  "lock" :[13] }'))
    assert calls == [[13]]
    assert log.count("Action:") == 1


def test_copied_format_with_a_different_input_records_the_executed_call():
    """The text names one input, the native call another: the executed call is appended last."""
    calls, log = run_scripted(AIMessage(
        content='Thought: 고정한다.\nAction: cualign__set_constraints\nAction Input: {"lock": [3]}',
        tool_calls=[{"name": "cualign__set_constraints", "args": {"lock": [13]}, "id": "call-test"}]))
    assert calls == [[13]]
    assert log.count("Action:") == 2
    assert log.rstrip().endswith('Action: cualign__set_constraints\nAction Input: {"lock": [13]}')


def test_copied_format_with_the_same_input_is_not_recorded_twice():
    """Same call as the native one, written with other spacing and a trailing line: still one record."""
    calls, log = run_scripted(AIMessage(
        content='Thought: 고정한다.\nAction: cualign__set_constraints\nAction Input: {"lock":[13]}\n(13번 고정)',
        tool_calls=[{"name": "cualign__set_constraints", "args": {"lock": [13]}, "id": "call-test"}]))
    assert calls == [[13]]
    assert log.count("Action:") == 1
