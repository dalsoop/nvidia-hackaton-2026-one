"""Unit tests for evals run tracking, comparison system, and candidate agents."""

from pathlib import Path
import tempfile
import unittest

from evals.agents import (
    AlwaysAskAgent,
    ClarificationFirstAgent,
    LoopGuardedAgent,
    ReferenceRuleAgent,
    SilentAgent,
    YesManAgent,
)
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

    def test_pure_delta_calculation(self):
        """Test pure numerical delta calculation without subjective judgment."""
        b_p1 = MetricRecord("P1-1", "완주율", 0.60, "60%", "100%", 5, unit="%")
        c_p1_better = MetricRecord("P1-1", "완주율", 0.80, "80%", "100%", 5, unit="%")
        c_p1_worse = MetricRecord("P1-1", "완주율", 0.40, "40%", "100%", 5, unit="%")

        delta, delta_str = calculate_delta("P1-1", b_p1, c_p1_better)
        self.assertAlmostEqual(delta, 0.20)
        self.assertEqual(delta_str, "+20.0%p")

        delta, delta_str = calculate_delta("P1-1", b_p1, c_p1_worse)
        self.assertAlmostEqual(delta, -0.20)
        self.assertEqual(delta_str, "-20.0%p")

        # Latency (P1-7)
        b_p7 = MetricRecord("P1-7", "응답시간", 65.8, "65.8s", "<45s", 5, unit="s")
        c_p7_better = MetricRecord("P1-7", "응답시간", 45.0, "45.0s", "<45s", 5, unit="s")

        delta, delta_str = calculate_delta("P1-7", b_p7, c_p7_better)
        self.assertAlmostEqual(delta, -20.8)
        self.assertEqual(delta_str, "-20.8s")

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
        """Test markdown comparison output formatting without judgment column."""
        base_dir = Path(__file__).resolve().parent.parent
        run_dir = base_dir / "evals" / "runs" / "260925152600"
        run = EvaluationRun.load(run_dir)

        report = generate_markdown_comparison(run, run)
        self.assertIn("# Evaluation Comparison", report)
        self.assertIn("P1-1", report)
        self.assertIn("P1-4", report)
        # Verify NO judgment indicators or columns exist
        self.assertNotIn("| 판정 |", report)
        self.assertNotIn("🟢 개선", report)
        self.assertNotIn("🔴 악화", report)


class TestCandidateAgents(unittest.TestCase):
    def test_baseline_agents(self):
        """Test sanity baseline agents behavior."""
        silent = SilentAgent()
        turn_s = silent.run_turn("발치 없이 12개월")
        self.assertEqual(turn_s.answer, "모르겠습니다.")

        always_ask = AlwaysAskAgent()
        turn_a = always_ask.run_turn("발치 없이 12개월")
        self.assertIn("발치는 허용되나요?", turn_a.answer)

        yes_man = YesManAgent()
        turn_y = yes_man.run_turn("발치 없이 12개월")
        self.assertEqual(turn_y.plan_id, "p_fake_001")
        self.assertEqual(len(turn_y.tool_calls), 0)

    def test_clarification_first_agent(self):
        """Test P1-2 clarification-first agent."""
        agent = ClarificationFirstAgent()
        # Missing extraction and months -> asks question
        turn1 = agent.run_turn("앞니 먼저 움직여줘")
        self.assertIn("발치는 허용되나요?", turn1.answer)
        self.assertEqual(len(turn1.tool_calls), 0)

        # Providing requirements -> executes planning
        turn2 = agent.run_turn("비발치로 12개월 안에")
        self.assertIn("plan_id", turn2.answer)
        self.assertTrue(len(turn2.tool_calls) > 0)

    def test_loop_guarded_agent(self):
        """Test P1-4 loop-guarded agent repetition detection."""
        agent = LoopGuardedAgent(max_consecutive_duplicates=2)
        turn1 = agent.run_turn("13번 고정해줘")
        self.assertNotIn("loop_detected", turn1.metadata)

        turn2 = agent.run_turn("13번 고정해줘")
        self.assertNotIn("loop_detected", turn2.metadata)

        # Third consecutive identical call -> intercepts
        turn3 = agent.run_turn("13번 고정해줘")
        self.assertTrue(turn3.metadata.get("loop_detected"))

    def test_reference_rule_agent(self):
        """Test deterministic reference agent."""
        agent = ReferenceRuleAgent()
        turn = agent.run_turn("moderate 케이스로 발치 없이 12개월 안에 끝나는 계획 짜줘. 앞니 먼저.")
        self.assertIsNotNone(turn.plan_id)
        self.assertTrue(len(turn.tool_calls) >= 3)
        self.assertIn("p_ref_001", turn.answer)


if __name__ == "__main__":
    unittest.main()
