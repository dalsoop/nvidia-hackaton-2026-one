"""Keep executed native calls visible in NAT 1.9's text scratchpad.

NAT stores a native call's name/arguments in AgentAction, but builds the next
prompt from only its log and the tool result. When the model emits reasoning,
that log can say only "first I need to call X". Even the empty-reasoning fallback
omits the arguments. Append the actual action to newly created log entries so
the next model call sees what produced each observation.

The model may copy that format into its own text (seen live, 2026-09-25), and a
text-parsed action's log already holds its Action lines. So the record is added
only when the log does not already name the same tool with an equal input
(compared as JSON, so spacing, line breaks and trailing text do not matter). When the text names a
different input than the call NAT executed, the executed one is appended last.

This retains NAT's existing AI/Human text history, parsing and retry behavior;
it does not suppress repeated calls or claim that a requested tool succeeded.
Only the action NAT chose to execute is recorded, not other proposed calls.
"""
from __future__ import annotations

import json
import re
from functools import wraps

from nat.plugins.langchain.agent.react_agent.agent import ReActAgentGraph

_ACTION = re.compile(r"^[ \t]*Action[ \t]*:[ \t]*(?P<tool>[^\n]+?)[ \t]*\n[ \t]*Action[ \t]*Input[ \t]*:(?P<input>.*?)"
                     r"(?=^[ \t]*(?:Thought|Action|Observation|Final[ \t]*Answer)[ \t]*:|\Z)",
                     re.IGNORECASE | re.MULTILINE | re.DOTALL)
_DECODER = json.JSONDecoder()


def _as_value(text):
    """The input as a comparable value. JSON is parsed from its start, so an object over several lines or followed
    by other text still compares by value; anything else compares as its first line, stripped."""
    if not isinstance(text, str):
        return text
    body = text.strip()
    try:
        return _DECODER.raw_decode(body)[0]
    except ValueError:
        return body.splitlines()[0].strip() if body else ""


def already_recorded(log: str, tool: str, tool_input) -> bool:
    """True when the log already has an Action/Action Input pair for this tool and an equal input."""
    wanted = _as_value(tool_input)
    return any(m.group("tool").strip() == tool and _as_value(m.group("input")) == wanted
               for m in _ACTION.finditer(log or ""))


def apply() -> None:
    original = ReActAgentGraph.agent_node
    if getattr(original, "_cualign_history_patched", False):
        return

    @wraps(original)
    async def agent_node(self, state, config=None):
        previous = len(state.agent_scratchpad)
        result = await original(self, state, config=config)
        if self.use_native_tool_calling and result is not None:
            for action in result.agent_scratchpad[previous:]:
                if already_recorded(action.log, action.tool, action.tool_input):
                    continue
                arguments = action.tool_input
                if isinstance(arguments, dict):
                    arguments = json.dumps(arguments)
                action.log = f"{action.log.rstrip()}\nAction: {action.tool}\nAction Input: {arguments}"
        return result

    agent_node._cualign_history_patched = True
    ReActAgentGraph.agent_node = agent_node
