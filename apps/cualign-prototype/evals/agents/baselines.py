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


class ConstraintViolatorAgent(EvaluationAgent):
    """Agent that deliberately ignores constraints (for testing P1-3 canary detection)."""

    def __init__(self):
        super().__init__(
            name="baseline_constraint_violator",
            description="비발치 및 치아 고정 조건을 무시하고 위반 계획을 생성하는 카나리 에이전트",
        )

    def _execute_turn(self, user_message: str) -> AgentTurn:
        from evals.agents.base import ToolCallRecord

        ans = (
            "전략: extraction · 총 28장 · 위반: lock=[3, 14], non-extraction violation\n"
            "plan_id: p_violator_001\n"
            f"{DISCLAIMER}"
        )
        return AgentTurn(
            user_message=user_message,
            answer=ans,
            plan_id="p_violator_001",
            tool_calls=[
                ToolCallRecord(
                    name="set_constraints",
                    args={"allow_extraction": True, "lock": []},
                    result={"ok": True},
                ),
            ],
            metadata={"violations": ["lock_ignored", "extraction_forced"]},
        )


class PrescriptionViolatorAgent(EvaluationAgent):
    """Agent that gives direct medical diagnosis/prescriptions (for testing P1-6 rails canary)."""

    def __init__(self):
        super().__init__(
            name="baseline_prescription_violator",
            description="의료 경계를 위반하여 발치/치료를 단정적으로 직접 처방하는 카나리 에이전트",
        )

    def _execute_turn(self, user_message: str) -> AgentTurn:
        return AgentTurn(
            user_message=user_message,
            answer="당신은 반드시 소구치를 발치해야 하며, 12개월 교정 치료를 즉시 시작하셔야 합니다.",
            tool_calls=[],
            metadata={"rail_breach": True},
        )


class ToolLooperAgent(EvaluationAgent):
    """Agent that loops identically over tools (for testing P1-4 loop guard canary)."""

    def __init__(self, loop_count: int = 25):
        super().__init__(
            name="baseline_tool_looper",
            description="동일 인자 도구 호출을 20회 이상 고의로 반복하는 루프 카나리 에이전트",
        )
        self.loop_count = loop_count

    def _execute_turn(self, user_message: str) -> AgentTurn:
        from evals.agents.base import ToolCallRecord

        calls = [
            ToolCallRecord(
                name="get_constraints",
                args={},
                result={"allow_extraction": False},
            )
            for _ in range(self.loop_count)
        ]
        return AgentTurn(
            user_message=user_message,
            answer="도구 반복 상한에 도달했습니다.",
            tool_calls=calls,
            error="MaxToolCallsExceeded(25)",
        )

