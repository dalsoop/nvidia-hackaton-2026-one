"""#51: a golden-set A run that the NVIDIA API did not let finish is "판정 불가", not an agent failure, and a live
run can be gated on a NIM preflight. The runner tests use the real NAT workflow with a `nim` LLM (ChatNVIDIA and
nim_stream_patch, as in production) pointed at a local fake that answers like the overloaded API. No key, no network."""
import asyncio
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("nat.runtime.loader")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cualign.agent.register  # noqa: E402,F401  applies nim_stream_patch the way the NAT plugin does
from cualign.agent import nim_stream_patch  # noqa: E402
from evals.golden_a import judge as judge_mod  # noqa: E402
from evals.golden_a.judge import load_specs  # noqa: E402
from evals.golden_a.reference_agent import run_reference  # noqa: E402
from evals.golden_a.runner import nim_call_once, preflight_gate, run_specs  # noqa: E402
from evals.golden_a.trace import Trace, Turn, is_overload_crash, unscorable_reason  # noqa: E402
from rails_fakes import FakeLLM  # noqa: E402

SPECS = load_specs()
STREAM_ATTEMPTS = len(nim_stream_patch.DELAYS) + 1   # requests one planner call makes before NIMStreamError


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(nim_stream_patch, "DELAYS", (0,) * len(nim_stream_patch.DELAYS))
    monkeypatch.setattr(nim_stream_patch, "REQUEST_DELAYS", (0,) * len(nim_stream_patch.REQUEST_DELAYS))


# ------------------------------------------------------------------------------------------------ classification
@pytest.mark.parametrize("error", [
    "NIMStreamError: NIM stream failed after 7 request(s); the API error is in the log",
    "Exception: [503] Service Unavailable\nService temporarily overloaded",
    "Exception: [429] Too Many Requests",
    "RateLimitError: Error code: 429",
])
def test_overload_crash_is_recognised(error):
    assert is_overload_crash(error)


@pytest.mark.parametrize("error", [
    "retry Tool call attempt 1/3 for tool reviewer failed: [503] Service Unavailable",   # NAT retry log, not a crash
    "Tool call failed after all retry attempts: 503",
    "ValueError: plan p3 has no stages",                                                   # a crash the agent caused
    "KeyError: 'target_id'",
])
def test_other_errors_are_not_overload(error):
    assert not is_overload_crash(error)


def test_reviewer_503_the_agent_reported_is_scored():
    """The reviewer failing on a 503 is logged as a tool retry; the run finished and the agent is judged."""
    tr = Trace("A01", "nat:x", [Turn(user="u", answer="검토 메모 생성 실패(503)",
                                     errors=["retry Tool call attempt 1/2 for tool reviewer failed: [503]"])])
    assert unscorable_reason(tr) is None


def test_legacy_trace_with_a_crashed_turn_is_unscorable():
    """Traces written before meta.unscorable existed (9/26 A02, A04) are still recognised by the crash record."""
    tr = Trace("A02", "nat:nim_super", [Turn(user="u", errors=["NIMStreamError: NIM stream failed after 7 request(s)"])])
    assert unscorable_reason(tr).startswith("turn 0: NIMStreamError")


# ------------------------------------------------------------------------------------------------ runner
def _nim_llm(fake) -> dict:
    return {"_type": "nim", "model_name": "fake/planner", "base_url": fake.base_url, "api_key": "fake",
            "temperature": 0.0, "max_tokens": 256, "num_retries": 1}


def _run(fake, spec_ids, out, retries):
    specs = [SPECS[s] for s in spec_ids]
    return asyncio.run(asyncio.wait_for(
        run_specs(specs, 1, "nim_super", out, llm_override=_nim_llm(fake), unscorable_retries=retries), timeout=240))


def test_overloaded_run_is_kept_as_unscorable_and_rerun(tmp_path):
    """A09 has two turns: the overload ends the run at turn 0, and every attempt is saved as unscorable."""
    with FakeLLM() as fake:
        fake.busy = 10_000
        paths = _run(fake, ["A09"], tmp_path, retries=1)
    assert [p.name for p in paths] == ["A09__nat-fake__run1__unscorable1.json", "A09__nat-fake__run1__unscorable2.json"]
    for p in paths:
        tr = Trace.load(p)
        assert "NIMStreamError" in tr.meta["unscorable"]
        assert len(tr.turns) == 1                           # turn 1 was not sent to an API that is down
        assert unscorable_reason(tr)
    assert len(fake.requests) == 2 * STREAM_ATTEMPTS        # one planner call per attempt, each asked 7 times


