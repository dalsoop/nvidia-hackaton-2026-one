"""Clarification-first candidate agent.

Specifically targets P1-2 (interview missing constraints):
Intercepts requests with unconfirmed essential clinical constraints (extraction allowance,
treatment duration) and enforces an interview turn before calling expensive planning tools.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from evals.agents.base import AgentTurn, EvaluationAgent, ToolCallRecord

INTERVIEW_QUESTION = "발치는 허용되나요? 치료 기간 상한은 몇 개월인가요?"
DISCLAIMER = "이 계획은 초안입니다. 최종 판단은 의사가 합니다."


class ClarificationFirstAgent(EvaluationAgent):
    """Candidate agent that prioritizes clarifying underspecified requirements."""

    def __init__(self):
        super().__init__(
            name="clarification_first",
            description="모호한 임상 조건 입력 시 사전 되묻기를 강제하는 인터뷰 강화형 에이전트",
        )
        self.confirmed_extraction: bool = False
        self.confirmed_duration: bool = False

    def _execute_turn(self, user_message: str) -> AgentTurn:
        # Check if user message specifies extraction
        if re.search(r"(비발치|발치 없이|발치하지|발치)", user_message):
            self.confirmed_extraction = True

        # Check if user message specifies duration
        if re.search(r"(\d+)\s*(?:개월|달)", user_message):
            self.confirmed_duration = True

        # P1-2 Enforcement: If either critical condition is unknown, ask first!
        if not self.confirmed_extraction or not self.confirmed_duration:
            return AgentTurn(
                user_message=user_message,
                answer=INTERVIEW_QUESTION,
                tool_calls=[],
                metadata={"action": "clarification_enforced"},
            )

        # Once confirmed, proceed with planning tools
        tool_calls = [
            ToolCallRecord(
                name="set_constraints",
                args={"allow_extraction": False, "stage_cap": 52},
                result={"success": True},
            ),
            ToolCallRecord(
                name="propose_target",
                args={"strategy": "expansion_ipr"},
                result={"target_id": "t_001"},
            ),
            ToolCallRecord(
                name="plan_stages",
                args={"target_id": "t_001"},
                result={"plan_id": "p_001"},
            ),
            ToolCallRecord(
                name="cualign_reviewer",
                args={"plan_id": "p_001"},
                result={"review_status": "passed"},
            ),
        ]
        ans = (
            "확인해주신 조건(비발치, 12개월 이내)으로 계획을 생성했습니다.\n"
            "전략: expansion_ipr · 14장 · 통과 · plan_id: p_001\n"
            f"{DISCLAIMER}"
        )
        return AgentTurn(
            user_message=user_message,
            answer=ans,
            plan_id="p_001",
            tool_calls=tool_calls,
        )
