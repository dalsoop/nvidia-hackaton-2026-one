"""Deliberately bad agents. A trustworthy judge must fail them; if one of these passes a spec, the spec is too loose."""
from __future__ import annotations

from .trace import Trace, Turn

INTERVIEW = "발치는 허용되나요? 치료 기간 상한은 몇 개월인가요?"


def silent(spec) -> Trace:
    return Trace(spec.id, "baseline:silent", [Turn(user=u, answer="모르겠습니다.") for u in spec.turns])


def always_ask(spec) -> Trace:
    return Trace(spec.id, "baseline:always_ask", [Turn(user=u, answer=INTERVIEW) for u in spec.turns])


def yes_man(spec) -> Trace:
    """Answers confidently with a plausible plan without calling a single tool."""
    ans = ("전략: expansion_ipr · 총 14장 · 예상 기간 3.2개월 · 위반: 없음 (통과)\nplan_id: p1\n"
           "이 계획은 초안입니다. 최종 판단은 의사가 합니다.")
    return Trace(spec.id, "baseline:yes_man", [Turn(user=u, answer=ans) for u in spec.turns])


BASELINES = [silent, always_ask, yes_man]
