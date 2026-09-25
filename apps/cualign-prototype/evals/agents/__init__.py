"""Candidate agents under evaluation across multiple dimensions."""

from evals.agents.base import AgentTurn, EvaluationAgent
from evals.agents.baselines import AlwaysAskAgent, SilentAgent, YesManAgent
from evals.agents.clarification_first import ClarificationFirstAgent
from evals.agents.loop_guarded import LoopGuardedAgent
from evals.agents.production_react import ProductionReactAgent
from evals.agents.reference_rule import ReferenceRuleAgent

AVAILABLE_AGENTS = {
    "production_react": ProductionReactAgent,
    "reference_rule": ReferenceRuleAgent,
    "clarification_first": ClarificationFirstAgent,
    "loop_guarded": LoopGuardedAgent,
    "baseline_silent": SilentAgent,
    "baseline_always_ask": AlwaysAskAgent,
    "baseline_yes_man": YesManAgent,
}

__all__ = [
    "EvaluationAgent",
    "AgentTurn",
    "ProductionReactAgent",
    "ReferenceRuleAgent",
    "ClarificationFirstAgent",
    "LoopGuardedAgent",
    "SilentAgent",
    "AlwaysAskAgent",
    "YesManAgent",
    "AVAILABLE_AGENTS",
]
