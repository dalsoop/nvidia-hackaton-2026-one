// Plans list orchestrator and management component (J6 contract)

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import {
  renderPlanCard,
  calculateRailStage
} from './plan-card.js';

/**
 * Sort plans by their creation order (oldest to newest).
 * Backend /api/plans returns reversed(list(STORE.plans)), so reversing yields creation order.
 * If created_at is present on the items, sorts by timestamp ascending.
 *
 * @param {Array<Object>} plans
 * @returns {Array<Object>}
 */
export function sortPlansByCreation(plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return [];
  }

  // If plans have created_at property, sort by date ascending
  const hasCreatedAt = plans.some((p) => Boolean(p.created_at));
  if (hasCreatedAt) {
    return [...plans].sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeA - timeB;
    });
  }

  // Otherwise, since /api/plans returns them in reversed order, reverse to get creation order
  return [...plans].reverse();
}

/**
 * Mount plans list inside the container.
 *
 * @param {HTMLElement} container
 * @param {Object} options
 * @param {Array<Object>} options.plans - Raw plans from API
 * @param {string} options.caseId - Active case ID
 * @param {string} [options.selectedPlanId] - ID of the currently viewed plan
 * @param {Function} options.onSelectPlan - (plan) => void
 * @param {Function} options.onPlanUpdated - (updatedPlan, allPlans) => void
 * @param {Object} options.ctx - App context { api, store, navigate }
 * @returns {{ update: (newPlans, newSelectedId) => void, destroy: () => void }}
 */
export function mountPlans(container, {
  plans = [],
  caseId = '',
  selectedPlanId = null,
  onSelectPlan = null,
  onPlanUpdated = null,
  ctx = null
} = {}) {
  clear(container);

  let currentPlans = sortPlansByCreation(plans);
  let activePlanId = selectedPlanId || (currentPlans[0]?.plan_id || currentPlans[0]?.id || null);

  const wrapper = h('div', { class: 'plans-panel' });
  const header = h('div', { class: 'plans-panel-header' });
  const title = h('h2', { class: 'plans-panel-title' }, '계획 목록');
  const countBadge = h('span', { class: 'plans-panel-count' }, T.plansCount(currentPlans.length));
  header.appendChild(title);
  header.appendChild(countBadge);
  wrapper.appendChild(header);

  const listEl = h('div', { class: 'plans-list' });
  wrapper.appendChild(listEl);
  container.appendChild(wrapper);

  function getViewingPlan() {
    return currentPlans.find((p) => (p.plan_id || p.id) === activePlanId) || currentPlans[0] || null;
  }

  async function handleApprove(planId) {
    if (!ctx || !ctx.api) return;
    const res = await ctx.api.approvePlan(planId);
    // res can be the full updated plan object or contains it
    const updated = res.plan || res;
    updatePlanInList(updated);
  }

  async function handleRevoke(planId) {
    if (!ctx || !ctx.api) return;
    const res = await ctx.api.revokeApproval(planId);
    const updated = res.plan || res;
    updatePlanInList(updated);
  }

  async function handleRequestReview(planId) {
    if (!ctx || !ctx.api) return;
    const res = await ctx.api.requestReview(planId);
    const updated = res.plan || res;
    updatePlanInList(updated);
  }

  function updatePlanInList(updatedPlan) {
    const updatedId = updatedPlan.plan_id || updatedPlan.id;
    currentPlans = currentPlans.map((p) => {
      const pid = p.plan_id || p.id;
      return pid === updatedId ? { ...p, ...updatedPlan } : p;
    });

    renderList();

    const currentViewing = getViewingPlan();
    if (typeof onPlanUpdated === 'function') {
      onPlanUpdated(currentViewing, currentPlans);
    }
  }

  function renderList() {
    clear(listEl);
    countBadge.textContent = T.plansCount(currentPlans.length);

    if (currentPlans.length === 0) {
      listEl.appendChild(h('div', { class: 'plans-empty-note' }, '저장된 계획이 없습니다.'));
      return;
    }

    currentPlans.forEach((plan, index) => {
      const pid = plan.plan_id || plan.id;
      const isViewing = pid === activePlanId;

      const card = renderPlanCard(plan, {
        index,
        isViewing,
        onSelect: (selected) => {
          activePlanId = selected.plan_id || selected.id;
          renderList();
          if (typeof onSelectPlan === 'function') {
            onSelectPlan(selected);
          }
        },
        onApprove: handleApprove,
        onRevoke: handleRevoke,
        onRequestReview: handleRequestReview,
        getStlUrl: (id) => (ctx?.api?.stlUrl ? ctx.api.stlUrl(id) : `/api/plans/${encodeURIComponent(id)}/stl.zip`)
      });

      listEl.appendChild(card);
    });
  }

  renderList();

  return {
    update(newPlans, newSelectedId) {
      currentPlans = sortPlansByCreation(newPlans);
      if (newSelectedId) {
        activePlanId = newSelectedId;
      } else if (!currentPlans.some((p) => (p.plan_id || p.id) === activePlanId)) {
        activePlanId = currentPlans[0]?.plan_id || currentPlans[0]?.id || null;
      }
      renderList();
    },
    getViewingPlan,
    getPlans() {
      return currentPlans;
    },
    destroy() {
      clear(container);
    }
  };
}
