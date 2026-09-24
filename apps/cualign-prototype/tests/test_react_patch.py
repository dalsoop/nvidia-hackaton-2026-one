"""NAT react_agent workaround: a JSON-wrapped ReAct block becomes a tool call, not a leaked final answer."""
import json

from langchain_core.agents import AgentAction, AgentFinish

from cualign.agent import react_patch
from nat.plugins.langchain.agent.react_agent.output_parser import ReActOutputParser

LEAK = '{\n  "Thought": "First, read the limits.",\n  "Action": "cualign__clinical_limits",\n  "Action Input": {"unused": ""}\n}'


def test_json_action_becomes_agent_action():
    react_patch.apply()
    out = ReActOutputParser().parse(LEAK)
    assert isinstance(out, AgentAction)
    assert out.tool == "cualign__clinical_limits"
    assert json.loads(out.tool_input) == {"unused": ""}


def test_json_final_answer_becomes_finish():
    react_patch.apply()
    out = ReActOutputParser().parse('```json\n{"Thought": "done", "Final Answer": "전략 ipr · 42장"}\n```')
    assert isinstance(out, AgentFinish)
    assert out.return_values["output"] == "전략 ipr · 42장"


def test_plain_text_still_raises():
    import pytest
    from nat.plugins.langchain.agent.react_agent.output_parser import ReActOutputParserException
    react_patch.apply()
    with pytest.raises(ReActOutputParserException):
        ReActOutputParser().parse("Thought: I should call a tool but forgot how")


def test_regular_react_text_unchanged():
    react_patch.apply()
    out = ReActOutputParser().parse("Thought: go\nAction: cualign__load_case\nAction Input: {\"case_id\": \"moderate\"}")
    assert isinstance(out, AgentAction) and out.tool == "cualign__load_case"
