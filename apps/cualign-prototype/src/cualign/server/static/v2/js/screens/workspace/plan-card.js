import { h } from '../../ui/dom.js';
import { canApprove } from '../../domain/status.js';
import { WORKSPACE_VOCAB as W } from '../../domain/vocab/workspace.js';

export const STRATEGY_LABELS = Object.freeze({
  expansion: W.strategies.expansion,
  ipr: W.strategies.ipr,
  expansion_ipr: W.strategies.expansion_ipr,
  extraction: W.strategies.extraction
});

export function getStrategyLabel(strategy) {
  return strategy ? (STRATEGY_LABELS[strategy] || strategy) : W.strategies.unknown;
}

export function isPlanStale(plan) {
  return Boolean(plan?.input_stale);
}

export function getViolationsCount(plan) {
  const violations = plan?.violations ?? plan?.info?.violations;
  if (typeof violations === 'number') return violations;
  return Array.isArray(violations) ? violations.length : 0;
}

export function formatPlanTitle(index) {
  return W.planTitle(Number.isInteger(index) ? index + 1 : 1);
}

export function calculateRailStage(plan) {
  if (!plan || isPlanStale(plan)) return 'none';
  if (plan.approval) return 'approved';
  if (getViolationsCount(plan) > 0 || plan.passed === false) return 'violation';
  return canApprove(plan) ? 'ready' : 'none';
}

export function getPlanBadgeState(plan) {
  if (!plan) return { strategyLabel: '', stagesLabel: '', violationsLabel: '', isStale: false, isApproved: false, hasViolations: false };
  const count = getViolationsCount(plan);
  const stages = plan.n_stages ?? plan.info?.n_stages ?? (Array.isArray(plan.stages) ? plan.stages.length : 0);
  const hasViolations = count > 0 || plan.passed === false;
  return {
    strategyLabel: getStrategyLabel(plan.strategy),
    stagesLabel: W.stagesLabel(stages),
    violationsLabel: hasViolations ? W.violationsLabel(count) : W.passed,
    isStale: isPlanStale(plan),
    isApproved: Boolean(plan.approval),
    hasViolations
  };
}

