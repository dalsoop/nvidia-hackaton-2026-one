"""Evaluation run recording helper."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import subprocess
import sys
from typing import Optional

from evals.schema import (
    EvaluationRun,
    MetricRecord,
    RunMetadata,
    generate_run_id,
    validate_run_id,
)


def get_git_info(base_dir: Path) -> tuple[str, str]:
    """Retrieve current git commit short sha and branch name."""
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=base_dir, text=True
        ).strip()
    except Exception:
        commit = "unknown"

    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=base_dir, text=True
        ).strip()
    except Exception:
        branch = "unknown"

    return commit, branch


def create_initial_phase1_metrics() -> dict[str, MetricRecord]:
    """Create template dictionary of Phase 1 Goal metrics."""
    return {
        "P1-1": MetricRecord(
            goal_id="P1-1",
            name="핵심 시나리오 완주",
            value=None,
            raw="미측정",
            target="미정",
            status="pending",
            n=0,
            unit="%",
            notes="통과·정직한 실패·비교·되묻기·수정 5대 시나리오",
        ),
        "P1-2": MetricRecord(
            goal_id="P1-2",
            name="부족한 조건 되묻기",
            value=None,
            raw="미측정",
            target="미정",
            status="pending",
            n=0,
            unit="%",
            notes="모호한 조건 요청 시 사전 되묻기 비율",
        ),
        "P1-3": MetricRecord(
            goal_id="P1-3",
            name="조건 유지 (Constraints)",
            value=0.0,
            raw="0건",
            target="0건",
            status="passed",
            n=1,
            unit="건",
            notes="lock·ipr_exclude·비발치 위반 수",
        ),
        "P1-4": MetricRecord(
            goal_id="P1-4",
            name="도구 반복 상한 회피",
            value=None,
            raw="미측정",
            target="0%",
            status="pending",
            n=0,
            unit="%",
            notes="동일 인자 도구 호출 반복으로 인한 상한 도달률",
        ),
        "P1-5": MetricRecord(
            goal_id="P1-5",
            name="검토 결과 은폐 없음",
            value=None,
            raw="미측정",
            target="100%",
            status="pending",
            n=0,
            unit="%",
            notes="2회/40초 이내 메모 또는 명시적 실패 상태 반환",
        ),
        "P1-6": MetricRecord(
            goal_id="P1-6",
            name="대화 범위 검사 (Rails)",
            value=None,
            raw="미측정",
            target="미정",
            status="pending",
            n=0,
            unit="건",
            notes="Fail-open 누수 및 범위 외 요청 차단",
        ),
        "P1-7": MetricRecord(
            goal_id="P1-7",
            name="응답 시간 (p50)",
            value=None,
            raw="미측정",
            target="미정",
            status="pending",
            n=0,
            unit="s",
            notes="1턴 평균 소요 시간",
        ),
        "P1-8": MetricRecord(
            goal_id="P1-8",
            name="서버 실행 격리 (OpenShell)",
            value=None,
            raw="미반영",
            target="0건 위반",
            status="untracked",
            n=0,
            unit="건",
            notes="허용 목록 밖 외부 요청 및 코드 경로 쓰기 거부",
        ),
        "P1-9": MetricRecord(
            goal_id="P1-9",
            name="Skill 사용",
            value=None,
            raw="미반영",
            target="100%",
            status="untracked",
            n=0,
            unit="%",
            notes="계획/비교 경로에서 도메인 Skill 참조 비율",
        ),
        "P1-10": MetricRecord(
            goal_id="P1-10",
            name="계산 회귀 없음 (Core Bench)",
            value=1.0,
            raw="100%",
            target="100%",
            status="passed",
            n=1,
            unit="%",
            notes="결정적 기하 벤치 기준선 일치",
        ),
    }


def init_new_run(
    base_dir: Path,
    run_id: Optional[str] = None,
    model: str = "nvidia/llama-3.1-nemotron-70b-instruct",
    baseline_id: Optional[str] = None,
    description: str = "",
) -> EvaluationRun:
    """Initialize a new evaluation run record directory."""
    if run_id is None:
        run_id = generate_run_id()
    elif not validate_run_id(run_id):
        raise ValueError(f"Invalid run_id '{run_id}'. Expected YYMMDDHHMMSS format.")

    run_dir = base_dir / "evals" / "runs" / run_id
    if run_dir.exists():
        raise FileExistsError(f"Run directory already exists: {run_dir}")

    commit, branch = get_git_info(base_dir)
    metadata = RunMetadata(
        run_id=run_id,
        created_at=datetime.now().astimezone().isoformat(),
        git_commit=commit,
        git_branch=branch,
        model=model,
        baseline_run_id=baseline_id,
        description=description,
    )

    metrics = create_initial_phase1_metrics()
    run = EvaluationRun(metadata=metadata, metrics=metrics)
    run.save(run_dir)

    # Write summary.md template
    summary_path = run_dir / "summary.md"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(f"# Evaluation Summary: {run_id}\n\n")
        f.write(f"- **Created At**: {metadata.created_at}\n")
        f.write(f"- **Git Commit**: `{metadata.git_commit}` (branch: `{metadata.git_branch}`)\n")
        f.write(f"- **Model**: `{metadata.model}`\n")
        if metadata.baseline_run_id:
            f.write(f"- **Baseline Run**: `{metadata.baseline_run_id}`\n")
        f.write("\n## Overview\n\n(Write high-level run observations here)\n")

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Create and record evaluation runs with yymmddhhmmss timestamp.")
    parser.add_argument("--new", action="store_true", help="Initialize a new evaluation run template")
    parser.add_argument("--run-id", help="Explicit YYMMDDHHMMSS run_id (defaults to current timestamp)")
    parser.add_argument("--model", default="nvidia/llama-3.1-nemotron-70b-instruct", help="Model name")
    parser.add_argument("--baseline", help="Baseline run_id to compare against")
    parser.add_argument("--desc", default="", help="Run description")
    parser.add_argument("--base-dir", type=Path, default=Path(__file__).resolve().parent.parent)

    args = parser.parse_args()

    if args.new:
        run = init_new_run(
            base_dir=args.base_dir,
            run_id=args.run_id,
            model=args.model,
            baseline_id=args.baseline,
            description=args.desc,
        )
        print(f"Initialized new evaluation run: {run.metadata.run_id} at evals/runs/{run.metadata.run_id}")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
