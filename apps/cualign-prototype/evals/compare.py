"""Quantitative comparison tool between evaluation runs."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Tuple

from evals.schema import EvaluationRun, MetricRecord

# Higher is better for these metrics
HIGHER_IS_BETTER = {
    "P1-1",  # Scenario completion rate
    "P1-2",  # Clarification rate
    "P1-5",  # Review visible rate
    "P1-9",  # Skill usage rate
    "P1-10",  # Calculation regression rate (match rate)
}

# Lower is better for these metrics
LOWER_IS_BETTER = {
    "P1-3",  # Constraint violations (target: 0)
    "P1-4",  # Tool loop exhaustion rate (target: 0)
    "P1-6",  # Rails fail-open count (target: 0)
    "P1-7",  # Latency (target: lower)
    "P1-8",  # Sandbox write violations (target: 0)
}


def calculate_delta(
    goal_id: str,
    baseline_record: Optional[MetricRecord],
    current_record: Optional[MetricRecord],
) -> Tuple[Optional[float], str, str]:
    """Calculate numerical delta and semantic status.

    Returns:
        (delta_value, delta_display_str, indicator_symbol)
    """
    if baseline_record is None or current_record is None:
        return (None, "-", "⚪")

    v_base = baseline_record.value
    v_curr = current_record.value

    if v_base is None or v_curr is None:
        # Qualitative comparison
        if baseline_record.raw == current_record.raw:
            return (None, "동일", "⚪")
        return (None, f"{baseline_record.raw} → {current_record.raw}", "📝")

    delta = v_curr - v_base

    # Format delta string
    if current_record.unit == "%" or (0.0 <= v_curr <= 1.0 and current_record.unit == ""):
        delta_str = f"{delta * 100:+.1f}%p" if delta != 0 else "0.0%p"
    elif current_record.unit == "s":
        delta_str = f"{delta:+.1f}s" if delta != 0 else "0.0s"
    elif current_record.unit == "건" or isinstance(current_record.value, int):
        delta_str = f"{int(delta):+d}건" if delta != 0 else "0건"
    else:
        delta_str = f"{delta:+.2f}" if delta != 0 else "0.00"

    # Semantic evaluation
    if abs(delta) < 1e-6:
        indicator = "⚪ 동일"
    elif goal_id in HIGHER_IS_BETTER:
        indicator = "🟢 개선" if delta > 0 else "🔴 악화"
    elif goal_id in LOWER_IS_BETTER:
        indicator = "🟢 개선" if delta < 0 else "🔴 악화"
    else:
        indicator = "📝 변경"

    return (delta, delta_str, indicator)


def generate_markdown_comparison(
    baseline_run: EvaluationRun,
    current_run: EvaluationRun,
) -> str:
    """Generate a GitHub-flavored Markdown comparison table and analysis."""
    lines: List[str] = []
    lines.append(f"# Evaluation Comparison: {current_run.metadata.run_id} vs {baseline_run.metadata.run_id}")
    lines.append("")
    lines.append(f"- **Current Run**: `{current_run.metadata.run_id}` ({current_run.metadata.git_commit})")
    lines.append(f"- **Baseline Run**: `{baseline_run.metadata.run_id}` ({baseline_run.metadata.git_commit})")
    lines.append(f"- **Model**: `{current_run.metadata.model}`")
    lines.append("")
    lines.append("## 1. 정량 목표 비교표 (Phase 1 Goals)")
    lines.append("")
    lines.append("| Goal ID | 목표 항목 | 기준선 (Baseline) | 현재 실행 (Current) | 증감 (Delta) | 판정 | 비고 |")
    lines.append("| :--- | :--- | :---: | :---: | :---: | :---: | :--- |")

    all_goal_ids = sorted(
        set(list(baseline_run.metrics.keys()) + list(current_run.metrics.keys()))
    )

    for goal_id in all_goal_ids:
        b_rec = baseline_run.metrics.get(goal_id)
        c_rec = current_run.metrics.get(goal_id)

        name = c_rec.name if c_rec else (b_rec.name if b_rec else goal_id)
        b_raw = b_rec.raw if b_rec else "N/A"
        c_raw = c_rec.raw if c_rec else "N/A"
        notes = c_rec.notes if c_rec else ""

        _, delta_str, indicator = calculate_delta(goal_id, b_rec, c_rec)
        lines.append(f"| **{goal_id}** | {name} | {b_raw} | **{c_raw}** | `{delta_str}` | {indicator} | {notes} |")

    lines.append("")
    lines.append("## 2. 주요 차이 및 실패 케이스 (Analysis)")
    lines.append("")
    if current_run.failed_cases:
        for idx, fc in enumerate(current_run.failed_cases, 1):
            title = fc.get("title", "실패 항목")
            reason = fc.get("reason", "원인 미상")
            impact = fc.get("impact", "")
            lines.append(f"{idx}. **{title}**:")
            lines.append(f"   - 원인: {reason}")
            if impact:
                lines.append(f"   - 영향: {impact}")
    else:
        lines.append("- 기록된 주요 실패 케이스가 없습니다.")

    return "\n".join(lines)


def find_run_dir(base_dir: Path, run_id: str) -> Path:
    """Find run directory matching run_id."""
    runs_dir = base_dir / "evals" / "runs"
    direct = runs_dir / run_id
    if direct.exists() and (direct / "metrics.json").exists():
        return direct

    # Try matching prefix
    matches = [d for d in runs_dir.iterdir() if d.is_dir() and d.name.startswith(run_id)]
    if len(matches) == 1:
        return matches[0]
    elif len(matches) > 1:
        raise ValueError(f"Ambiguous run_id {run_id}: found {len(matches)} matching runs")
    raise FileNotFoundError(f"Run {run_id} not found in {runs_dir}")


def list_runs(base_dir: Path) -> List[str]:
    """List all available run_ids sorted chronologically."""
    runs_dir = base_dir / "evals" / "runs"
    if not runs_dir.exists():
        return []
    runs = [d.name for d in runs_dir.iterdir() if d.is_dir() and (d / "metrics.json").exists()]
    return sorted(runs)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare two cuAlign evaluation runs quantitatively.")
    parser.add_argument("baseline", nargs="?", help="Baseline run_id (YYMMDDHHMMSS)")
    parser.add_argument("current", nargs="?", help="Current run_id (YYMMDDHHMMSS)")
    parser.add_argument("--latest", action="store_true", help="Compare the latest run with its predecessor")
    parser.add_argument("--save", action="store_true", help="Save markdown comparison to current run directory")
    parser.add_argument("--base-dir", type=Path, default=Path(__file__).resolve().parent.parent)

    args = parser.parse_args()

    all_runs = list_runs(args.base_dir)
    if not all_runs:
        print("Error: No evaluation runs found in evals/runs/", file=sys.stderr)
        sys.exit(1)

    if args.latest:
        if len(all_runs) < 2:
            print(f"Error: Need at least 2 runs for --latest comparison (found {len(all_runs)})", file=sys.stderr)
            sys.exit(1)
        baseline_id = all_runs[-2]
        current_id = all_runs[-1]
    elif args.baseline and args.current:
        baseline_id = args.baseline
        current_id = args.current
    elif args.baseline and not args.current:
        # compare baseline against latest
        baseline_id = args.baseline
        current_id = all_runs[-1]
    else:
        parser.print_help()
        sys.exit(1)

    dir_base = find_run_dir(args.base_dir, baseline_id)
    dir_curr = find_run_dir(args.base_dir, current_id)

    run_base = EvaluationRun.load(dir_base)
    run_curr = EvaluationRun.load(dir_curr)

    report = generate_markdown_comparison(run_base, run_curr)
    print(report)

    if args.save:
        out_file = dir_curr / f"comparison_vs_{run_base.metadata.run_id}.md"
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"\nSaved comparison to {out_file}", file=sys.stderr)


if __name__ == "__main__":
    main()
