"""Workaround for NAT react_agent (1.9): a JSON-wrapped ReAct block leaks as the final answer.

Observed with nemotron-3-super-120b in native tool-calling mode (docs/demo, 2026-09-23): after one empty
response NAT retries with a ReAct-format observation, the model then emits

    {"Thought": "...", "Action": "cualign__clinical_limits", "Action Input": {"unused": ""}}

as plain text. ReActOutputParser raises missing_action, and agent.py accepts any content that does not
*start* with "Thought:" as a direct final answer — so the user sees raw JSON and the loop stops.

This wraps the parser: if the text fails ReAct parsing but is a JSON object with an "Action" key, it is
turned into an AgentAction (the loop continues); a "Final Answer" key becomes AgentFinish. Anything else
re-raises so NAT's own retry logic is unchanged. Applied once at plugin import (register.py).

Second leak, streaming only (/chat/stream, 2026-09-26 sandbox capture): NAT's react_agent `_stream_fn` buffers the
text of EVERY agent LLM call and, with no "Final Answer:" marker, yields the whole buffer. In native tool-calling
mode the model writes reasoning ("We have a plan that passed... Action: cualign__select_plan") before its tool
calls, so that reasoning was prepended to the Korean answer. The non-streaming path returns only the last message.
`build_graph` is wrapped so the graph's message stream passes on only the agent's last LLM call, which is the one
that ended the loop, matching the non-streaming answer.
"""
from __future__ import annotations

import json
import re

from typing import Any

from langchain_core.agents import AgentAction, AgentFinish
from langchain_core.messages import AIMessageChunk

from nat.plugins.langchain.agent.react_agent import agent as _agent
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


def _call_key(msg: AIMessageChunk, metadata: dict) -> Any:
    """Chunks of one LLM call share an id; without one, fall back to the graph step."""
    return msg.id or (metadata.get("langgraph_step"), metadata.get("langgraph_checkpoint_ns"))


async def last_agent_call_only(stream):
    """Filter a `stream_mode="messages"` stream: agent-node LLM chunks are held per call and only the last call's
    chunks are passed on at the end. Everything else passes through at once."""
    key, held = object(), []
    async for item in stream:
        msg, metadata = item if isinstance(item, tuple) and len(item) == 2 else (None, None)
        if not (isinstance(msg, AIMessageChunk) and isinstance(metadata, dict)
                and metadata.get("langgraph_node") == "agent"):
            yield item
            continue
        k = _call_key(msg, metadata)
        if k != key:
            key, held = k, []
        held.append(item)
    for item in held:
        yield item


class _LastCallGraph:
    """Delegates to the compiled graph; only `astream(..., stream_mode="messages")` is filtered."""

    def __init__(self, graph):
        self._graph = graph

    def __getattr__(self, name):
        return getattr(self._graph, name)

    def astream(self, *args, **kwargs):
        stream = self._graph.astream(*args, **kwargs)
        return last_agent_call_only(stream) if kwargs.get("stream_mode") == "messages" else stream


def apply() -> None:
    graph_cls = _agent.ReActAgentGraph
    if not getattr(graph_cls, "_cualign_patched", False):
        build = graph_cls.build_graph

        async def build_graph(self):
            return _LastCallGraph(await build(self))

        graph_cls.build_graph = build_graph
        graph_cls._cualign_patched = True
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
