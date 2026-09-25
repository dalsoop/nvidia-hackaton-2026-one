"""NAT planning tools over the shared, constraint-preserving calculation service."""
from __future__ import annotations
from collections.abc import AsyncGenerator
from pydantic import BaseModel, Field
from nat.builder.builder import Builder
from nat.builder.function import FunctionGroup
from nat.cli.register_workflow import register_function_group
from nat.data_models.function import FunctionGroupBaseConfig

from cualign.agent import nim_stream_patch, react_patch, reviewer  # register the bounded reviewer
from cualign.server import rails_middleware  # noqa: F401  register the Guardrails workflow middleware
from cualign.agent.context import CURRENT_RUN
from cualign.core import limits as L, planner
from cualign.core.constraints import Constraints, ConstraintPatch
from cualign.core.service import PlanningService
from cualign.core.store import OUT_DIR, STORE

react_patch.apply()
nim_stream_patch.apply()


class NoInput(BaseModel):
    unused: str = ""


class CaseInput(BaseModel):
    case_id: str | None = None


class StrategyInput(BaseModel):
    strategy: str = Field(description="expansion | ipr | expansion_ipr | extraction")


class PlanInput(BaseModel):
    target_id: str


class PlanIdInput(BaseModel):
    plan_id: str


class CompareInput(BaseModel):
    allowed: list[str] | None = Field(default=None, description="Optional strategy subset; confirmed constraints always apply")


class CuAlignToolConfig(FunctionGroupBaseConfig, name="cualign"):
    include: list[str] = Field(default_factory=lambda: [
        "clinical_limits", "list_cases", "load_case", "get_constraints", "set_constraints",
        "propose_target", "plan_stages", "validate", "compare_strategies", "select_plan", "export_stl", "get_plan"])


def current_case(case_id=None):
    run = CURRENT_RUN.get()
    if run:
        if run.closed or (case_id is not None and case_id != run.case_id):
            raise ValueError("use the case selected in the current request")
        case_id = run.case_id
    return STORE.load_case(case_id)


def constraints_for(case_id):
    run = CURRENT_RUN.get()
    return run.constraints if run else STORE.constraints_for(case_id)


def owned_plan(plan_id, *, generated=False):
    p = STORE.plans[plan_id]
    run = CURRENT_RUN.get()
    if run and (run.closed or p["case_id"] != run.case_id or
                plan_id not in (run.plan_ids if generated else run.plan_ids | {run.base_plan_id})):
        raise ValueError("plan is not part of the current request")
    return p


def summary(pid):
    p = STORE.plan_json(pid)
    return {k: v for k, v in p.items() if k != "stages"}


