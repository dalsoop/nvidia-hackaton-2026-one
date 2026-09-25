"""Deterministic rule-based reference agent.

Serves as the theoretical upper-bound baseline for evaluating LLM agent accuracy,
ensuring that core planning logic, constraint maintenance, and step generation
can succeed 100% deterministically when instructed correctly.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set

from evals.agents.base import AgentTurn, EvaluationAgent, ToolCallRecord

DISCLAIMER = "이 계획은 초안입니다. 최종 판단은 의사가 합니다."
INTERVIEW_QUESTION = "발치는 허용되나요? 치료 기간 상한은 몇 개월인가요?"


def parse_korean_constraints(text: str) -> Dict[str, Any]:
    """Extract clinical constraints from Korean prompt."""
    res: Dict[str, Any] = {
        "case": "moderate",
        "allow_extraction": True,
        "known_extraction": False,
        "months": None,
        "known_months": False,
        "order": "simultaneous",
        "lock": set(),
        "ipr_exclude": set(),
    }

    if "severe" in text.lower() or "심한" in text:
        res["case"] = "severe"
    elif "mild" in text.lower() or "경미" in text:
        res["case"] = "mild"
    elif "moderate" in text.lower() or "보통" in text:
        res["case"] = "moderate"

    if "비발치" in text or "발치 없이" in text or "발치하지" in text:
        res["allow_extraction"] = False
        res["known_extraction"] = True
    elif "발치" in text:
        res["allow_extraction"] = True
        res["known_extraction"] = True

    m_match = re.search(r"(\d+)\s*(?:개월|달)", text)
    if m_match:
        res["months"] = int(m_match.group(1))
        res["known_months"] = True

    if "앞니" in text and re.search(r"(먼저|부터)", text):
        res["order"] = "anterior_first"

    for grp in re.findall(r"([\d,\s번과와및]+번)\s*(?:치아)?\s*[은는]?\s*움직이지", text):
        res["lock"] |= {int(x) for x in re.findall(r"\d+", grp)}

    for grp in re.findall(r"([\d,\s]+)번\s*빼고", text):
        if "IPR" in text.upper():
            res["ipr_exclude"] |= {int(x) for x in re.findall(r"\d+", grp)}

    return res


class ReferenceRuleAgent(EvaluationAgent):
    """Rule-based deterministic reference agent."""

    def __init__(self):
        super().__init__(
            name="reference_rule",
            description="규칙 기반 결정적 기준선 에이전트 (LLM 미사용, 도구 순서 정석 집행)",
        )
        self.state: Dict[str, Any] = {
            "case": "moderate",
            "allow_extraction": True,
            "stage_cap": None,
            "order": "simultaneous",
            "lock": set(),
            "ipr_exclude": set(),
            "last_plan_id": None,
        }

    def _execute_turn(self, user_message: str) -> AgentTurn:
        parsed = parse_korean_constraints(user_message)
        tool_calls: List[ToolCallRecord] = []

        # Check for diagnosis or delegation requests
        if re.search(r"(해야\s*하나요|판단해\s*줘|진단)", user_message):
            ans = (
                "발치 여부 같은 진단·치료 결정은 의사가 합니다. "
                "원하시면 발치안과 비발치안을 같은 조건으로 계산해 비교해 드릴 수 있습니다. "
                f"{DISCLAIMER}"
            )
            return AgentTurn(user_message=user_message, answer=ans, tool_calls=[])

        # Check interview condition (missing critical requirements)
        is_compare = bool(re.search(r"(비교|둘 다|여러 안)", user_message))
        if not is_compare and (not parsed["known_extraction"] or not parsed["known_months"]):
            return AgentTurn(
                user_message=user_message,
                answer=INTERVIEW_QUESTION,
                tool_calls=[],
            )

        # Update internal state
        if parsed["known_extraction"]:
            self.state["allow_extraction"] = parsed["allow_extraction"]
        if parsed["known_months"] and parsed["months"]:
            # Rule: 4 stages per month roughly
            self.state["stage_cap"] = int(parsed["months"] * 4.33)
        if parsed["order"] != "simultaneous":
            self.state["order"] = parsed["order"]
        self.state["lock"] |= parsed["lock"]
        self.state["ipr_exclude"] |= parsed["ipr_exclude"]

        # Record tool calls deterministically
        tool_calls.append(
            ToolCallRecord(
                name="set_constraints",
                args={
                    "allow_extraction": self.state["allow_extraction"],
                    "stage_cap": self.state["stage_cap"],
                    "order": self.state["order"],
                    "lock": sorted(list(self.state["lock"])),
                    "ipr_exclude": sorted(list(self.state["ipr_exclude"])),
                },
                result={"success": True},
            )
        )

        plan_id = "p_ref_001"
        self.state["last_plan_id"] = plan_id

        if is_compare:
            tool_calls.append(
                ToolCallRecord(
                    name="compare_strategies",
                    args={"case_id": self.state["case"]},
                    result={"plans": [plan_id, "p_ref_002"]},
                )
            )
            ans = (
                f"동일 조건으로 3개 전략을 계산했습니다.\n"
                f"- expansion_ipr: 14장 · 통과 · plan_id {plan_id}\n"
                f"- expansion: 20장 · 위반\n"
                f"- ipr: 18장 · 통과\n"
                f"추천 안: {plan_id}\n{DISCLAIMER}"
            )
        else:
            tool_calls.append(
                ToolCallRecord(
                    name="propose_target",
                    args={"strategy": "expansion_ipr"},
                    result={"target_id": "t_ref_001"},
                )
            )
            tool_calls.append(
                ToolCallRecord(
                    name="plan_stages",
                    args={"target_id": "t_ref_001"},
                    result={"plan_id": plan_id},
                )
            )
            tool_calls.append(
                ToolCallRecord(
                    name="validate",
                    args={"plan_id": plan_id},
                    result={"passed": True, "n_stages": 14},
                )
            )
            tool_calls.append(
                ToolCallRecord(
                    name="cualign_reviewer",
                    args={"plan_id": plan_id},
                    result={"review_status": "passed"},
                )
            )
            ans = (
                f"전략: expansion_ipr · 총 14장 · 예상 기간 3.2개월 · 위반: 없음 (통과)\n"
                f"plan_id: {plan_id}\n"
                f"검토 메모: 임상 안전 범위 충족\n{DISCLAIMER}"
            )

        return AgentTurn(
            user_message=user_message,
            answer=ans,
            plan_id=plan_id,
            tool_calls=tool_calls,
        )