def test_rerun_after_the_overload_is_the_scored_run(tmp_path):
    """The API recovers after one planner call's worth of overload: attempt 2 is saved as run1 and judged."""
    with FakeLLM() as fake:
        fake.busy = STREAM_ATTEMPTS
        paths = _run(fake, ["A01"], tmp_path, retries=2)
    assert [p.name for p in paths] == ["A01__nat-fake__run1__unscorable1.json", "A01__nat-fake__run1.json"]
    final = Trace.load(paths[-1])
    assert final.meta["attempt"] == 2 and "unscorable" not in final.meta
    assert final.turns[0].answer and not final.turns[0].errors


# ------------------------------------------------------------------------------------------------ judge
def test_judge_leaves_unscorable_runs_out_of_the_pass_count(tmp_path, capsys):
    run_reference(SPECS["A01"]).save(tmp_path / "A01__ref__run1.json")          # a scored run
    Trace("A04", "nat:nim_super", [Turn(user=SPECS["A04"].turns[0],
                                        errors=["NIMStreamError: NIM stream failed after 7 request(s)"])],
          meta={"unscorable": "turn 0: NIMStreamError: NIM stream failed", "attempt": 3}
          ).save(tmp_path / "A04__nat-nim_super__run1__unscorable3.json")
    (tmp_path / "preflight.json").write_text(json.dumps(
        {"calls": 20, "ok": 19, "rate": 0.95, "min_success": 0.95, "passed": True, "at": "2026-09-26T09:00:00+0900"}))
    assert judge_mod.main(["--traces", str(tmp_path), "--out", str(tmp_path / "report.md")]) == 0
    report = (tmp_path / "report.md").read_text(encoding="utf-8")
    assert "판정 불가 (NIM overload, pass 계산에서 제외): 1/2 runs (50%) · A04 1" in report
    assert "| A04 | " in report and "판정 불가 1 (NIM overload)" in report
    a04_row = next(line for line in report.splitlines() if line.startswith("| A04 |"))
    assert "❌" not in a04_row                              # not a failure
    assert "(spec, agent) rows: 1 " in report               # only A01 was judged
    assert "NIM preflight: 19/20 (95%), need 95% -> go" in report
    assert "A04 · nat:nim_super · attempt 3: turn 0: NIMStreamError" in report


# ------------------------------------------------------------------------------------------------ preflight
def _preflight(fake, tmp_path, n=20, min_success=0.95):
    return preflight_gate(tmp_path, n, min_success, lambda: nim_call_once(fake.base_url, "fake/planner", "fake", 10),
                          model="fake/planner")


def test_preflight_holds_below_the_threshold(tmp_path):
    with FakeLLM() as fake:
        fake.busy = 2                                        # 18/20: the 05:48 KST kind of hour
        pre = _preflight(fake, tmp_path)
    assert (pre["ok"], pre["rate"], pre["passed"]) == (18, 0.9, False)
    assert pre["errors"] == {"stream error 503": 2}
    assert len(fake.requests) == 20                          # one request each: the preflight never asks again
    assert json.loads((tmp_path / "preflight.json").read_text())["passed"] is False


def test_preflight_passes_at_the_threshold(tmp_path):
    with FakeLLM() as fake:
        fake.busy = 1
        pre = _preflight(fake, tmp_path)
    assert (pre["ok"], pre["passed"]) == (19, True)


def test_preflight_counts_an_http_overload(tmp_path):
    with FakeLLM() as fake:
        fake.busy, fake.busy_http = 3, True
        fake.busy_error = {"message": "Too Many Requests", "code": 429}
        pre = _preflight(fake, tmp_path)
    assert pre["errors"] == {"HTTP 429": 3} and not pre["passed"]


def test_runner_stops_before_any_spec_when_the_preflight_holds(tmp_path, monkeypatch):
    from evals.golden_a import runner
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-fake")
    monkeypatch.setattr(runner, "nim_call_once", lambda *a, **k: "stream error 503")
    ran = []
    monkeypatch.setattr(runner, "run_specs", lambda *a, **k: ran.append(a))
    assert runner.main(["--specs", "A01", "--nim-preflight", "5", "--out", str(tmp_path)]) == 3
    assert not ran
    assert json.loads((tmp_path / "preflight.json").read_text())["rate"] == 0.0
