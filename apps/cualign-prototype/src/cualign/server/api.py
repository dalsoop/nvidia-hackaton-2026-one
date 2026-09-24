"""Artifact API + static UI. Reads the same in-process STORE the agent tools write to."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from cualign.core import Case, limits as L, planner
from cualign.core.store import OUT_DIR, STORE

STATIC_DIR = Path(__file__).resolve().parent / "static"


class RulePlanRequest(BaseModel):
    case_id: str | None = None
    allow_extraction: bool = True
    stage_cap: int | None = None
    order: str = "simultaneous"


def _summary(pid: str) -> dict:
    p = STORE.plans[pid]
    return {"plan_id": pid, "case_id": p["case_id"], "strategy": p["strategy"], "n_stages": p["info"]["n_stages"],
            "months": p["info"]["months"], "passed": not p["violations"], "violations": len(p["violations"]),
            "by_type": planner.summarize(p["violations"])}


def rule_based_plan(case_id: str | None, allow_extraction: bool, stage_cap: int | None, order: str) -> dict:
    """The agent's loop without the LLM: walk the strategy ladder until validate passes. Used as a demo fallback."""
    cid, case = STORE.load_case(case_id)
    allowed = [s for s in L.STRATEGIES if allow_extraction or s != "extraction"]
    tried, chosen = [], None
    for s in allowed:
        target, info = planner.propose_target(case, s)
        stages, sinfo = planner.plan_stages(case, target, order=order)
        viol = planner.validate(case, stages, stage_cap=stage_cap, space_deficit_mm=info["space_deficit_mm"])
        tid = STORE.put_target(cid, target, info)
        pid = STORE.put_plan(cid, tid, stages, {**sinfo, "space_deficit_mm": info["space_deficit_mm"]}, viol, stage_cap, s)
        tried.append(_summary(pid))
        if not viol:
            chosen = tried[-1]
            break
    if chosen is None and tried:
        best = min(tried, key=lambda r: (r["violations"], STORE.plans[r["plan_id"]]["info"].get("space_deficit_mm", 0)))
        best = {**best, "note": "모든 허용 전략이 실패 — 위반이 가장 적은 안"}
        return {"case_id": cid, "chosen": None, "best_failed": best, "tried": tried}
    return {"case_id": cid, "chosen": chosen, "tried": tried}


def add_api_routes(app: FastAPI) -> None:

    @app.get("/", include_in_schema=False)
    async def root():
        return RedirectResponse(url="/ui/")

    @app.get("/api/cases")
    async def list_cases():
        return {"cases": STORE.available_cases(), "active": STORE.active_case}

    @app.post("/api/cases/{case_id}/activate")
    async def activate_case(case_id: str):
        """The dentist picked a case in the UI: make it the case the agent tools use by default."""
        try:
            cid, case = STORE.load_case(case_id)
        except (KeyError, FileNotFoundError) as e:
            raise HTTPException(404, str(e))
        return {"case_id": cid, "n_teeth": len(case.ids), "crowding_mm": planner.crowding_mm(case)}

    @app.get("/api/cases/{case_id}/mesh")
    async def case_mesh(case_id: str):
        try:
            _, case = STORE.load_case(case_id)
        except (KeyError, FileNotFoundError) as e:
            raise HTTPException(404, str(e))
        return case.viewer_json()

    @app.post("/api/cases/upload")
    async def upload_case(files: list[UploadFile]):
        folder = OUT_DIR / "uploads" / uuid.uuid4().hex[:8]
        folder.mkdir(parents=True, exist_ok=True)
        n = 0
        for f in files:
            name = Path(f.filename or "").name
            if not name.lower().endswith(".stl") or not Path(name).stem.isdigit():
                continue
            (folder / name).write_bytes(await f.read())
            n += 1
        if n == 0:
            raise HTTPException(400, "upload per-tooth STL files named <tooth_id>.stl (Universal numbering, upper arch)")
        case = Case.from_dir(folder)
        cid = f"upload-{folder.name}"
        STORE.add_case(cid, case)
        return {"case_id": cid, "n_teeth": len(case.ids), "crowding_mm": planner.crowding_mm(case)}

    @app.get("/api/plans")
    async def list_plans():
        return {"plans": [_summary(pid) for pid in reversed(list(STORE.plans))]}

    @app.get("/api/plans/{plan_id}")
    async def get_plan(plan_id: str):
        if plan_id not in STORE.plans:
            raise HTTPException(404, f"unknown plan {plan_id}")
        return STORE.plan_json(plan_id)

    @app.get("/api/plans/{plan_id}/stl.zip")
    async def plan_stl(plan_id: str):
        p = STORE.plans.get(plan_id)
        if p is None:
            raise HTTPException(404, f"unknown plan {plan_id}")
        _, case = STORE.load_case(p["case_id"])
        path = OUT_DIR / "stl" / f"{plan_id}.zip"
        if not path.exists():
            planner.export_zip(case, p["stages"], str(path))
        return FileResponse(str(path), media_type="application/zip", filename=f"cualign_{plan_id}_stages.zip")

    @app.post("/api/plan")
    async def rule_plan(req: RulePlanRequest):
        try:
            return rule_based_plan(req.case_id, req.allow_extraction, req.stage_cap, req.order)
        except (KeyError, FileNotFoundError, ValueError) as e:
            raise HTTPException(400, str(e))

    if STATIC_DIR.exists():
        app.mount("/ui", StaticFiles(directory=str(STATIC_DIR), html=True), name="ui")
