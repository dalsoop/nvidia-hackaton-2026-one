"""Artifact API. Approval is checked on every export, including cached files."""
from __future__ import annotations
import re
import uuid
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from cualign.agent.reviewer import MANUAL_RETRY
from cualign.core import Case, patients, planner
from cualign.core.constraints import ConstraintPatch, reason_ko
from cualign.core.service import PlanningService
from cualign.core.store import OUT_DIR, STORE

STATIC_DIR = Path(__file__).resolve().parent / "static"


class RulePlanRequest(ConstraintPatch):
    case_id: str | None = None
    parent_plan_id: str | None = None


class ApprovalRequest(BaseModel):
    confirmed: bool = False


class ConfirmRequest(BaseModel):
    revision: int | None = None


class FollowupRequest(BaseModel):
    messages: list[dict] = Field(default_factory=list, max_length=200)


class PatientRequest(BaseModel):
    alias: str = Field(max_length=patients.ALIAS_MAX)
    memo: str = Field(default="", max_length=patients.MEMO_MAX)


MAX_FILE_BYTES = 60 * 1024 * 1024       # one tooth or gum STL (PoC limit)
MAX_UPLOAD_BYTES = 400 * 1024 * 1024    # one scan upload


def _scan_file_name(name: str) -> tuple[str | None, str]:
    """(stored name, kind): kind is "tooth", "gum", "lower" (FDI 31..48 lower arch, not supported) or "other".

    Accepts the legacy Universal stems (1..16) the app stored before, unchanged, and the dentist's FDI stems
    (#113) where those do not collide with a legacy one: 17·18 (upper right) and 21..28 (upper left) — 11..16 stay
    Universal, since existing scans on disk already use those names (see mirror_scan_numbers for renumbering).
    """
    name = Path(name or "").name
    if name.lower() == "gingiva.stl":
        return "gingiva.stl", "gum"
    # a tooth number is 1..49 without padding: "000018.stl" is a scan id, not tooth 18
    if not (name.lower().endswith(".stl") and re.fullmatch(r"[1-9]|[1-4]\d", Path(name).stem)):
        return None, "other"
    n = int(Path(name).stem)
    if n <= 16:            # legacy Universal upper stems, unchanged (and 11..16 read as Universal, not FDI)
        return f"{n}.stl", "tooth"
    if n in (17, 18):      # FDI upper right (quadrant 1) tail -> Universal 2, 1
        return f"{19 - n}.stl", "tooth"
    if 21 <= n <= 28:      # FDI upper left (quadrant 2) -> Universal 9..16
        return f"{n - 12}.stl", "tooth"
    if 31 <= n <= 48:      # FDI lower arch, not supported
        return None, "lower"
    return None, "lower"  # legacy Universal lower (19, 20, 29..32), not supported


def _patient_json(pid: str) -> dict:
    p = patients.get_patient(pid)
    for s in p["scans"]:
        s["plans"] = sum(1 for q in STORE.plans.values() if q["case_id"] == s["case_id"])
    return p


def _summary(pid):
    p = STORE.plan_json(pid)
    return {"plan_id": pid, "case_id": p["case_id"], "parent_plan_id": p["parent_plan_id"],
            "strategy": p["strategy"], "n_stages": p["info"]["n_stages"], "months": p["info"]["months"],
            "passed": p["passed"], "violations": len(p["violations"]), "by_type": planner.summarize(p["violations"]),
            "constraints": p["constraints"], "review": p["review"], "approval": p["approval"]}


def rule_based_plan(case_id=None, allow_extraction=None, stage_cap=None, order=None, *,
                    changes=None, parent_plan_id=None, extraction=None):
    cid, case = STORE.load_case(case_id)
    why = planner.unsupported_reasons(case)
    if why:
        return {"case_id": cid, "chosen": None, "unsupported": why, "tried": []}
    c = STORE.constraints_for(cid, parent_plan_id)
    if changes is None:
        changes = {"stage_cap": stage_cap}
        if extraction is not None:            # the prescribed teeth (#56); [] = non-extraction
            changes["extraction"] = list(extraction)
        elif allow_extraction is not None:    # legacy: false clears, true needs the teeth already prescribed
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
    return _rule_plan_result(cid, ids)


def _constraint_dump(record: dict) -> dict:
    constraints = record["constraints"]
    if isinstance(constraints, dict):
        return constraints
    return constraints.model_dump(mode="json")


