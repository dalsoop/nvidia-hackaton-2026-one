"""Step-3 runner: every case ends as pass, fail(reason) or unsupported(reason). Synthetic cases only (no data)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cualign.core import Case  # noqa: E402
from cualign.core.synth import make_case  # noqa: E402
from evals.real_scans.run import run_case  # noqa: E402


def test_outcomes_have_reasons():
    for preset, ext in (("mild", ()), ("severe", ()), ("moderate", (5, 12))):
        r = run_case(Case.synthetic(preset), extraction=ext)
        assert r["outcome"] in ("pass", "fail") and r["reason"], (preset, r)
    assert run_case(Case.synthetic("severe"))["outcome"] == "fail"


def test_gap_in_the_arch_is_unsupported():
    meshes = make_case("mild")
    del meshes[7]
    r = run_case(Case(meshes))
    assert r["outcome"] == "unsupported" and "12번" in r["reason"]      # Universal 7 = FDI 12
