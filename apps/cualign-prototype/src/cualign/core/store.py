"""In-process artifact store shared by the agent tools and the web API (same FastAPI process).

Plans are also persisted as JSON under CUALIGN_OUT (default ./out) so `nat run` results survive.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np

from .case import Case
from .synth import PRESETS

OUT_DIR = Path(os.environ.get("CUALIGN_OUT", "out"))


class Store:
    def __init__(self):
        self.cases: dict[str, Case] = {}
        self.active_case: str | None = None
        self.targets: dict[str, dict] = {}
        self.plans: dict[str, dict] = {}

    # ------------------------------------------------------------------ cases
    def available_cases(self) -> list[dict]:
        rows = [{"case_id": k, "kind": "synthetic", "crowding_mm": v["crowding_mm"]} for k, v in PRESETS.items()]
        env = os.environ.get("CUALIGN_CASE_DIR")
        if env and Path(env).exists():
            rows.append({"case_id": "scan", "kind": "stl-folder", "path": env})
        for k in self.cases:
            if k not in {r["case_id"] for r in rows}:
                rows.append({"case_id": k, "kind": "loaded"})
        return rows

    def load_case(self, case_id: str | None = None) -> tuple[str, Case]:
        if case_id is None:
            case_id = self.active_case or ("scan" if os.environ.get("CUALIGN_CASE_DIR") else "moderate")
        if case_id not in self.cases:
            if case_id in PRESETS:
                self.cases[case_id] = Case.synthetic(case_id)
            elif case_id == "scan":
                self.cases[case_id] = Case.from_dir(os.environ["CUALIGN_CASE_DIR"])
            elif Path(case_id).is_dir():
                self.cases[case_id] = Case.from_dir(case_id)
            else:
                raise KeyError(f"unknown case_id {case_id!r}; available: {[r['case_id'] for r in self.available_cases()]}")
        self.active_case = case_id
        return case_id, self.cases[case_id]

    def add_case(self, case_id: str, case: Case) -> None:
        self.cases[case_id] = case
        self.active_case = case_id

    # ------------------------------------------------------------------ targets / plans
    def put_target(self, case_id: str, target: dict, info: dict) -> str:
        tid = f"t{len(self.targets) + 1}"
        self.targets[tid] = {"case_id": case_id, "target": target, "info": info}
        return tid

    def put_plan(self, case_id: str, target_id: str | None, stages: list[dict], info: dict,
                 violations: list[dict], stage_cap: int | None, strategy: str) -> str:
        pid = f"p{len(self.plans) + 1}"
        self.plans[pid] = {"plan_id": pid, "case_id": case_id, "target_id": target_id, "stages": stages,
                           "info": info, "violations": violations, "stage_cap": stage_cap, "strategy": strategy}
        self._persist(pid)
        return pid

    def plan_json(self, pid: str) -> dict:
        p = self.plans[pid]
        tinfo = self.targets.get(p["target_id"] or "", {}).get("info", {})
        return {"plan_id": pid, "case_id": p["case_id"], "strategy": p["strategy"], "stage_cap": p["stage_cap"],
                "info": p["info"], "target": tinfo, "violations": p["violations"], "passed": not p["violations"],
                "stages": [{str(i): np.round(v, 4).tolist() for i, v in st.items()} for st in p["stages"]]}

    def _persist(self, pid: str) -> None:
        d = OUT_DIR / "plans"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{pid}.json").write_text(json.dumps(self.plan_json(pid), ensure_ascii=False), encoding="utf-8")


STORE = Store()
