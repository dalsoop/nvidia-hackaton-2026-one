import { preferredPlan } from '../../../domain/status.js';

export function selectViewingPlan(state = {}) {
  if (state.viewingPlan && (!state.viewingPlanId || planId(state.viewingPlan) === state.viewingPlanId)) {
    return state.viewingPlan;
  }

  const plans = Array.isArray(state.plans) ? state.plans : state.plans?.plans || [];
  return (state.viewingPlanId && plans.find((plan) => planId(plan) === state.viewingPlanId))
    || preferredPlan(plans)
    || plans[0]
    || null;
}

export function planId(plan) {
  return plan?.plan_id || plan?.id || null;
}

export function violationCount(plan) {
  if (Array.isArray(plan?.violations)) return plan.violations.length;
  const count = Number(plan?.violations);
  return Number.isFinite(count) ? count : 0;
}

export function planStageIndex(state = {}) {
  const value = Number(state.stageIndex);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function resolveCreatedPlanId(result, plans = []) {
  return planId(result?.chosen)
    || planId(result?.best_failed)
    || planId(result?.tried?.[0])
    || planId(plans[0]);
}
