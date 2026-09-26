"""Validates the part-A judge itself (no network, no key).

1. specs are well-formed and every spec names its source
2. the reference agent passes every spec            -> checks are satisfiable, not over-strict
3. every mutant of a reference trace fails its spec -> checks are sensitive (mutation kill rate 100 %)
4. deliberately bad agents fail                     -> specs are not trivially passable
5. the cached NAT logs parse into traces            -> the judge reads real agent output
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from evals.golden_a import baselines, mutations  # noqa: E402
from evals.golden_a.judge import judge, lint, load_specs  # noqa: E402
from evals.golden_a.nat_log import DEMO_LOG_SPEC, RETIRED_DEMO_LOGS, parse_nat_log  # noqa: E402
from evals.golden_a.reference_agent import run_reference  # noqa: E402
from evals.golden_a.trace import Trace  # noqa: E402

SPECS = load_specs()


@pytest.fixture(scope="module")
def reference():
    return {sid: run_reference(s) for sid, s in SPECS.items()}


def test_specs_lint_clean():
    assert lint(SPECS) == []
    assert len(SPECS) >= 18


def test_every_spec_has_sources_and_status():
    for s in SPECS.values():
        assert s.sources and s.status in {"prd", "team", "impl", "assumption"}, s.id


@pytest.mark.parametrize("sid", sorted(SPECS))
def test_reference_passes(reference, sid):
    r = judge(SPECS[sid], reference[sid])
    assert r.passed and not r.failures, [f"{f['id']}: {f['detail']}" for f in r.failures]
    assert not r.input_mismatch


def test_trace_roundtrip(reference, tmp_path):
    tr = reference["A08"]
    tr.save(tmp_path / "a08.json")
    back = Trace.load(tmp_path / "a08.json")
    assert judge(SPECS["A08"], back).passed


def _kill_matrix(reference):
    """survived = mutant passed; off_target = mutant failed, but none of the checks it targets did."""
    applied, survived, off_target = {}, [], []
    for op in mutations.OPERATORS:
        for sid, tr in reference.items():
            m = mutations.mutate(op, tr, SPECS[sid])
            if m is None:
                continue
            applied.setdefault(op.__name__, []).append(sid)
            r = judge(SPECS[sid], m)
            if r.passed:
                survived.append(f"{op.__name__}@{sid}")
                continue
            types = {c["id"]: c.get("type", c["id"]) for c in SPECS[sid].all_checks}
            failed = {types.get(f["id"], f["id"]) for f in r.failures if f["severity"] in ("S0", "S1")}
            if not failed & mutations.TARGETS[op.__name__]:
                off_target.append(f"{op.__name__}@{sid}: {sorted(failed)}")
    return applied, survived, off_target


def test_every_mutant_is_killed(reference):
    applied, survived, off_target = _kill_matrix(reference)
    assert survived == [], f"judge missed: {survived}"
    assert off_target == [], f"caught only by unrelated checks: {off_target}"
    assert set(mutations.TARGETS) == {op.__name__ for op in mutations.OPERATORS}
    unused = [op.__name__ for op in mutations.OPERATORS if op.__name__ not in applied]
    assert unused == [], f"operators that never applied (dead mutation): {unused}"
    assert sum(len(v) for v in applied.values()) >= 100


@pytest.mark.parametrize("op", ["use_refused_extraction", "compare_with_extraction", "drop_lock", "fake_success",
                                "fabricate_stage_count", "hide_reviewer_failure", "paraphrase_memo",
                                "silent_reviewer_error", "diagnose", "empty_answer", "drop_last_turn",
                                "claim_full_arch", "claim_condition_changed", "success_wording_variant", "memo_prepend_claim",
                                "memo_markdown_heading", "prescribe_ipr", "invent_ipr_amount"])
def test_safety_mutants_are_vetoed(reference, op):
    """Safety-relevant breakage must hit an S0 check (veto), not merely lower the score."""
    fn = getattr(mutations, op)
    hits = 0
    for sid, tr in reference.items():
        m = mutations.mutate(fn, tr, SPECS[sid])
        if m is None:
            continue
        hits += 1
        assert judge(SPECS[sid], m).vetoed, f"{op}@{sid} not vetoed"
    assert hits


def test_known_reviewer_issue_is_caught(reference):
    """KNOWN_ISSUES: reviewer empty output + retries, exit 0. run_scenarios.py reports this as success."""
    m = mutations.mutate(mutations.known_issue_reviewer_retry, reference["A04"])
    r = judge(SPECS["A04"], m)
    assert not r.passed
    assert {"G-reviewer-once", "G-errors-bounded"} <= {f["id"] for f in r.failures}


@pytest.mark.parametrize("make", baselines.BASELINES, ids=lambda f: f.__name__)
def test_bad_agents_fail(make):
    passed = sorted(sid for sid, s in SPECS.items() if judge(s, make(s)).passed)
    # the UI greeting already asks, so re-asking passes nothing (A01 included)
    assert passed == []


def test_nat_logs_parse():
    logs = sorted((ROOT / "docs" / "demo").glob("scenario-*.log"))
    assert logs
    for f in logs:
        key = "-".join(f.name.split("-")[:2])
        if key in RETIRED_DEMO_LOGS:
            assert key not in DEMO_LOG_SPEC and parse_nat_log(f, spec_id=key).turns[0].answer, f.name
            continue
        tr = parse_nat_log(f, spec_id=DEMO_LOG_SPEC[key])
        assert tr.turns[0].user.strip() == SPECS[DEMO_LOG_SPEC[key]].turns[0].strip(), f.name
        assert tr.turns[0].answer, f.name


def test_nat_log_reads_tool_calls():
    tr = parse_nat_log(ROOT / "docs/demo/scenario-1-pass-nim_super-native.log", spec_id="A04")
    names = [c.name for c in tr.turns[0].calls if c.agent == "planner"]
    assert names[:2] == ["clinical_limits", "load_case"]
    assert names.count("validate") == 3 and names.count("reviewer") == 1
    rv = [c for c in tr.turns[0].calls if c.name == "reviewer"][0]
    assert rv.args == {"plan_id": "p3"} and "한 줄 요약" in rv.result


def test_expect_matches_reference_parser():
    """Specs declare their reading of the request; the reference parser must agree. A parser regression then fails
    here instead of silently changing which mutants apply."""
    from evals.golden_a.reference_agent import ReferenceAgent, _parse
    from cualign.core.limits import stage_cap_from_months
    for sid, s in SPECS.items():
        st = ReferenceAgent().st
        for u in s.turns:
            _parse(u, st)
        refuses = False if st["known_extraction"] and st["allow_extraction"] else (True if st["known_extraction"] else None)
        if sid == "A06":   # 발치안·비발치안 비교 요청: extraction wanted, parser sees no refusal
            refuses = False
        cap = stage_cap_from_months(st["months"]) if st["months"] else None
        assert (refuses, cap, sorted(st["lock"])) == (s.expect["refuses_extraction"], s.expect["stage_cap"],
                                                       sorted(s.expect["lock"])), sid


def test_nat_log_truncation_and_retries(tmp_path):
    full = ROOT / "docs/demo/scenario-1-pass-nim_super-native.log"
    assert parse_nat_log(full, "A04").meta["truncated"] is True          # 400 saved lines = cut at the head
    assert parse_nat_log(ROOT / "docs/demo/scenario-4-interview-nim_super-native.log", "A01").meta["truncated"] is False
    text = full.read_text(encoding="utf-8").replace(
        "Calling tools: reviewer",
        "Tool call attempt 1/3 failed for tool reviewer: ReActAgentParsingFailedError\nCalling tools: reviewer", 1)
    f = tmp_path / "scenario-1-retry-nim_super-native.log"
    f.write_text(text, encoding="utf-8")
    tr = parse_nat_log(f, "A04")
    rv = [c for c in tr.turns[0].calls if c.name == "reviewer"]
    assert len(rv) == 1 and rv[0].ok                                     # one logical call, retry kept as an event
    assert any(e.startswith("retry reviewer") for e in tr.turns[0].errors)
