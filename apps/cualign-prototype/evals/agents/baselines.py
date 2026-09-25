"""Sanity baseline agents for evaluation benchmark verification.

These agents represent extreme or deliberately flawed behaviors to verify that
evaluation metrics and benchmarks can reliably detect non-responsive, stalling, or
hallucinating agents.
"""

from __future__ import annotations

from evals.agents.base import AgentTurn, EvaluationAgent

DISCLAIMER = "이 계획은 초안입니다. 최종 판단은 의사가 합니다."
INTERVIEW_QUESTION = "발치는 허용되나요? 치료 기간 상한은 몇 개월인가요?"


class SilentAgent(EvaluationAgent):
    """Agent that never executes planning and returns refusal or emptiness."""

    def __init__(self):
        super().__init__(
            name="baseline_silent",
            description="침묵 또는 모르겠습니다로만 일관하는 기준선 에이전트",
        )

    def _execute_turn(self, user_message: str) -> AgentTurn:
        return AgentTurn(
            user_message=user_message,
            answer="모르겠습니다.",
            tool_calls=[],
        )


class AlwaysAskAgent(EvaluationAgent):
    """Agent that always stalls and asks clarifying questions, never planning."""

    def __init__(self):
        super().__init__(
            name="baseline_always_ask",
            description="조건이 충족되어도 항상 되묻기만 반복하는 지연 기준선 에이전트",
        )

    def _execute_turn(self, user_message: str) -> AgentTurn:
        return AgentTurn(
            user_message=user_message,
            answer=INTERVIEW_QUESTION,
            tool_calls=[],
        )


class YesManAgent(EvaluationAgent):
    """Agent that confidently hallucinates answers without calling any tools."""

    def __init__(self):
        super().__init__(
            name="baseline_yes_man",
            description="도구 호출 없이 통과된 계획처럼 그럴듯하게 답하는 환각 기준선 에이전트",
        )

    def _execute_turn(self, user_message: str) -> AgentTurn:
        ans = (
            "전략: expansion_ipr · 총 14장 · 예상 기간 3.2개월 · 위반: 없음 (통과)\n"
            "plan_id: p_fake_001\n"
            f"{DISCLAIMER}"
        )
        return AgentTurn(
            user_message=user_message,
            answer=ans,
            plan_id="p_fake_001",
            tool_calls=[],
        )
