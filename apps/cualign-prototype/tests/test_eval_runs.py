"""Unit tests for evals run tracking and comparison system."""

from pathlib import Path
import tempfile
import unittest

from evals.compare import calculate_delta, generate_markdown_comparison
from evals.recorder import create_initial_phase1_metrics, init_new_run
from evals.schema import (
    EvaluationRun,
    MetricRecord,
    RunMetadata,
    generate_run_id,
    validate_run_id,
)


class TestEvalRuns(unittest.TestCase):
    def test_run_id_validation(self):
        """Test yymmddhhmmss timestamp format validation."""
        self.assertTrue(validate_run_id("260925152600"))  # 12 digits
        self.assertTrue(validate_run_id("20260925152600"))  # 14 digits
        self.assertFalse(validate_run_id("260925"))  # too short
        self.assertFalse(validate_run_id("26092515260a"))  # non-digit
        self.assertFalse(validate_run_id("invalid-timestamp"))

    def test_run_id_generator(self):
        """Test generation of 12-digit run_id."""
        run_id = generate_run_id()
        self.assertEqual(len(run_id), 12)
        self.assertTrue(validate_run_id(run_id))

    def test_metric_delta_calculation(self):
        """Test numeric delta calculation and semantic status indicator."""
        # Higher is better: completion rate
        b_p1 = MetricRecord("P1-1", "완주율", 0.60, "60%", "100%", "warning", 5, unit="%")
        c_p1_better = MetricRecord("P1-1", "완주율", 0.80, "80%", "100%", "passed", 5, unit="%")
        c_p1_worse = MetricRecord("P1-1", "완주율", 0.40, "40%", "100%", "failed", 5, unit="%")

        delta, delta_str, ind = calculate_delta("P1-1", b_p1, c_p1_better)
        self.assertAlmostEqual(delta, 0.20)
        self.assertEqual(delta_str, "+20.0%p")
        self.assertEqual(ind, "🟢 개선")

        delta, delta_str, ind = calculate_delta("P1-1", b_p1, c_p1_worse)
        self.assertAlmostEqual(delta, -0.20)
        self.assertEqual(delta_str, "-20.0%p")
        self.assertEqual(ind, "🔴 악화")

        # Lower is better: latency (P1-7)
        b_p7 = MetricRecord("P1-7", "응답시간", 65.8, "65.8s", "<45s", "warning", 5, unit="s")
        c_p7_better = MetricRecord("P1-7", "응답시간", 45.0, "45.0s", "<45s", "passed", 5, unit="s")
        c_p7_worse = MetricRecord("P1-7", "응답시간", 85.0, "85.0s", "<45s", "warning", 5, unit="s")

        delta, delta_str, ind = calculate_delta("P1-7", b_p7, c_p7_better)
        self.assertAlmostEqual(delta, -20.8)
        self.assertEqual(delta_str, "-20.8s")
        self.assertEqual(ind, "🟢 개선")

        delta, delta_str, ind = calculate_delta("P1-7", b_p7, c_p7_worse)
        self.assertAlmostEqual(delta, 19.2)
        self.assertEqual(delta_str, "+19.2s")
        self.assertEqual(ind, "🔴 악화")

    def test_run_save_and_load(self):
        """Test serialization and deserialization of EvaluationRun."""
        with tempfile.TemporaryDirectory() as tmpdir:
            run_dir = Path(tmpdir) / "260925120000"
            metadata = RunMetadata(
                run_id="260925120000",
                created_at="2026-09-25T12:00:00+09:00",
                git_commit="abcdef1",
                git_branch="feat/test",
                model="test-model",
            )
            metrics = create_initial_phase1_metrics()
            run = EvaluationRun(metadata=metadata, metrics=metrics)
            run.save(run_dir)

            self.assertTrue((run_dir / "metrics.json").exists())

            loaded = EvaluationRun.load(run_dir)
            self.assertEqual(loaded.metadata.run_id, "260925120000")
            self.assertEqual(loaded.metadata.git_commit, "abcdef1")
            self.assertEqual(len(loaded.metrics), 10)
            self.assertEqual(loaded.metrics["P1-3"].status, "passed")

    def test_baseline_run_exists(self):
        """Verify that the official baseline run (260925152600) loads properly."""
        base_dir = Path(__file__).resolve().parent.parent
        run_dir = base_dir / "evals" / "runs" / "260925152600"
        self.assertTrue(run_dir.exists(), f"Baseline run dir not found: {run_dir}")
        self.assertTrue((run_dir / "metrics.json").exists())
        self.assertTrue((run_dir / "summary.md").exists())

        run = EvaluationRun.load(run_dir)
        self.assertEqual(run.metadata.run_id, "260925152600")
        self.assertIn("P1-1", run.metrics)
        self.assertEqual(run.metrics["P1-1"].value, 0.60)
        self.assertEqual(run.metrics["P1-4"].value, 0.286)

    def test_markdown_comparison_generation(self):
        """Test markdown comparison output formatting."""
        base_dir = Path(__file__).resolve().parent.parent
        run_dir = base_dir / "evals" / "runs" / "260925152600"
        run = EvaluationRun.load(run_dir)

        report = generate_markdown_comparison(run, run)
        self.assertIn("# Evaluation Comparison", report)
        self.assertIn("P1-1", report)
        self.assertIn("P1-4", report)
        self.assertIn("⚪ 동일", report)


if __name__ == "__main__":
    unittest.main()
