"""Normalized agent trace: what the judge reads, whatever produced it (live NAT run, cached log, reference agent).

Tool names drop the NAT prefix (`cualign__validate` -> `validate`). Calls made by the reviewer sub-agent carry
agent="reviewer"; the planner's call of the reviewer itself is name="reviewer" with args {"plan_id": ...}.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ToolCall:
    name: str
    args: dict = field(default_factory=dict)
    result: Any = None
    error: str | None = None
    agent: str = "planner"

    @property
    def ok(self) -> bool:
        return self.error is None and self.result not in (None, "")


@dataclass
class Turn:
    user: str
    calls: list[ToolCall] = field(default_factory=list)
    answer: str = ""
    errors: list[str] = field(default_factory=list)
    parse_retries: int = 0


@dataclass
class Trace:
    spec_id: str | None
    agent: str
    turns: list[Turn] = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Trace":
        turns = [Turn(**{**t, "calls": [ToolCall(**c) for c in t.get("calls", [])]}) for t in d.get("turns", [])]
        return cls(spec_id=d.get("spec_id"), agent=d.get("agent", "?"), turns=turns, meta=d.get("meta", {}))

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "Trace":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


def normalize_tool_name(raw: str) -> tuple[str, str]:
    """`cualign__validate` -> ("validate", "planner"); `cualign_ro__get_plan` -> ("get_plan", "reviewer")."""
    if raw.startswith("cualign_ro__"):
        return raw[len("cualign_ro__"):], "reviewer"
    if raw.startswith("cualign__"):
        return raw[len("cualign__"):], "planner"
    return raw, "planner"


# A turn that crashed is recorded as "<ExceptionType>: <message>" (runner.run_spec). The NVIDIA API's overload reaches
# it as NIMStreamError (nim_stream_patch: 7 streamed requests over ~63 s all overloaded) or as "[503] ..." / "[429] ..."
# from a call that is not streamed. Tool retries logged by NAT ("retry ...", "Tool call failed ...") are not crashes:
# a reviewer that failed on a 503 and said so is agent behaviour and is scored (G-review-fail-visible).
_CRASH = re.compile(r"^(?:[A-Za-z_][\w.]*)?(?:Error|Exception)\b: ")
_OVERLOAD = re.compile(r"NIMStreamError|\[(?:429|503)\]|\b(?:429|503)\b|overloaded|Too Many Requests|"
                       r"Service Unavailable|RateLimit", re.I)


def is_overload_crash(error: str) -> bool:
    """True for a crashed-turn record whose cause is the NVIDIA API being overloaded (#51)."""
    return bool(_CRASH.match(error) and _OVERLOAD.search(error))


def unscorable_reason(trace: Trace) -> str | None:
    """Why the run says nothing about the agent, or None. Such a run is "판정 불가": not a pass, not a failure."""
    if trace.meta.get("unscorable"):
        return str(trace.meta["unscorable"])
    for n, t in enumerate(trace.turns):
        for e in t.errors:
            if is_overload_crash(e):
                return f"turn {n}: {e[:200]}"
    return None
