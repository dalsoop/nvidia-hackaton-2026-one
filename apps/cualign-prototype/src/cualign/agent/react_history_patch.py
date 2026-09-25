"""Keep executed native calls visible in NAT 1.9's text scratchpad.

NAT stores a native call's name/arguments in AgentAction, but builds the next
prompt from only its log and the tool result. When the model emits reasoning,
that log can say only "first I need to call X". Even the empty-reasoning fallback
omits the arguments. Append the actual action to newly created log entries so
the next model call sees what produced each observation.

This retains NAT's existing AI/Human text history, parsing and retry behavior;
it does not suppress repeated calls or claim that a requested tool succeeded.
Only the action NAT chose to execute is recorded, not other proposed calls.
"""
from __future__ import annotations

import json
from functools import wraps

from nat.plugins.langchain.agent.react_agent.agent import ReActAgentGraph


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
                arguments = action.tool_input
                if isinstance(arguments, dict):
                    arguments = json.dumps(arguments)
                record = f"Action: {action.tool}\nAction Input: {arguments}"
                if not action.log.rstrip().endswith(record):
                    action.log = f"{action.log.rstrip()}\n{record}"
        return result

    agent_node._cualign_history_patched = True
    ReActAgentGraph.agent_node = agent_node