def ensure_case_plan(case_id: str) -> dict | None:
    """Build this case's stages from its own mesh and prescription. Another case's plan is never reused.

    The planner rebuilds that case's whole trajectory. A prescription change starts a child plan of this case only.
    """
    current = STORE.constraints_for(case_id)
    existing = STORE.plan_ids_for(case_id)
    if not existing:
        return rule_based_plan(case_id)
    latest = existing[-1]
    if _constraint_dump(STORE._record(latest)) == current.model_dump(mode="json"):
        return None
    return rule_based_plan(case_id, changes=current.model_dump(mode="json"), parent_plan_id=latest)


def _rule_plan_result(cid, ids):
    tried = [_summary(pid) for pid in ids]
    chosen = next((p for p in tried if p["passed"]), None)
    result = {"case_id": cid, "chosen": chosen, "tried": tried}
    if chosen is None:
        result["best_failed"] = min(tried, key=lambda p: (p["violations"], STORE._record(p["plan_id"])["info"]["space_deficit_mm"]))
    return result


def add_api_routes(app: FastAPI, review=None, followup=None):
    """`review(plan_id)` runs the bounded reviewer outside a chat request: the dentist's «검토 다시 요청», and the
    chat stream's fallback when the agent skipped the reviewer (plan_events.py reads it from app.state).
    None when no reviewer model is wired. `followup(messages)` writes the question card shown after each agent turn
    (#90); None means no cards."""
    app.state.cualign_review = review

    @app.post("/api/followup")
    async def next_followup(req: FollowupRequest):
        """{"question": {...}} or {"question": null}: the card is optional, so this never fails the screen."""
        if followup is None:
            return {"question": None}
        return {"question": await followup(req.messages)}

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
        try:
            ensure_case_plan(cid)
        except ValueError as e:
            raise HTTPException(400, str(e))
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

    @app.get("/api/patients")
    async def list_patients():
        return {"patients": [{**p, "n_scans": len(p["scans"])} for p in patients.list_patients()]}

    @app.post("/api/patients")
    async def create_patient(req: PatientRequest):
        try:
            return patients.create_patient(req.alias, req.memo)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/patients/{pid}")
    async def get_patient(pid: str):
        try:
            return _patient_json(pid)
        except KeyError as e:
            raise HTTPException(404, str(e))

    @app.post("/api/patients/{pid}/scans")
    async def upload_patient_scan(pid: str, files: list[UploadFile]):
        data, other, lower, total = {}, [], [], 0
        for f in files:
            name, kind = _scan_file_name(f.filename)
            if kind == "lower":
                lower.append(Path(f.filename).name)
                continue
            if name is None:
                if (f.filename or "").lower().endswith((".stl", ".ply", ".obj")):
                    other.append(Path(f.filename).name)
                continue
            if name in data:
                raise HTTPException(400, f"{name}: 같은 번호의 파일이 두 개 있습니다.")
            blob = await f.read(MAX_FILE_BYTES + 1)
            total += len(blob)
            if len(blob) > MAX_FILE_BYTES or total > MAX_UPLOAD_BYTES:
                raise HTTPException(413, f"파일이 너무 큽니다(파일당 {MAX_FILE_BYTES >> 20}MB, 한 번에 {MAX_UPLOAD_BYTES >> 20}MB까지).")
            data[name] = blob
        if lower:
            raise HTTPException(400, f"{', '.join(lower[:3])}: 하악(FDI 31~48) 번호입니다. 지금은 상악 스캔만 받습니다.")
        if other and not any(Path(n).stem.isdigit() for n in data):
            raise HTTPException(400, f"{', '.join(other[:3])}: 한 덩어리 악궁 스캔으로 보입니다. 지금은 치아별로 나뉜 파일"
                                     "(11.stl … 27.stl, 선택 gingiva.stl)만 받습니다. 자동 치아 분리는 실험 단계입니다.")
        try:
            scan = patients.add_scan(pid, data)
        except KeyError as e:
            raise HTTPException(404, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))
        try:
            STORE.cases.pop(scan["case_id"], None)
            _, case = STORE.load_case(scan["case_id"])
        except Exception as e:  # unreadable for the planner: do not keep the scan
            patients.remove_scan(pid, scan["scan_id"])
            STORE.forget_case(scan["case_id"])
            raise HTTPException(400, f"스캔을 읽지 못했습니다: {type(e).__name__}")
        return {**scan, "check": _check(scan["case_id"], case)}

    def _check(case_id, case):
        out = {"case_id": case_id, **planner.intake_report(case)}
        m = patients._CASE_RE.match(case_id)
        if m and patients.case_folder(case_id) is not None:
            sc = patients._scan(patients.get_patient(m.group(1)), m.group(2))
            out.update(orientation=sc.get("orientation"), revision=sc.get("revision", 1),
                       confirmed=sc.get("confirmed_revision") == sc.get("revision", 1),
                       confirmed_at=sc.get("confirmed_at") if sc.get("confirmed_revision") == sc.get("revision", 1) else None)
        return out

    def _patient_scan(pid, sid):
        try:
            patients._scan(patients.get_patient(pid), sid)
        except KeyError as e:
            raise HTTPException(404, str(e))

    @app.get("/api/cases/{case_id}/check")
    async def case_check(case_id: str):
        try:
            _, case = STORE.load_case(case_id)
        except (KeyError, FileNotFoundError) as e:
            raise HTTPException(404, str(e))
        return _check(case_id, case)

    @app.post("/api/patients/{pid}/scans/{sid}/confirm")
    async def confirm_scan(pid: str, sid: str, req: ConfirmRequest | None = None):
        _patient_scan(pid, sid)
        _, case = STORE.load_case(f"{pid}-{sid}")
        if planner.unsupported_reasons(case):
            raise HTTPException(409, "지원하지 않는 스캔은 계획용으로 확인할 수 없습니다.")
        try:
            return patients.confirm_scan(pid, sid, req.revision if req else None)
        except ValueError as e:
            raise HTTPException(409, str(e))

    @app.post("/api/patients/{pid}/scans/{sid}/mirror")
    async def mirror_scan(pid: str, sid: str):
        _patient_scan(pid, sid)
        patients.mirror_scan_numbers(pid, sid)
        case_id = f"{pid}-{sid}"
        for plan_id, plan in STORE.plans.items():      # plans of the old numbering stay as history, never approved
            if plan["case_id"] == case_id and plan["approval"]:
                plan["approval"] = None
                STORE._persist(plan_id)
        STORE.cases.pop(case_id, None)       # the numbers changed: reload from disk
        _, case = STORE.load_case(case_id)
        return _check(case_id, case)

    @app.delete("/api/patients/{pid}/scans/{sid}")
    async def delete_scan(pid: str, sid: str):
        _patient_scan(pid, sid)
        STORE.forget_case(patients.remove_scan(pid, sid))    # with its plans, targets and files
        return _patient_json(pid)

    @app.delete("/api/patients/{pid}")
    async def delete_patient(pid: str):
        try:
            case_ids = patients.delete_patient(pid)
        except KeyError as e:
            raise HTTPException(404, str(e))
        plans = sum(len(STORE.forget_case(c)) for c in case_ids)
        return {"deleted": pid, "scans": len(case_ids), "plans": plans}

    @app.get("/api/plans")
    async def list_plans(case_id: str | None = None):
        return {"plans": [_summary(pid) for pid in reversed(list(STORE.plans))
                          if case_id is None or STORE._record(pid)["case_id"] == case_id]}

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
        models = planner.export_print_models(case, p["stages"], str(path), p["case_id"])
        note = f"{models['status']}; files={models['n_files']}" + (f"; reason={models['reason']}" if models.get("reason") else "")
        return FileResponse(str(path), media_type="application/zip", filename=f"cualign_{plan_id}_stages.zip",
                            headers={"X-Cualign-Print-Models": note})

    @app.post("/api/plan")
    async def rule_plan(req: RulePlanRequest):
        try:
            patch = req.model_dump(exclude={"case_id", "parent_plan_id"})
            changes = ConstraintPatch.model_validate(patch).changes()
            return rule_based_plan(req.case_id, changes=changes, parent_plan_id=req.parent_plan_id)
        except (KeyError, FileNotFoundError, ValueError) as e:
            raise HTTPException(400, reason_ko(e) if isinstance(e, ValueError) else str(e))

    if STATIC_DIR.exists():
        app.mount("/ui", StaticFiles(directory=str(STATIC_DIR), html=True), name="ui")
