"""Artifact API. Approval is checked on every export, including cached files."""
from __future__ import annotations
import uuid
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from cualign.agent.reviewer import MANUAL_RETRY
from cualign.core import Case, planner
from cualign.core.constraints import ConstraintPatch
from cualign.core.service import PlanningService
from cualign.core.store import OUT_DIR, STORE

STATIC_DIR = Path(__file__).resolve().parent / "static"


class RulePlanRequest(ConstraintPatch):
    case_id: str | None = None
    parent_plan_id: str | None = None


class ApprovalRequest(BaseModel):
    confirmed: bool = False


def _summary(pid):
    p = STORE.plan_json(pid)
    return {"plan_id": pid, "case_id": p["case_id"], "parent_plan_id": p["parent_plan_id"],
            "strategy": p["strategy"], "n_stages": p["info"]["n_stages"], "months": p["info"]["months"],
            "passed": p["passed"], "violations": len(p["violations"]), "by_type": planner.summarize(p["violations"]),
            "constraints": p["constraints"], "review": p["review"], "approval": p["approval"]}


def rule_based_plan(case_id=None, allow_extraction=None, stage_cap=None, order=None, *,
                    changes=None, parent_plan_id=None):
    cid, case = STORE.load_case(case_id)
    why = planner.unsupported_reasons(case)
    if why:
        return {"case_id": cid, "chosen": None, "unsupported": why, "tried": []}
    c = STORE.constraints_for(cid, parent_plan_id)
    if changes is None:
        changes = {"stage_cap": stage_cap}
        if allow_extraction is not None:
            changes["allow_extraction"] = allow_extraction
        if order is not None:
            changes["order"] = order
    c = c.patched(changes)
    c.check_case(case.ids)
    service = PlanningService(STORE)
    ids = service.compare(cid, c, parent_plan_id=parent_plan_id)
    STORE.case_constraints[cid] = c
    for pid in ids:
        STORE.set_review(pid, {"status": "skipped", "attempts": 0,
                              "message": "규칙 폴백 — 검토 에이전트 미실행", "error": None})
    tried = [_summary(pid) for pid in ids]
    chosen = next((p for p in tried if p["passed"]), None)
    result = {"case_id": cid, "chosen": chosen, "tried": tried}
    if chosen is None:
        result["best_failed"] = min(tried, key=lambda p: (p["violations"], STORE.plans[p["plan_id"]]["info"]["space_deficit_mm"]))
    return result


def add_api_routes(app: FastAPI, review=None):
    """`review(plan_id)` runs the bounded reviewer outside a chat request: the dentist's «검토 다시 요청», and the
    chat stream's fallback when the agent skipped the reviewer (plan_events.py reads it from app.state).
    None when no reviewer model is wired."""
    app.state.cualign_review = review
    @app.get("/", include_in_schema=False)
    async def root():
        return RedirectResponse(url="/ui/")

    @app.get("/api/cases")
    async def list_cases():
        return {"cases": STORE.available_cases(), "active": STORE.active_case}

    @app.post("/api/cases/{case_id}/activate")
    async def activate_case(case_id: str):
        try:
            cid, case = STORE.load_case(case_id)
        except (KeyError, FileNotFoundError) as e:
            raise HTTPException(404, str(e))
        return {"case_id": cid, "n_teeth": len(case.ids), "crowding_mm": planner.crowding_mm(case),
                "constraints": STORE.constraints_for(cid).model_dump(mode="json")}

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
            if not name.lower().endswith(".stl") or not (Path(name).stem.isdigit() or name.lower() == "gingiva.stl"):
                continue
            (folder / name).write_bytes(await f.read())
            n += Path(name).stem.isdigit()
        if n == 0:   # gingiva.stl alone is display-only; there is nothing to plan
            raise HTTPException(400, "upload per-tooth STL files named <tooth_id>.stl (Universal numbering, upper arch)")
        case = Case.from_dir(folder)
        cid = f"upload-{folder.name}"
        STORE.add_case(cid, case)
        return {"case_id": cid, "n_teeth": len(case.ids), "crowding_mm": planner.crowding_mm(case)}

    @app.get("/api/plans")
    async def list_plans(case_id: str | None = None):
        return {"plans": [_summary(pid) for pid in reversed(list(STORE.plans))
                          if case_id is None or STORE.plans[pid]["case_id"] == case_id]}

    def require_plan(pid):
        if pid not in STORE.plans:
            raise HTTPException(404, f"unknown plan {pid}")
        return STORE.plans[pid]

    @app.get("/api/plans/{plan_id}")
    async def get_plan(plan_id: str):
        require_plan(plan_id)
        return STORE.plan_json(plan_id)

    @app.post("/api/plans/{plan_id}/approval")
    async def approve_plan(plan_id: str, req: ApprovalRequest):
        require_plan(plan_id)
        if not req.confirmed:
            raise HTTPException(400, "의사의 명시적 확인이 필요합니다.")
        try:
            return STORE.approve(plan_id)
        except ValueError as e:
            raise HTTPException(409, str(e))

    @app.post("/api/plans/{plan_id}/review")
    async def request_review(plan_id: str):
        # Recovery for a plan the agent left unreviewed (skipped the call) or whose review failed.
        p = require_plan(plan_id)
        if review is None:
            raise HTTPException(503, "검토 모델이 연결되지 않았습니다.")
        if p["review"]["status"] not in MANUAL_RETRY:
            raise HTTPException(409, "미실행이거나 실패한 검토만 다시 요청할 수 있습니다.")
        await review(plan_id)
        return STORE.plan_json(plan_id)

    @app.delete("/api/plans/{plan_id}/approval")
    async def revoke_approval(plan_id: str):
        require_plan(plan_id)
        return STORE.revoke(plan_id)

    @app.get("/api/plans/{plan_id}/stl.zip")
    async def plan_stl(plan_id: str):
        p = require_plan(plan_id)
        try:
            STORE.require_approved(plan_id)
        except ValueError as e:
            raise HTTPException(409, str(e))
        _, case = STORE.load_case(p["case_id"])
        path = OUT_DIR / "stl" / f"{plan_id}.zip"
        # Regenerate from the approved snapshot; a stale file cannot bypass approval.
        planner.export_zip(case, p["stages"], str(path))
        return FileResponse(str(path), media_type="application/zip", filename=f"cualign_{plan_id}_stages.zip")

    @app.post("/api/plan")
    async def rule_plan(req: RulePlanRequest):
        try:
            patch = req.model_dump(exclude={"case_id", "parent_plan_id"})
            changes = ConstraintPatch.model_validate(patch).changes()
            return rule_based_plan(req.case_id, changes=changes, parent_plan_id=req.parent_plan_id)
        except (KeyError, FileNotFoundError, ValueError) as e:
            raise HTTPException(400, str(e))

    if STATIC_DIR.exists():
        app.mount("/ui", StaticFiles(directory=str(STATIC_DIR), html=True), name="ui")
