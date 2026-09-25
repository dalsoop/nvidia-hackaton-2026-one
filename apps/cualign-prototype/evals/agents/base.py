"""Base interface for candidate evaluation agents."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import time
from typing import Any, Dict, List, Optional


@dataclass
class ToolCallRecord:
    name: str
    args: Dict[str, Any]
    result: Optional[Any] = None
    duration_seconds: float = 0.0


@dataclass
class AgentTurn:
    """Standardized record of a single turn execution by an agent."""

    user_message: str
    answer: str
    tool_calls: List[ToolCallRecord] = field(default_factory=list)
    plan_id: Optional[str] = None
    duration_seconds: float = 0.0
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class EvaluationAgent(ABC):
    """Abstract base class for all candidate agents evaluated across benchmarks."""

    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
        self.history: List[AgentTurn] = []

    def reset(self) -> None:
        """Reset conversation state and history."""
        self.history.clear()

    def run_turn(self, user_message: str) -> AgentTurn:
        """Execute a turn with timing."""
        start = time.time()
        try:
            turn = self._execute_turn(user_message)
        except Exception as e:
            turn = AgentTurn(
                user_message=user_message,
                answer="",
                error=f"{type(e).__name__}: {str(e)}",
            )
        turn.duration_seconds = time.time() - start
        self.history.append(turn)
        return turn

    @abstractmethod
    def _execute_turn(self, user_message: str) -> AgentTurn:
        """Subclass implementation of single turn execution."""
        raise NotImplementedError
