"""One constraint-preserving calculation path for API and agent tools."""
from . import patients, planner
from .constraints import Constraints
from .limits import STRATEGIES
from .planner import FIRST_PREMOLARS


class PlanningService:
    def __init__(self, store):
        self.store = store

    def target(self, case_id, strategy, constraints: Constraints):
        if patients.is_confirmed(case_id) is False:
            # every planning path (agent tools, comparison, rule fallback) creates targets here
            raise ValueError("입력 확인 전 스캔입니다. 입력 확인 화면에서 치아 번호와 방향을 확인한 뒤 계획하세요.")
        _, case = self.store.load_case(case_id)
        target, info = planner.propose_target(case, strategy, constraints=constraints)
        return self.store.put_target(case_id, target, info, constraints)

    def stages(self, target_id, parent_plan_id=None):
        t = self.store.targets[target_id]
        _, case = self.store.load_case(t["case_id"])
        c = t["constraints"]
        stages, info = planner.plan_stages(case, t["target"], order=c.order)
        violations = planner.validate(case, stages, space_deficit_mm=t["info"]["space_deficit_mm"],
                                      constraints=c, target_info=t["info"])
        return self.store.put_plan(t["case_id"], target_id, stages,
            {**info, "space_deficit_mm": t["info"]["space_deficit_mm"]}, violations,
            c.stage_cap, t["info"]["strategy"], constraints=c, parent_plan_id=parent_plan_id)

    def validate(self, plan_id):
        p = self.store.plans[plan_id]
        _, case = self.store.load_case(p["case_id"])
        c = p["constraints"]
        info = self.store.targets[p["target_id"]]["info"]
        violations = planner.validate(case, p["stages"], space_deficit_mm=info["space_deficit_mm"],
                                      constraints=c, target_info=info)
        # Approval is invalidated on any changed validation outcome.
        if violations != p["violations"]:
            p["violations"] = violations
            p["approval"] = None
            self.store._persist(plan_id)
        return self.store.plan_json(plan_id)

    def compare(self, case_id, constraints, allowed=None, parent_plan_id=None):
        self.store.constraints_for(case_id, parent_plan_id)  # validate parent before creating anything
        strategies = list(allowed if allowed is not None else STRATEGIES)
        if not strategies or any(s not in STRATEGIES for s in strategies):
            raise ValueError("choose valid strategies")
        ids = []
        for strategy in dict.fromkeys(strategies):
            if strategy == "extraction" and (not constraints.allow_extraction or set(constraints.lock) & set(FIRST_PREMOLARS)):
                continue
            tid = self.target(case_id, strategy, constraints)
            ids.append(self.stages(tid, parent_plan_id))
        if not ids:
            raise ValueError("no strategy is allowed by the confirmed constraints")
        return ids
