"""직접 이동 routes (core/manual.py behind them): 처음부터 수동 배치 from the scan, the check while dragging, 적용 as a new
target, and staging that target without the agent. Added by api.add_api_routes, which passes the target helpers it
shares with GET …/targets/{id} and the store as a getter (tests swap api.STORE)."""
from __future__ import annotations

from typing import Callable

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from cualign.core import manual
from cualign.core.constraints import reason_ko
from cualign.core.service import PlanningService


class ToothPose(BaseModel):
    d: list[float] = Field(min_length=3, max_length=3)   # total translation from the scan, mm (world)
    yaw: float = 0.0                                      # total turn about the crown's vertical axis, degrees


class ManualEditRequest(BaseModel):
    """The crowns the dentist moved by hand (Universal numbers; the screen converts from FDI). Others keep the base."""
    teeth: dict[int, ToothPose] = Field(default_factory=dict, max_length=32)


class TargetStagesRequest(BaseModel):
    parent_plan_id: str | None = None


def add_manual_routes(app: FastAPI, *, store: Callable, require_target: Callable, target_view: Callable, summary: Callable):
    def _edited(case_id: str, target_id: str, req: ManualEditRequest):
        S = store()
        t = require_target(case_id, target_id)
        _, case = S.load_case(case_id)
        try:
            S.require_current_input(case_id, t.get("input_revision"))   # the scan may have changed since
            new, changed = manual.apply_edits(t["target"], {i: p.model_dump() for i, p in req.teeth.items()}, t["constraints"])
        except ValueError as e:
            raise HTTPException(400, reason_ko(e))
        return t, case, new, changed

    @app.post("/api/cases/{case_id}/targets/scan")
    async def scan_target(case_id: str):
        """처음부터 수동 배치: a target with every crown where the scan has it (the case's confirmed conditions: the
        prescribed extraction teeth removed, only prescribed IPR cut; strategy "manual", info.source "scan"), to move by
        hand with …/check and …/manual. Stored, not put in the flow (only an applied edit is). Answers as GET …/targets/{id}."""
        S = store()
        try:
            cid, case = S.load_case(case_id)
            S.require_current_input(cid)
            constraints = S.constraints_for(cid)
            target, info = manual.scan_start(case, constraints)
        except (KeyError, FileNotFoundError) as e:
            raise HTTPException(404, str(e))
        except ValueError as e:
            raise HTTPException(400, reason_ko(e))
        return target_view(cid, S.put_target(cid, target, info, constraints))

    @app.post("/api/cases/{case_id}/targets/{target_id}/check")
    async def check_manual(case_id: str, target_id: str, req: ManualEditRequest):
        """직접 이동 while dragging: the edited arrangement is checked, not stored. {max_move_mm, max_yaw_deg, min_stages,
        min_months, overlaps: [{teeth, overlap_mm3}], changed: [teeth]} (see core/manual.check)."""
        t, case, new, changed = _edited(case_id, target_id, req)
        return {**manual.check(case, new, t["info"]), "changed": changed}

    @app.post("/api/cases/{case_id}/targets/{target_id}/manual")
    async def save_manual(case_id: str, target_id: str, req: ManualEditRequest):
        """직접 이동 적용: a new target from this one with the crowns moved by hand (info.source "manual",
        parent_target_id, manual_teeth). It becomes the case's target in the flow, so the next stages turn (or
        …/stages) stages it. Answers as GET …/targets/{new id}."""
        S = store()
        t, case, new, changed = _edited(case_id, target_id, req)
        if not changed:
            raise HTTPException(400, "옮긴 치아가 없습니다.")
        info = manual.manual_info(t["info"], target_id, changed, t["info"].get("manual_teeth", ()))
        tid = S.put_target(case_id, new, info, t["constraints"])
        S.set_flow(case_id, "target", constraints=t["constraints"], target_id=tid, plan_id=None)
        return target_view(case_id, tid)

    @app.post("/api/cases/{case_id}/targets/{target_id}/stages")
    async def stage_target(case_id: str, target_id: str, req: TargetStagesRequest):
        """This target staged and validated without the agent (a hand-edited target's 「에이전트 없이 단계 계산」): one
        plan, review marked not run, the flow at stages with it. Answers as a row of GET /api/plans."""
        S = store()
        require_target(case_id, target_id)
        try:
            pid = PlanningService(S).stages(target_id, req.parent_plan_id)
        except ValueError as e:
            raise HTTPException(400, reason_ko(e))
        S.set_review(pid, {"status": "skipped", "attempts": 0, "message": "에이전트 없이 계산 — 검토 에이전트 미실행", "error": None})
        t = S.targets[target_id]
        S.set_flow(case_id, "stages", constraints=t["constraints"], target_id=target_id, plan_id=pid)
        return summary(pid)
