"""One constraint-preserving calculation path for API and agent tools."""
from . import planner
from .constraints import Constraints
from .limits import STRATEGIES
from .planner import strategies_for


class PlanningService:
    def __init__(self, store):
        self.store = store

    def target(self, case_id, strategy, constraints: Constraints):
        self.store.require_current_input(case_id)   # every planning path (tools, comparison, fallback) starts here
        _, case = self.store.load_case(case_id)
        target, info = planner.propose_target(case, strategy, constraints=constraints)
        return self.store.put_target(case_id, target, info, constraints)

    def stages(self, target_id, parent_plan_id=None):
        t = self.store.targets[target_id]
        self.store.require_current_input(t["case_id"], t.get("input_revision"))   # the scan may have changed since
        _, case = self.store.load_case(t["case_id"])
        c = t["constraints"]
        stages, info = planner.plan_stages(case, t["target"], order=c.order)
        violations = planner.validate(case, stages, space_deficit_mm=t["info"]["space_deficit_mm"],
                                      constraints=c, target_info=t["info"])
        # the plan record carries what the IPR cut needs (planner.cut_case) so exports and the mesh view can rebuild
        # the cut dentition from the plan alone
        ipr = {k: t["info"].get(k, v) for k, v in (("ipr_mm_per_surface", 0.0), ("ipr_applied_teeth", []), ("ipr_surfaces", []))}
        return self.store.put_plan(t["case_id"], target_id, stages,
            {**info, "space_deficit_mm": t["info"]["space_deficit_mm"], **ipr}, violations,
            c.stage_cap, t["info"]["strategy"], constraints=c, parent_plan_id=parent_plan_id)

    def validate(self, plan_id):
        p = self.store.plans[plan_id]
        self.store.require_current_input(p["case_id"], p.get("input_revision"))
        _, case = self.store.load_case(p["case_id"])
        c = p["constraints"]
        if isinstance(c, dict):
            c = Constraints.model_validate(c)
        tid = p.get("target_id")
        info = self.store.targets[tid]["info"] if tid and tid in self.store.targets else (p.get("target") or {})
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
        for strategy in strategies_for(strategies, constraints):     # the prescription decides extraction (#56)
            tid = self.target(case_id, strategy, constraints)
            ids.append(self.stages(tid, parent_plan_id))
        if not ids:
            raise ValueError("no strategy is allowed by the confirmed constraints")
        return ids
