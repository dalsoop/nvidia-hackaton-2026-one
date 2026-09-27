import { clear, h } from '../../ui/dom.js';
import { WORKSPACE_VOCAB as W } from '../../domain/vocab/workspace.js';
import { renderPlanCard } from './plan-card.js';

export function planId(plan) {
  return plan?.plan_id || plan?.id || null;
}

export function sortPlansByCreation(plans) {
  if (!Array.isArray(plans)) return [];
  if (plans.some((plan) => Boolean(plan.created_at))) {
    return [...plans].sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0));
  }
  return [...plans].reverse();
}

export async function fetchPlanDetails(api, planOrId) {
  const id = typeof planOrId === 'string' ? planOrId : planId(planOrId);
  if (!id || typeof api?.getPlan !== 'function') throw new TypeError(W.plansLoadFailed);
  return api.getPlan(id);
}

function replacePlan(plans, detailedPlan) {
  const id = planId(detailedPlan);
  return plans.map((plan) => planId(plan) === id ? { ...plan, ...detailedPlan } : plan);
}

export function mountPlans(container, {
  plans = [], selectedPlanId = null, viewingPlan = null, onSelectPlan, onPlanUpdated, ctx
} = {}) {
  clear(container);
  let currentPlans = sortPlansByCreation(plans);
  let activeId = selectedPlanId || planId(viewingPlan) || planId(currentPlans[0]);
  if (viewingPlan) currentPlans = replacePlan(currentPlans, viewingPlan);

  const count = h('span', { class: 'plans-panel-count' });
  const list = h('div', { class: 'plans-list' });
  const error = h('div', { class: 'plans-panel-error', hidden: true });
  container.appendChild(h('div', { class: 'plans-panel' }, [
    h('div', { class: 'plans-panel-header' }, [h('h2', { class: 'plans-panel-title' }, W.plansTitle), count]),
    list,
    error
  ]));

  function showError(value) {
    error.textContent = value?.message || String(value || '');
    error.hidden = !error.textContent;
  }

  function selected() {
    return currentPlans.find((plan) => planId(plan) === activeId) || null;
  }

  function acceptDetailedPlan(plan) {
    activeId = planId(plan);
    currentPlans = replacePlan(currentPlans, plan);
    showError('');
    render();
  }

  async function mutate(action, id) {
    showError('');
    const updated = await action(id);
    acceptDetailedPlan(updated?.plan || updated);
    await onPlanUpdated?.(selected(), currentPlans);
  }

  async function choose(plan) {
    showError('');
    try {
      const detailed = await onSelectPlan?.(plan);
      if (detailed) acceptDetailedPlan(detailed);
    } catch (err) {
      showError(err);
    }
  }

  function render() {
    clear(list);
    count.textContent = W.plansCount(currentPlans.length);
    if (!currentPlans.length) {
      list.appendChild(h('div', { class: 'plans-empty-note' }, W.emptyPlansNote));
      return;
    }
    currentPlans.forEach((plan, index) => {
      const id = planId(plan);
      list.appendChild(renderPlanCard(plan, {
        index,
        isViewing: id === activeId,
        onSelect: choose,
        onApprove: (target) => mutate(ctx.api.approvePlan, target),
        onRevoke: (target) => mutate(ctx.api.revokeApproval, target),
        onRequestReview: (target) => mutate(ctx.api.requestReview, target),
        getStlUrl: ctx?.api?.stlUrl
      }));
    });
  }

  render();
  return {
    update(nextPlans, nextSelectedId = activeId) {
      currentPlans = sortPlansByCreation(nextPlans);
      activeId = nextSelectedId && currentPlans.some((plan) => planId(plan) === nextSelectedId)
        ? nextSelectedId : planId(currentPlans[0]);
      render();
    },
    setViewingPlan: acceptDetailedPlan,
    showError,
    getViewingPlan: selected,
    getPlans: () => currentPlans,
    getPlanNumber(id) {
      const index = currentPlans.findIndex((plan) => planId(plan) === id);
      return index < 0 ? 1 : index + 1;
    },
    destroy: () => clear(container)
  };
}
