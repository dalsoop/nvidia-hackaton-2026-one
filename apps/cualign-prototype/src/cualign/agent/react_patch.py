"""Workaround for NAT react_agent (1.9): a JSON-wrapped ReAct block leaks as the final answer.

Observed with nemotron-3-super-120b in native tool-calling mode (docs/demo, 2026-09-23): after one empty
response NAT retries with a ReAct-format observation, the model then emits

    {"Thought": "...", "Action": "cualign__clinical_limits", "Action Input": {"unused": ""}}

as plain text. ReActOutputParser raises missing_action, and agent.py accepts any content that does not
*start* with "Thought:" as a direct final answer — so the user sees raw JSON and the loop stops.

This wraps the parser: if the text fails ReAct parsing but is a JSON object with an "Action" key, it is
turned into an AgentAction (the loop continues); a "Final Answer" key becomes AgentFinish. Anything else
re-raises so NAT's own retry logic is unchanged. Applied once at plugin import (register.py).
"""
from __future__ import annotations

import json
import re

from langchain_core.agents import AgentAction, AgentFinish

from nat.plugins.langchain.agent.react_agent import output_parser as _op

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def json_react_to_agent_output(text: str) -> AgentAction | AgentFinish | None:
    """Return an AgentAction/AgentFinish if `text` is a JSON-wrapped ReAct block, else None."""
    body = _FENCE.sub("", text or "")
    if not body.lstrip().startswith("{"):
        return None
    try:
        obj = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    keys = {k.strip().lower(): k for k in obj}
    if "action" in keys:
        tool = str(obj[keys["action"]]).strip()
        raw_input = obj.get(keys.get("action input", ""), obj.get(keys.get("action_input", ""), ""))
        tool_input = json.dumps(raw_input) if isinstance(raw_input, (dict, list)) else str(raw_input)
        return AgentAction(tool=tool, tool_input=tool_input, log=text)
    if "final answer" in keys or "final_answer" in keys:
        ans = obj[keys.get("final answer", keys.get("final_answer"))]
        return AgentFinish(return_values={"output": str(ans)}, log=text)
    return None


def apply() -> None:
    parser_cls = _op.ReActOutputParser
    if getattr(parser_cls, "_cualign_patched", False):
        return
    original = parser_cls.parse

    def parse(self, text: str):
        try:
            return original(self, text)
        except _op.ReActOutputParserException:
            converted = json_react_to_agent_output(text)
            if converted is not None:
                return converted
            raise

    parser_cls.parse = parse
    parser_cls._cualign_patched = True