export function getPlanCardActionState(plan) {
  const reviewStatus = plan?.review?.status || 'not_requested';
  const isStale = isPlanStale(plan);
  const isApproved = Boolean(plan?.approval);
  return {
    isStale,
    isApproved,
    canApprove: Boolean(plan) && !isApproved && canApprove(plan),
    reviewStatus,
    canRetryReview: Boolean(plan) && !isStale && !isApproved && ['not_requested', 'failed'].includes(reviewStatus),
    reviewMessage: plan?.review?.message || '',
    reviewError: plan?.review?.error || null,
    approvedAt: plan?.approval?.approved_at || null
  };
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function reviewStatusLabel(status) {
  if (status === 'passed') return W.passed;
  if (status === 'failed') return W.failed;
  if (status === 'skipped') return W.skipped;
  return W.notRequested;
}

function setError(el, error) {
  el.textContent = error?.message || String(error || '');
  el.hidden = !el.textContent;
}

function disabledDownload(extra = '') {
  return h('a', {
    class: `btn btn-outline plan-download-btn disabled ${extra}`.trim(),
    'aria-disabled': 'true'
  }, [W.exportStlButton, h('span', { class: 'plan-action-suffix' }, W.exportAfterApproval)]);
}

function renderReview(title, state, onRequestReview) {
  const row = h('div', { class: 'plan-review-row' });
  const memo = h('div', { class: 'plan-review-memo-drawer', hidden: true }, state.reviewMessage || W.noReviewMemo);
  const toggle = h('button', {
    type: 'button',
    class: 'plan-review-toggle-btn',
    'aria-expanded': 'false',
    onClick: () => {
      memo.hidden = !memo.hidden;
      toggle.setAttribute('aria-expanded', String(!memo.hidden));
      toggle.setAttribute('aria-label', memo.hidden ? W.memoExpand : W.memoCollapse);
    }
  }, [h('span', null, W.reviewLine(title, reviewStatusLabel(state.reviewStatus))), h('span', { 'aria-hidden': 'true' }, '⌄')]);
  row.append(toggle, memo);
  if (state.canRetryReview) {
    const error = h('div', { class: 'plan-action-error', hidden: !state.reviewMessage }, state.reviewMessage);
    const retry = h('button', {
      type: 'button',
      class: 'btn btn-outline plan-review-retry-btn',
      onClick: async () => {
        retry.disabled = true;
        retry.textContent = W.requestingReview;
        error.hidden = true;
        try {
          await onRequestReview?.();
        } catch (err) {
          setError(error, err);
          retry.disabled = false;
          retry.textContent = W.requestReviewRetry;
        }
      }
    }, W.requestReviewRetry);
    row.append(retry, error);
  }
  return row;
}

function renderApproval(planId, title, badge, state, handlers) {
  const area = h('div', { class: 'plan-card-actions' });
  if (state.isStale) area.appendChild(h('div', { class: 'plan-notice-stale' }, W.stalePlanNotice));
  area.appendChild(renderReview(title, state, () => handlers.onRequestReview?.(planId)));
  const error = h('div', { class: 'plan-action-error', hidden: true });
  const actions = h('div', { class: 'plan-primary-actions' });

  if (state.isApproved) {
    const approved = h('div', { class: 'plan-approved-meta' }, state.approvedAt ? W.approvedTime(formatDateTime(state.approvedAt)) : W.approvedDone);
    const url = state.isStale ? null : handlers.getStlUrl?.(planId);
    actions.appendChild(url ? h('a', { href: url, download: '', class: 'btn btn-primary plan-download-btn' }, W.exportStlButton) : disabledDownload());
    const revoke = h('button', {
      type: 'button', class: 'btn btn-outline plan-revoke-btn',
      onClick: async () => {
        revoke.disabled = true;
        try { await handlers.onRevoke?.(planId); } catch (err) { setError(error, err); revoke.disabled = false; }
      }
    }, W.revokeApproval);
    actions.appendChild(revoke);
    area.append(approved, actions, error);
    return area;
  }

  if (!state.canApprove) {
    const reason = badge.hasViolations ? W.cannotApproveViolations(getViolationsCount(handlers.plan)) : W.cannotApproveReview;
    actions.append(h('button', { type: 'button', class: 'btn btn-outline plan-approve-btn', disabled: true, title: reason }, W.planApprove(title)), disabledDownload());
    area.append(actions, error);
    return area;
  }

  const trigger = h('button', { type: 'button', class: 'btn btn-outline plan-approve-btn' }, W.planApprove(title));
  const confirm = h('div', { class: 'plan-approve-confirm-step', hidden: true });
  const execute = h('button', {
    type: 'button', class: 'btn btn-primary plan-confirm-execute-btn',
    onClick: async () => {
      execute.disabled = true;
      execute.textContent = W.approving;
      try { await handlers.onApprove?.(planId); } catch (err) { setError(error, err); execute.disabled = false; execute.textContent = W.confirmAndApprove; }
    }
  }, W.confirmAndApprove);
  const cancel = h('button', { type: 'button', class: 'plan-confirm-cancel-btn', onClick: () => { confirm.hidden = true; actions.hidden = false; } }, W.cancel);
  trigger.addEventListener('click', () => { actions.hidden = true; confirm.hidden = false; });
  actions.append(trigger, disabledDownload());
  confirm.append(execute, cancel);
  area.append(actions, confirm, error);
  return area;
}

export function renderPlanCard(plan, { index = 0, isViewing = false, onSelect, onApprove, onRevoke, onRequestReview, getStlUrl } = {}) {
  const planId = plan?.plan_id || plan?.id || '';
  const title = formatPlanTitle(index);
  const badge = getPlanBadgeState(plan);
  const card = h('article', { class: `plan-card${isViewing ? ' plan-card-viewing' : ''}${badge.isStale ? ' plan-card-stale' : ''}`, title: planId });
  const view = h('button', { type: 'button', class: `btn btn-outline plan-card-view-btn${isViewing ? ' plan-card-view-active' : ''}`, disabled: isViewing, onClick: () => onSelect?.(plan) }, isViewing ? W.viewing : W.view);
  card.appendChild(h('div', { class: 'plan-card-header' }, [h('h3', { class: 'plan-card-title' }, title), view]));
  const badges = h('div', { class: 'plan-card-badges' }, [
    h('span', { class: 'badge plan-badge-strategy' }, badge.strategyLabel),
    h('span', { class: 'badge plan-badge-stages' }, badge.stagesLabel),
    h('span', { class: `badge ${badge.hasViolations ? 'badge-violation' : 'badge-ready'}` }, badge.violationsLabel)
  ]);
  if (badge.isStale) badges.appendChild(h('span', { class: 'badge plan-badge-stale' }, W.staleBadge));
  if (badge.isApproved) badges.appendChild(h('span', { class: 'badge badge-approved' }, W.approvedState));
  card.appendChild(badges);
  if (isViewing) card.appendChild(renderApproval(planId, title, badge, getPlanCardActionState(plan), { plan, onApprove, onRevoke, onRequestReview, getStlUrl }));
  return card;
}
