"""Step 3: real scans end to end, rule-based (no LLM). Each case ends as pass, fail(reason) or unsupported(reason).

  python -m evals.real_scans.run                     # every data/cases/poseidon-* folder (git-ignored, CC-BY)
  python -m evals.real_scans.run --extract 5,12       # plan the prescribed extraction (Universal teeth)

The ladder is the server's rule-based fallback (the agent's loop without the model): strategies in order until one
validates. "fail" names what the best attempt still violates; nothing here judges whether a plan is clinically right.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from cualign.core import planner
from cualign.core.case import Case
from cualign.core.constraints import Constraints
from cualign.core.limits import STRATEGIES

DATA = Path(__file__).resolve().parents[2] / "data" / "cases"


def run_case(case: Case, extraction: tuple[int, ...] = (), stage_cap: int | None = None) -> dict:
    """`extraction`: the prescribed teeth (Universal). With teeth only the extraction plan is made (the prescription
    decides, #56); without, the non-extraction strategies in order."""
    why = planner.unsupported_reasons(case)
    if why:
        return {"outcome": "unsupported", "reason": "; ".join(why)}
    tried = []
    for s in (["extraction"] if extraction else [s for s in STRATEGIES if s != "extraction"]):
        target, info = planner.propose_target(case, s, extraction=tuple(extraction))
        stages, sinfo = planner.plan_stages(case, target)
        viol = planner.validate(case, stages, stage_cap=stage_cap, space_deficit_mm=info["space_deficit_mm"],
                                constraints=Constraints(extraction=tuple(extraction), stage_cap=stage_cap),
                                target_info=info)   # the prescription and the cap, as the service checks them
        row = {"strategy": s, "n_stages": sinfo["n_stages"], "months": sinfo["months"], "by_type": planner.summarize(viol),
               "deficit": info["space_deficit_mm"], "notes": info["notes"], "viol": viol}
        tried.append(row)
        if not viol:
            return {"outcome": "pass", "reason": f"{s} · {sinfo['n_stages']}장 · {sinfo['months']}개월",
                    "crowding_mm": info["crowding_mm"], "tried": tried}
    best = min(tried, key=lambda r: (len(r["viol"]), r["deficit"]))
    parts = [f"{k} {n}건" for k, n in best["by_type"].items()]
    if best["deficit"] > 0:
        parts.append(f"공간 {best['deficit']:.1f}mm 부족")
    col = [v for v in best["viol"] if v["type"] == "collision"]
    if col:
        worst = max(col, key=lambda v: v["overlap_mm3"] - v["baseline"])
        parts.append(f"가장 큰 충돌 {worst['teeth']} 단계 {worst['stage']} (+{worst['overlap_mm3'] - worst['baseline']:.1f}mm³)")
    return {"outcome": "fail", "reason": f"최선 {best['strategy']}: " + ", ".join(parts),
            "crowding_mm": planner.crowding_mm(case), "tried": tried}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--extract", default="", help='prescribed extraction teeth, Universal, e.g. "5,12"')
    ap.add_argument("cases", nargs="*", help="case folders (default: data/cases/poseidon-*)")
    a = ap.parse_args(argv)
    folders = [Path(c) for c in a.cases] or sorted(DATA.glob("poseidon-*"))
    if not folders:
        print("no cases: run scripts/import_poseidon.py first")
        return 1
    print("| case | crowding (mm) | corrections | outcome | reason | time (s) |\n|---|---|---|---|---|---|")
    for f in folders:
        t0 = time.time()
        case = Case.from_dir(f)
        r = run_case(case, extraction=tuple(int(t) for t in a.extract.split(",") if t.strip()))
        tried = r.get("tried") or [{}]
        corr = [n for n in tried[-1].get("notes", []) if "회전" in n or "수직" in n]
        print(f"| {f.name} | {planner.crowding_mm(case)} | {', '.join(corr) or '—'} | {r['outcome']} | {r['reason']} | {time.time() - t0:.0f} |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