@register_function_group(config_type=CuAlignToolConfig)
async def cualign(config: CuAlignToolConfig, _builder: Builder) -> AsyncGenerator[FunctionGroup, None]:
    group = FunctionGroup(config=config)
    service = PlanningService(STORE)

    async def _clinical_limits(inp: NoInput) -> dict:
        """PoC 계산 한계와 단위를 읽는다. 임상 판단이나 의사 승인이 아니다."""
        return {"max_linear_mm_per_aligner": L.MAX_LINEAR_PER_ALIGNER,
                "ipr_max_mm_per_surface": L.IPR_PER_SURFACE,
                "max_expansion_mm_per_side": L.MAX_EXPANSION_PER_SIDE,
                "wear_days_per_aligner": L.WEAR_DAYS, "strategies": list(L.STRATEGIES)}

    async def _list_cases(inp: NoInput) -> dict:
        """사용 가능한 케이스와 현재 선택 케이스를 읽는다."""
        run = CURRENT_RUN.get()
        return {"cases": STORE.available_cases(), "active": run.case_id if run else STORE.active_case}

    async def _load_case(inp: CaseInput) -> dict:
        """화면에서 선택한 케이스를 읽는다. 다른 케이스로 임의 전환할 수 없다.
        unsupported 가 비어 있지 않으면 이 케이스는 계획하지 말고 그 이유를 의사에게 그대로 전한다."""
        cid, case = current_case(inp.case_id)
        return {"case_id": cid, "teeth": case.ids, "n_teeth": len(case.ids),
                "crowding_mm": planner.crowding_mm(case), "constraints": constraints_for(cid).model_dump(mode="json"),
                "unsupported": planner.unsupported_reasons(case)}

    async def _get_constraints(inp: NoInput) -> dict:
        """확정 조건을 읽는다. 비교·수정 시 이 조건을 유지한다."""
        cid, _ = current_case()
        return constraints_for(cid).model_dump(mode="json")

    async def _set_constraints(inp: ConstraintPatch) -> dict:
        """사용자가 명시적으로 변경한 조건만 전달한다. null과 생략은 모두 유지를 뜻한다. []는 치아 목록 해제, clear_stage_cap:true는 기간 상한 해제. IPR 한도는 면당 mm."""
        cid, case = current_case()
        run = CURRENT_RUN.get()
        current = constraints_for(cid)
        c = current.patched(inp.changes())
        # Re-stating the same conditions mid-loop is harmless; only a real change after targets
        # exist would make the computed plans disagree with the stored constraints.
        if c == current:
            return c.model_dump(mode="json")
        if run and run.target_ids:
            # Refuse the change, but as a normal result: raising here reads as "you called me
            # wrong", so the agent retries with new arguments until it runs out of iterations.
            # The conditions are unchanged either way — this only stops the retry loop and lets
            # the agent tell the dentist which change it could not apply.
            return {**current.model_dump(mode="json"), "rejected": inp.changes(),
                    "note": "이번 요청의 조건은 이미 확정됐습니다. 현재 조건으로 계획을 마치고, "
                            "반영하지 못한 변경은 최종 답변에서 의사에게 알리세요."}
        c.check_case(case.ids)
        STORE.case_constraints[cid] = c
        if run:
            run.constraints = c
        return c.model_dump(mode="json")

    async def _propose_target(inp: StrategyInput) -> dict:
        """확정 조건으로 목표를 생성한다. 조건 변경은 먼저 set_constraints로 처리한다."""
        cid, _ = current_case()
        tid = service.target(cid, inp.strategy, constraints_for(cid))
        run = CURRENT_RUN.get()
        if run:
            run.target_ids.add(tid)
        t = STORE.targets[tid]
        return {"target_id": tid, "case_id": cid, "constraints": t["constraints"].model_dump(mode="json"), **t["info"]}

    async def _plan_stages(inp: PlanInput) -> dict:
        """목표에 저장된 조건으로 단계 생성과 검증을 수행한다. 수정은 선택된 부모 계획을 보존한다."""
        run = CURRENT_RUN.get()
        if run and (run.closed or inp.target_id not in run.target_ids):
            raise ValueError("target is not part of this request")
        pid = service.stages(inp.target_id, run.base_plan_id if run else None)
        if run:
            run.plan_ids.add(pid)
        return summary(pid)

    async def _validate(inp: PlanIdInput) -> dict:
        """계획에 저장된 동일 조건으로 재검증한다. 조건을 생략해 상한을 지울 수 없다."""
        owned_plan(inp.plan_id)
        service.validate(inp.plan_id)
        return summary(inp.plan_id)

    async def _compare_strategies(inp: CompareInput) -> dict:
        """확정된 비발치·고정·IPR·기간·순서를 모두 유지하면서 허용 전략을 비교한다."""
        cid, _ = current_case()
        run = CURRENT_RUN.get()
        ids = service.compare(cid, constraints_for(cid), inp.allowed, run.base_plan_id if run else None)
        if run:
            run.plan_ids.update(ids)
            run.target_ids.update(STORE.plans[pid]["target_id"] for pid in ids)
        return {"case_id": cid, "constraints": constraints_for(cid).model_dump(mode="json"),
                "plans": [summary(pid) for pid in ids]}

    async def _select_plan(inp: PlanIdInput) -> dict:
        """최종 제시할 계획을 선택한다. 후보 생성 순서와 무관하게 이 계획이 3D·카드·다운로드에 표시된다. 이후 reviewer를 호출한다."""
        owned_plan(inp.plan_id, generated=True)
        run = CURRENT_RUN.get()
        if run:
            if run.selected_plan_id and run.selected_plan_id != inp.plan_id:
                raise ValueError("a final plan is already selected in this request")
            run.selected_plan_id = inp.plan_id
        return {"type": "plan_selected", **summary(inp.plan_id)}

    async def _export_stl(inp: PlanIdInput) -> dict:
        """의사가 현재 버전을 승인한 계획만 ZIP으로 내보낸다. 에이전트는 승인할 수 없다."""
        p = owned_plan(inp.plan_id)
        STORE.require_approved(inp.plan_id)
        _, case = STORE.load_case(p["case_id"])
        path = OUT_DIR / "stl" / f"{inp.plan_id}.zip"
        planner.export_zip(case, p["stages"], str(path))
        return {"plan_id": inp.plan_id, "download_url": f"/api/plans/{inp.plan_id}/stl.zip"}

    async def _get_plan(inp: PlanIdInput) -> dict:
        """읽기 전용: 계획 조건·부모 이력·규칙 위반·검토·승인 상태를 조회한다."""
        owned_plan(inp.plan_id)
        return summary(inp.plan_id)

    fns = {"clinical_limits": _clinical_limits, "list_cases": _list_cases, "load_case": _load_case,
           "get_constraints": _get_constraints, "set_constraints": _set_constraints,
           "propose_target": _propose_target, "plan_stages": _plan_stages, "validate": _validate,
           "compare_strategies": _compare_strategies, "select_plan": _select_plan,
           "export_stl": _export_stl, "get_plan": _get_plan}
    for name in config.include:
        group.add_function(name=name, fn=fns[name], description=fns[name].__doc__)
    yield group
