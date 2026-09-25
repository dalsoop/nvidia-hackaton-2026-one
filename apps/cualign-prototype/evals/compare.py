"""Pure quantitative comparison tool between evaluation runs (no subjective judgments)."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

# Enable running directly as a script without -m
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evals.schema import EvaluationRun, MetricRecord, validate_run_id


def calculate_delta(
    goal_id: str,
    baseline_record: Optional[MetricRecord],
    current_record: Optional[MetricRecord],
) -> Tuple[Optional[float], str]:
    """Calculate purely factual numerical delta without subjective judgment.

    Returns:
        (delta_value, delta_display_str)
    """
    if baseline_record is None or current_record is None:
        return (None, "-")

    v_base = baseline_record.value
    v_curr = current_record.value

    if v_base is None or v_curr is None:
        if baseline_record.raw == current_record.raw:
            return (None, "-")
        return (None, f"{baseline_record.raw} → {current_record.raw}")

    delta = v_curr - v_base

    # Format factual delta string
    if current_record.unit == "%" or (0.0 <= v_curr <= 1.0 and current_record.unit == ""):
        delta_str = f"{delta * 100:+.1f}%p" if abs(delta) > 1e-6 else "0.0%p"
    elif current_record.unit == "s":
        delta_str = f"{delta:+.1f}s" if abs(delta) > 1e-6 else "0.0s"
    elif current_record.unit == "건":
        delta_str = f"{int(delta):+d}건" if abs(delta) > 1e-6 else "0건"
    elif current_record.unit:
        delta_str = f"{delta:+.2f}{current_record.unit}" if abs(delta) > 1e-6 else f"0.00{current_record.unit}"
    else:
        delta_str = f"{delta:+.2f}" if abs(delta) > 1e-6 else "0.00"

    return (delta, delta_str)


def generate_markdown_comparison(
    baseline_run: EvaluationRun,
    current_run: EvaluationRun,
) -> str:
    """Generate a GitHub-flavored Markdown comparison table with pure factual delta."""
    lines: List[str] = []
    lines.append(f"# Evaluation Comparison: {current_run.metadata.run_id} vs {baseline_run.metadata.run_id}")
    lines.append("")
    lines.append(f"- **Current Run**: `{current_run.metadata.run_id}` ({current_run.metadata.git_commit}) [Agent: `{current_run.metadata.agent_target}`]")
    lines.append(f"- **Baseline Run**: `{baseline_run.metadata.run_id}` ({baseline_run.metadata.git_commit}) [Agent: `{baseline_run.metadata.agent_target}`]")
    lines.append(f"- **Model**: `{current_run.metadata.model}`")
    lines.append("")
    lines.append("## 1. 정량 지표 비교 (Phase 1 Goals)")
    lines.append("")
    lines.append("| Goal ID | 목표 항목 | 기준선 (Baseline) | 현재 실행 (Current) | 차이 (Delta) | 비고 |")
    lines.append("| :--- | :--- | :---: | :---: | :---: | :--- |")

    def goal_sort_key(gid: str) -> tuple[int, int, str]:
        m = re.match(r"^P(\d+)-(\d+)$", gid)
        if m:
            return (int(m.group(1)), int(m.group(2)), gid)
        return (999, 999, gid)

    all_goal_ids = sorted(
        set(list(baseline_run.metrics.keys()) + list(current_run.metrics.keys())),
        key=goal_sort_key,
    )

    for goal_id in all_goal_ids:
        b_rec = baseline_run.metrics.get(goal_id)
        c_rec = current_run.metrics.get(goal_id)

        name = c_rec.name if c_rec else (b_rec.name if b_rec else goal_id)
        b_raw = b_rec.raw if b_rec else "N/A"
        c_raw = c_rec.raw if c_rec else "N/A"
        notes = c_rec.notes if c_rec else ""

        _, delta_str = calculate_delta(goal_id, b_rec, c_rec)
        lines.append(f"| **{goal_id}** | {name} | {b_raw} | **{c_raw}** | `{delta_str}` | {notes} |")

    lines.append("")
    lines.append("## 2. 관측된 세부 사항 (Observations)")
    lines.append("")
    if current_run.failed_cases:
        for idx, fc in enumerate(current_run.failed_cases, 1):
            title = fc.get("title", "관측 항목")
            reason = fc.get("reason", "")
            impact = fc.get("impact", "")
            lines.append(f"{idx}. **{title}**:")
            if reason:
                lines.append(f"   - 현상/원인: {reason}")
            if impact:
                lines.append(f"   - 영향: {impact}")
    else:
        lines.append("- 기록된 세부 특이사항이 없습니다.")

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
    """List all available run_ids sorted chronologically (normalizing 12/14 digits)."""
    runs_dir = base_dir / "evals" / "runs"
    if not runs_dir.exists():
        return []
    runs = [
        d.name
        for d in runs_dir.iterdir()
        if d.is_dir() and validate_run_id(d.name) and (d / "metrics.json").exists()
    ]
    # Normalize sorting key so 12-digit (YYMMDD) and 14-digit (YYYYMMDD) sort properly
    return sorted(runs, key=lambda r: ("20" + r) if len(r) == 12 else r)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare two cuAlign evaluation runs quantitatively without judgments.")
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
