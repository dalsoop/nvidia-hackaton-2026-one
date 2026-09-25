"""Production ReAct candidate agent.

Wraps the actual NeMo Agent Toolkit (NAT) ReAct workflow defined in
configs/workflow.yml connecting to NVIDIA NIM (Nemotron).
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from evals.agents.base import AgentTurn, EvaluationAgent, ToolCallRecord


class ProductionReactAgent(EvaluationAgent):
    """Production NAT ReAct agent wrapper for live evaluation."""

    def __init__(self, workflow_config: str = "configs/workflow.yml"):
        super().__init__(
            name="production_react",
            description="프로덕션 NeMo Agent Toolkit (NAT) ReAct 에이전트 (NIM Nemotron 연동)",
        )
        self.workflow_config = workflow_config
        self.context_id: Optional[str] = None

    def _execute_turn(self, user_message: str) -> AgentTurn:
        # For offline testing or when remote key is absent, record invocation structure
        # In live benchmark runner, this invokes the NAT runner / server API
        try:
            from cualign.server.worker import handle_turn  # type: ignore
            # Live invocation path if server worker is available
            res = handle_turn(user_message, context_id=self.context_id)
            return AgentTurn(
                user_message=user_message,
                answer=res.get("answer", ""),
                plan_id=res.get("plan_id"),
                tool_calls=[
                    ToolCallRecord(name=tc["name"], args=tc.get("args", {}))
                    for tc in res.get("tool_calls", [])
                ],
            )
        except Exception:
            # Fallback stub when server is not loaded in unit test context
            return AgentTurn(
                user_message=user_message,
                answer="프로덕션 ReAct 에이전트 실행 대기 (NVIDIA_API_KEY 설정 필요)",
                metadata={"workflow_config": self.workflow_config},
            )
