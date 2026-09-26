"""Golden set A: behaviour specs for the cuAlign agent and a deterministic judge.

Run from apps/cualign-prototype:
    uv run python -m evals.golden_a.judge --reference              # judge the rule-based reference agent
    uv run python -m evals.golden_a.judge --nat-logs docs/demo     # judge cached NAT logs (no model call)
    uv run python -m evals.golden_a.runner --plan                  # size of a live run (no model call)
    uv run python -m evals.golden_a.runner --specs A01,A04 --k 3   # live run: NVIDIA_API_KEY, uses NIM quota
    uv run python -m evals.golden_a.judge --traces out/golden_a/<run>
    uv run pytest -q tests/test_golden_a.py tests/test_golden_a_checks.py tests/test_golden_a_runner.py
"""
