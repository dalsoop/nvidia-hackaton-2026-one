"""Production ReAct candidate agent.

Wraps the actual NeMo Agent Toolkit (NAT) ReAct workflow defined in
configs/workflow.yml connecting to NVIDIA NIM (Nemotron).
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import sys
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
        self.reset()

    def reset(self) -> None:
        super().reset()
        self.context_id = None

    def _execute_turn(self, user_message: str) -> AgentTurn:
        base_dir = Path(__file__).resolve().parent.parent.parent
        config_path = base_dir / self.workflow_config

        # Check if API key is present
        api_key = os.environ.get("NVIDIA_API_KEY", "")
        if not api_key.startswith("nvapi-"):
            return AgentTurn(
                user_message=user_message,
                answer="프로덕션 ReAct 에이전트 실행 대기 (NVIDIA_API_KEY 설정 필요)",
                metadata={"workflow_config": self.workflow_config, "status": "key_missing"},
            )

        cmd = [
            sys.executable,
            "-m",
            "nat.cli.main",
            "run",
            "--config_file",
            str(config_path),
            "--input",
            user_message,
        ]

        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            cwd=base_dir,
        )

        raw = (p.stdout or "") + "\n" + (p.stderr or "")
        # Mask any keys in memory
        raw = re.sub(r"nvapi-[A-Za-z0-9_\-]+", "nvapi-***", raw)

        # Extract tool calls
        tool_names = re.findall(r"cualign__([a-z_]+)", raw)
        tool_calls = [ToolCallRecord(name=tn, args={}) for tn in tool_names]

        # Extract final answer
        answer = ""
        if "Workflow Result:" in raw:
            answer = raw.split("Workflow Result:")[-1].strip()[:2000]
        else:
            answer = raw.strip()[-500:]

        # Extract plan_id if present
        pid_match = re.search(r"plan_id\s*[:：]?\s*(p[0-9a-fA-F]+)", answer)
        plan_id = pid_match.group(1) if pid_match else None

        return AgentTurn(
            user_message=user_message,
            answer=answer,
            plan_id=plan_id,
            tool_calls=tool_calls,
            metadata={"exit_code": p.returncode},
        )
