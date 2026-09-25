"""In-process artifact store shared by the agent tools and the web API (same FastAPI process).

Plans are also persisted as JSON under CUALIGN_OUT (default ./out) so `nat run` results survive.
"""
from __future__ import annotations

import json
import os
import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import patients
from .case import Case
from .constraints import Constraints
from .synth import PRESETS

OUT_DIR = Path(os.environ.get("CUALIGN_OUT", "out"))


class Store:
    def __init__(self):
        self.cases: dict[str, Case] = {}
        self.case_constraints: dict[str, Constraints] = {}
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
            # patient scans are listed under their patient (/api/patients), never among samples or to the model
            if k not in {r["case_id"] for r in rows} and patients.case_folder(k) is None:
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
            elif (folder := patients.case_folder(case_id)) is not None:
                self.cases[case_id] = Case.from_dir(folder)
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
    def constraints_for(self, case_id: str, parent_plan_id: str | None = None) -> Constraints:
        if parent_plan_id is not None:
            parent = self.plans.get(parent_plan_id)
            if parent is None or parent["case_id"] != case_id:
                raise ValueError("parent plan must exist in the same case")
            return parent["constraints"]
        return self.case_constraints.get(case_id, Constraints())

    def put_target(self, case_id: str, target: dict, info: dict, constraints: Constraints | None = None) -> str:
        tid = "t" + uuid.uuid4().hex
        self.targets[tid] = {"case_id": case_id, "target": target, "info": info,
                            "constraints": constraints or self.constraints_for(case_id)}
        return tid

    def put_plan(self, case_id: str, target_id: str | None, stages: list[dict], info: dict,
                 violations: list[dict], stage_cap: int | None, strategy: str,
                 constraints: Constraints | None = None, parent_plan_id: str | None = None) -> str:
        inherited = self.constraints_for(case_id, parent_plan_id)
        c = constraints or inherited.patched({"stage_cap": stage_cap, "order": info.get("order", inherited.order)})
        pid = "p" + uuid.uuid4().hex
        self.plans[pid] = {"plan_id": pid, "case_id": case_id, "target_id": target_id, "stages": stages,
            "info": info, "violations": violations, "stage_cap": c.stage_cap, "strategy": strategy,
            "constraints": c, "parent_plan_id": parent_plan_id,
            "review": {"status": "not_requested", "attempts": 0, "message": "", "error": None},
            "approval": None}
        self._persist(pid)
        return pid

    def plan_json(self, pid: str) -> dict:
        p = self.plans[pid]
        tinfo = self.targets.get(p["target_id"] or "", {}).get("info", {})
        return {"plan_id": pid, "case_id": p["case_id"], "strategy": p["strategy"], "stage_cap": p["stage_cap"],
                "parent_plan_id": p["parent_plan_id"], "constraints": p["constraints"].model_dump(mode="json"),
                "review": dict(p["review"]), "approval": dict(p["approval"]) if p["approval"] else None,
                "info": p["info"], "target": tinfo, "violations": p["violations"], "passed": not p["violations"],
                "stages": [{str(i): np.round(v, 4).tolist() for i, v in st.items()} for st in p["stages"]],
                # degrees about each crown's vertical axis through its centroid (pivot), per stage
                "rotations": [{str(i): round(float(y), 3) for i, y in getattr(st, "yaw", {}).items()} for st in p["stages"]],
                "pivots": {str(i): np.round(c, 4).tolist() for i, c in self.cases[p["case_id"]].pos0.items()}
                if p["case_id"] in self.cases else {}}

    def fingerprint(self, pid: str) -> str:
        data = self.plan_json(pid)
        data.pop("approval")
        # Hash full precision coordinates, not the rounded display values.
        data["stages"] = [{str(i): np.asarray(v).tolist() for i, v in st.items()} for st in self.plans[pid]["stages"]]
        return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def approve(self, pid: str) -> dict:
        p = self.plans[pid]
        if p["violations"]:
            raise ValueError("규칙 위반 계획은 승인할 수 없습니다.")
        if p["review"]["status"] not in ("passed", "skipped"):
            raise ValueError("검토가 완료되지 않았습니다. 검토 실패/미실행 계획은 승인할 수 없습니다.")
        p["approval"] = {"status": "approved", "approved_at": datetime.now(timezone.utc).isoformat(),
                         "fingerprint": self.fingerprint(pid)}
        self._persist(pid)
        return self.plan_json(pid)

    def revoke(self, pid: str) -> dict:
        self.plans[pid]["approval"] = None
        self._persist(pid)
        return self.plan_json(pid)

    def require_approved(self, pid: str) -> None:
        p = self.plans[pid]
        if not p["approval"] or p["approval"]["fingerprint"] != self.fingerprint(pid):
            raise ValueError("의사가 현재 계획을 승인한 뒤 내보낼 수 있습니다.")

    def set_review(self, pid: str, result: dict) -> dict:
        self.plans[pid]["review"] = dict(result)
        self.plans[pid]["approval"] = None
        self._persist(pid)
        return dict(result)

    def _persist(self, pid: str) -> None:
        d = OUT_DIR / "plans"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{pid}.json").write_text(json.dumps(self.plan_json(pid), ensure_ascii=False), encoding="utf-8")


STORE = Store()
