"""cuAlign tools as a NeMo Agent Toolkit function group (`cualign`).

The LLM drives the loop with these tools (names carry the `cualign__` prefix at runtime):

  clinical_limits()                          clinical limits table (no data needed)
  list_cases()                               synthetic presets + loaded scan
  load_case(case_id)                         make a case active; returns crowding estimate
  propose_target(strategy, ipr_exclude, lock) -> target_id
  plan_stages(target_id, order)              -> plan_id, n_stages, months
  validate(plan_id, stage_cap)               -> passed, violations, by_type, sample
  compare_strategies(allowed, stage_cap, order)  side-by-side table, one plan_id per strategy
  export_stl(plan_id)                        zip of per-stage STL files (download path)

NAT rule: each tool is an async fn with exactly one type-annotated argument (a pydantic model
defined at module level) and a return annotation.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from pydantic import BaseModel, Field

from nat.builder.builder import Builder
from nat.builder.function import FunctionGroup
from nat.cli.register_workflow import register_function_group
from nat.data_models.function import FunctionGroupBaseConfig

from cualign.agent import react_patch
from cualign.core import limits as L
from cualign.core import planner
from cualign.core.store import OUT_DIR, STORE

react_patch.apply()   # NAT react_agent: JSON-wrapped ReAct block must not leak as the final answer


class NoInput(BaseModel):
    unused: str = Field(default="", description="ignored; pass an empty string")


class CaseInput(BaseModel):
    case_id: str | None = Field(default=None, description="one of list_cases(): aligned | mild | moderate | severe | extraction | scan. "
                                "Omit (null) to use the case the dentist selected in the UI.")


class StrategyInput(BaseModel):
    strategy: str = Field(description="expansion | ipr | expansion_ipr | extraction")
    ipr_exclude: list[int] = Field(default_factory=list, description="tooth ids to exclude from IPR (e.g. incisors 7,8,9,10)")
    lock: list[int] = Field(default_factory=list, description="tooth ids that must not move (anchor the arrangement)")


class PlanInput(BaseModel):
    target_id: str = Field(description="id returned by propose_target")
    order: str = Field(default="simultaneous", description="simultaneous | anterior_first | sequential")


class ValidateInput(BaseModel):
    plan_id: str = Field(description="id returned by plan_stages")
    stage_cap: int | None = Field(default=None, description="max aligners allowed; months*30.4/7 when a time limit is given")


class CompareInput(BaseModel):
    allowed: list[str] = Field(default_factory=lambda: list(L.STRATEGIES), description="strategies to compare")
    stage_cap: int | None = Field(default=None, description="max aligners allowed")
    order: str = Field(default="simultaneous", description="simultaneous | anterior_first | sequential")


class ExportInput(BaseModel):
    plan_id: str = Field(description="plan to export as per-stage STL zip")


class PlanIdInput(BaseModel):
    plan_id: str = Field(description="plan id such as p3")


class CuAlignToolConfig(FunctionGroupBaseConfig, name="cualign"):
    include: list[str] = Field(default_factory=lambda: ["clinical_limits", "list_cases", "load_case", "propose_target",
                                                        "plan_stages", "validate", "compare_strategies", "export_stl", "get_plan"])


@register_function_group(config_type=CuAlignToolConfig)
async def cualign(config: CuAlignToolConfig, _builder: Builder) -> AsyncGenerator[FunctionGroup, None]:
    group = FunctionGroup(config=config)

    async def _clinical_limits(inp: NoInput) -> dict:
        """투명교정 임상 한계 표(A등급 문헌). 계획 전에 한 번 읽고, 위반 리포트를 해석할 때 참조한다."""
        del inp
        return {"max_linear_mm_per_aligner": L.MAX_LINEAR_PER_ALIGNER, "ipr_mm_per_surface": L.IPR_PER_SURFACE,
                "max_expansion_mm_per_side": L.MAX_EXPANSION_PER_SIDE, "extraction_threshold_mm": L.EXTRACTION_THRESHOLD_MM,
                "wear_days_per_aligner": L.WEAR_DAYS, "stage_cap_formula": "round(months * 30.4 / 7)",
                "strategies": list(L.STRATEGIES), "orders": ["simultaneous", "anterior_first", "sequential"],
                "sources": "MDPI Appl.Sci. 2024 staging review; Nature IJOS 2025 consensus; Align Technology 2016"}

    async def _list_cases(inp: NoInput) -> dict:
        """사용 가능한 케이스 목록(합성 프리셋 + 스캔) 과 화면에서 선택된 케이스(active)."""
        del inp
        return {"cases": STORE.available_cases(), "active": STORE.active_case}

    async def _load_case(inp: CaseInput) -> dict:
        """케이스를 활성화하고 총생(공간 부족량 mm)과 치아 수를 돌려준다. case_id 를 비우면 화면에서 선택된 케이스."""
        cid, case = STORE.load_case(inp.case_id)
        return {"case_id": cid, "teeth": case.ids, "n_teeth": len(case.ids),
                "crowding_mm": planner.crowding_mm(case),
                "baseline_overlap_mm3": round(sum(case.baseline.values()), 2)}

    async def _propose_target(inp: StrategyInput) -> dict:
        """전략(expansion | ipr | expansion_ipr | extraction)으로 목표 치열을 만든다. target_id 와 공간 부족량을 돌려준다."""
        cid, case = STORE.load_case(None)
        target, info = planner.propose_target(case, inp.strategy, ipr_exclude=set(inp.ipr_exclude), lock=set(inp.lock))
        tid = STORE.put_target(cid, target, info)
        return {"target_id": tid, "case_id": cid, **{k: v for k, v in info.items()}}

    async def _plan_stages(inp: PlanInput) -> dict:
        """target_id 의 목표를 장당 0.25mm 한계 안에서 얼라이너 단계로 쪼갠다(order 로 순서 패턴 선택). plan_id 를 돌려준다."""
        t = STORE.targets.get(inp.target_id)
        if t is None:
            raise ValueError(f"unknown target_id {inp.target_id}")
        _, case = STORE.load_case(t["case_id"])
        stages, sinfo = planner.plan_stages(case, t["target"], order=inp.order)
        viol = planner.validate(case, stages, space_deficit_mm=t["info"]["space_deficit_mm"])
        pid = STORE.put_plan(t["case_id"], inp.target_id, stages, {**sinfo, **{"space_deficit_mm": t["info"]["space_deficit_mm"]}},
                             viol, None, t["info"]["strategy"])
        return {"plan_id": pid, "target_id": inp.target_id, "strategy": t["info"]["strategy"], **sinfo}

    async def _validate(inp: ValidateInput) -> dict:
        """plan_id 의 계획에서 공간 부족·충돌·이동 한계·장수 상한 위반을 찾는다. passed 가 true 면 규칙 통과(의사 검토 전 초안)."""
        p = STORE.plans.get(inp.plan_id)
        if p is None:
            raise ValueError(f"unknown plan_id {inp.plan_id}")
        _, case = STORE.load_case(p["case_id"])
        viol = planner.validate(case, p["stages"], stage_cap=inp.stage_cap, space_deficit_mm=p["info"].get("space_deficit_mm"))
        p["violations"] = viol
        p["stage_cap"] = inp.stage_cap
        STORE._persist(inp.plan_id)
        return {"plan_id": inp.plan_id, "strategy": p["strategy"], "passed": not viol, "violations": len(viol),
                "by_type": planner.summarize(viol), "sample": viol[:5], "n_stages": p["info"]["n_stages"],
                "months": p["info"]["months"], "viewer_url": f"/ui/?plan={inp.plan_id}"}

    async def _compare_strategies(inp: CompareInput) -> dict:
        """여러 전략을 한 번에 돌려 표로 비교한다. 전략마다 plan_id 가 만들어지므로 각각 export_stl 할 수 있다."""
        cid, case = STORE.load_case(None)
        allowed = [s for s in inp.allowed if s in L.STRATEGIES]
        rows = planner.compare_strategies(case, allowed=allowed, stage_cap=inp.stage_cap, order=inp.order)
        out = []
        for r in rows:
            tid = STORE.put_target(cid, r["_target"], r["_info"])
            pid = STORE.put_plan(cid, tid, r["_stages"], {**r["_sinfo"], "space_deficit_mm": r["_info"]["space_deficit_mm"]},
                                 r["_viol"], inp.stage_cap, r["strategy"])
            out.append({"plan_id": pid, "strategy": r["strategy"], "n_stages": r["n_stages"], "months": r["months"],
                        "passed": r["passed"], "violations": r["violations"], "by_type": r["by_type"],
                        "space_deficit_mm": r["_info"]["space_deficit_mm"], "removed": r["removed"]})
        return {"case_id": cid, "stage_cap": inp.stage_cap, "order": inp.order, "plans": out}

    async def _export_stl(inp: ExportInput) -> dict:
        """plan_id 의 단계별 치아 STL 을 zip 으로 내보낸다. 다운로드 경로를 돌려준다."""
        p = STORE.plans.get(inp.plan_id)
        if p is None:
            raise ValueError(f"unknown plan_id {inp.plan_id}")
        _, case = STORE.load_case(p["case_id"])
        path = OUT_DIR / "stl" / f"{inp.plan_id}.zip"
        planner.export_zip(case, p["stages"], str(path))
        return {"plan_id": inp.plan_id, "n_stages": len(p["stages"]), "zip": str(path),
                "download_url": f"/api/plans/{inp.plan_id}/stl.zip"}

    async def _get_plan(inp: PlanIdInput) -> dict:
        """(읽기 전용) plan_id 의 계획을 요약한다: 전략·장수·기간·상한·공간 부족·위반 목록·가장 많이 움직이는 치아·고정/IPR 제외 치아. 검토 에이전트용."""
        import numpy as np
        p = STORE.plans.get(inp.plan_id)
        if p is None:
            raise ValueError(f"unknown plan_id {inp.plan_id}")
        stages = p["stages"]
        final = stages[-1] if stages else {}
        moves = sorted(((int(i), round(float(np.linalg.norm(v)), 2)) for i, v in final.items()), key=lambda t: -t[1])
        tinfo = (STORE.targets.get(p["target_id"]) or {}).get("info", {})
        return {"plan_id": inp.plan_id, "case_id": p["case_id"], "strategy": p["strategy"], "passed": not p["violations"],
                "n_stages": p["info"]["n_stages"], "months": p["info"]["months"], "order": p["info"].get("order"),
                "stage_cap": p["stage_cap"], "space_deficit_mm": p["info"].get("space_deficit_mm"),
                "crowding_mm": tinfo.get("crowding_mm"), "space_gain_mm": tinfo.get("space_gain_mm"),
                "notes": tinfo.get("notes", []), "removed_teeth": tinfo.get("removed", []), "locked_teeth": tinfo.get("locked", []),
                "top_moves_mm": moves[:5], "violations": p["violations"][:20], "by_type": planner.summarize(p["violations"])}

    fns = {"clinical_limits": _clinical_limits, "list_cases": _list_cases, "load_case": _load_case,
           "propose_target": _propose_target, "plan_stages": _plan_stages, "validate": _validate,
           "compare_strategies": _compare_strategies, "export_stl": _export_stl, "get_plan": _get_plan}
    for name in config.include:
        group.add_function(name=name, fn=fns[name], description=fns[name].__doc__)
    yield group
