"""Evaluation run data schema and serialization."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
import json
from pathlib import Path
import re
from typing import Any, Dict, List, Optional

# Matches YYMMDDHHMMSS (12 digits) or YYYYMMDDHHMMSS (14 digits)
RUN_ID_REGEX = re.compile(r"^(\d{12}|\d{14})$")


@dataclass
class MetricRecord:
    """Quantitative metric record for Phase 1/Phase 2 goals."""

    goal_id: str  # e.g., "P1-1", "P1-2"
    name: str  # e.g., "핵심 시나리오 완주"
    value: Optional[float]  # normalized numeric value (e.g. 0.60), or None if not measured
    raw: str  # e.g., "3/5", "28.6% (2/7)", "0건", "65.8s"
    target: str  # target threshold (e.g. "100%", "0", "미정")
    status: str  # "passed", "failed", "warning", "pending", "untracked"
    n: int  # sample count
    unit: str = ""  # unit if applicable (%, s, count)
    notes: str = ""  # details or failure notes

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> MetricRecord:
        return cls(**data)


@dataclass
class RunMetadata:
    """Metadata describing the evaluation run context."""

    run_id: str  # YYMMDDHHMMSS
    created_at: str  # ISO 8601
    git_commit: str  # short or full git sha
    git_branch: str
    model: str  # model id (e.g. nvidia/llama-3.1-nemotron-70b-instruct)
    baseline_run_id: Optional[str] = None
    environment: Dict[str, str] = field(default_factory=dict)
    description: str = ""


@dataclass
class EvaluationRun:
    """Full evaluation run record."""

    metadata: RunMetadata
    metrics: Dict[str, MetricRecord] = field(default_factory=dict)
    scenario_results: List[Dict[str, Any]] = field(default_factory=list)
    failed_cases: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metadata": asdict(self.metadata),
            "metrics": {k: v.to_dict() for k, v in self.metrics.items()},
            "scenario_results": self.scenario_results,
            "failed_cases": self.failed_cases,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> EvaluationRun:
        metadata = RunMetadata(**data["metadata"])
        metrics = {k: MetricRecord.from_dict(v) for k, v in data.get("metrics", {}).items()}
        return cls(
            metadata=metadata,
            metrics=metrics,
            scenario_results=data.get("scenario_results", []),
            failed_cases=data.get("failed_cases", []),
        )

    def save(self, run_dir: Path) -> None:
        """Save evaluation run files into run_dir."""
        run_dir.mkdir(parents=True, exist_ok=True)
        metrics_file = run_dir / "metrics.json"
        with open(metrics_file, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)

    @classmethod
    def load(cls, run_dir: Path) -> EvaluationRun:
        """Load evaluation run from directory."""
        metrics_file = run_dir / "metrics.json"
        if not metrics_file.exists():
            raise FileNotFoundError(f"metrics.json not found in {run_dir}")
        with open(metrics_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)


def validate_run_id(run_id: str) -> bool:
    """Validate that run_id follows yymmddhhmmss format."""
    return bool(RUN_ID_REGEX.match(run_id))


def generate_run_id(dt: Optional[datetime] = None) -> str:
    """Generate 12-digit yymmddhhmmss run_id."""
    if dt is None:
        dt = datetime.now()
    return dt.strftime("%y%m%d%H%M%S")
