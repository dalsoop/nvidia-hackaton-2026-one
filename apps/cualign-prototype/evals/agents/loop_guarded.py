"""Loop-guarded candidate agent.

Specifically targets P1-4 (preventing tool loop iteration exhaustion):
Maintains a rolling call history of (tool_name, tool_args). If the agent attempts
to invoke the exact same tool with identical arguments repeatedly, it intercepts
the call and injects a state reminder, preventing infinite loops and recursion crashes.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from evals.agents.base import AgentTurn, EvaluationAgent, ToolCallRecord

DISCLAIMER = "이 계획은 초안입니다. 최종 판단은 의사가 합니다."


class LoopGuardedAgent(EvaluationAgent):
    """Candidate agent equipped with repetition detector to avoid P1-4 looping."""

    def __init__(self, max_consecutive_duplicates: int = 2):
        super().__init__(
            name="loop_guarded",
            description="동일 도구 중복 호출 루프를 감지하고 차단하는 루프 방어형 에이전트",
        )
        self.max_consecutive_duplicates = max_consecutive_duplicates
        self.call_history: List[Tuple[str, str]] = []

    def reset(self) -> None:
        super().reset()
        self.call_history.clear()

    def check_and_record_tool(self, name: str, args: Dict[str, Any]) -> bool:
        """Return False if duplicate threshold is exceeded."""
        key = (name, json.dumps(args, sort_keys=True))
        duplicates = sum(1 for prev in self.call_history[-self.max_consecutive_duplicates :] if prev == key)
        if duplicates >= self.max_consecutive_duplicates:
            return False
        self.call_history.append(key)
        return True

    def _execute_turn(self, user_message: str) -> AgentTurn:
        tool_calls: List[ToolCallRecord] = []

        # Example flow executing set_constraints followed by planning
        args = {"allow_extraction": False, "lock": [13]}
        if self.check_and_record_tool("set_constraints", args):
            tool_calls.append(ToolCallRecord(name="set_constraints", args=args, result={"success": True}))
        else:
            # Intercept duplicate call
            return AgentTurn(
                user_message=user_message,
                answer="이미 동일한 제약조건이 설정되었습니다. 중복 호출을 건너뛰고 계획 수립을 계속합니다.",
                tool_calls=tool_calls,
                metadata={"loop_detected": True},
            )

        tool_calls.append(
            ToolCallRecord(
                name="propose_target",
                args={"strategy": "expansion_ipr"},
                result={"target_id": "t_001"},
            )
        )
        tool_calls.append(
            ToolCallRecord(
                name="plan_stages",
                args={"target_id": "t_001"},
                result={"plan_id": "p_001"},
            )
        )

        ans = f"수정 조건(13번 고정)이 반영된 계획입니다: plan_id p_001\n{DISCLAIMER}"
        return AgentTurn(
            user_message=user_message,
            answer=ans,
            plan_id="p_001",
            tool_calls=tool_calls,
        )
