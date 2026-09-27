"""Request-local state shared by NAT tasks through ContextVar inheritance."""
from contextvars import ContextVar
from dataclasses import dataclass, field
from cualign.core.constraints import Constraints


@dataclass
class PlanRun:
    request_id: str
    case_id: str
    base_plan_id: str | None
    constraints: Constraints
    plan_ids: set[str] = field(default_factory=set)
    target_ids: set[str] = field(default_factory=set)
    selected_plan_id: str | None = None
    compared: bool = False  # compare_strategies ran, so the answer describes several plans (rails_middleware, #91)
    review_attempts: int = 0
    review_started: float | None = None
    review_busy: bool = False
    closed: bool = False
    rails: str | None = None  # passed | flagged | blocked | error | off, set by the rails middleware
    refused: bool = False  # the rails middleware replaced the answer with its refusal
    error: dict | None = None  # {"kind": "nim_overload" | "workflow_error", "message": ...} when the workflow raised


CURRENT_RUN: ContextVar[PlanRun | None] = ContextVar("cualign_plan_run", default=None)
