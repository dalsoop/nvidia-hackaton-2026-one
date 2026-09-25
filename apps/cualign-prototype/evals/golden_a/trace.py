"""Normalized agent trace: what the judge reads, whatever produced it (live NAT run, cached log, reference agent).

Tool names drop the NAT prefix (`cualign__validate` -> `validate`). Calls made by the reviewer sub-agent carry
agent="reviewer"; the planner's call of the reviewer itself is name="reviewer" with args {"plan_id": ...}.
"""
from __future__ import annotations

import json
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
