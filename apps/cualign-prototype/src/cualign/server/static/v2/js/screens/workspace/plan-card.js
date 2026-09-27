import { clear, h } from '../../ui/dom.js';
import { canApprove } from '../../domain/status.js';
import { T } from '../../domain/vocab.js';
import { WORKSPACE_VOCAB } from '../../domain/vocab/workspace.js';
import { stlUrl } from '../../api/endpoints.js';

export const STRATEGY_LABELS = Object.freeze({
  expansion: WORKSPACE_VOCAB.strategies.expansion,
  ipr: WORKSPACE_VOCAB.strategies.ipr,
  expansion_ipr: WORKSPACE_VOCAB.strategies.expansion_ipr,
  extraction: WORKSPACE_VOCAB.strategies.extraction
});

export function getStrategyLabel(strategy) {
  if (!strategy) return WORKSPACE_VOCAB.strategies.unknown;
  return STRATEGY_LABELS[strategy] || strategy;
}

export function isPlanStale(plan) {
  if (!plan) return false;
  return Boolean(plan.input_stale || plan.is_stale || plan.stale_scan || plan.stale);
}

export function getViolationsCount(plan) {
  if (!plan) return 0;
  if (typeof plan.violations === 'number') {
    return plan.violations;
  }
  if (Array.isArray(plan.violations)) {
    return plan.violations.length;
  }
  if (typeof plan.info?.violations === 'number') {
    return plan.info.violations;
  }
  if (Array.isArray(plan.info?.violations)) {
    return plan.info.violations.length;
  }
  return 0;
}

export function formatPlanTitle(index) {
  const num = typeof index === 'number' ? index + 1 : 1;
  return WORKSPACE_VOCAB.planTitle(num);
}

export function calculateRailStage(plan) {
  if (!plan) return 'none';
  if (isPlanStale(plan)) return 'none';
  if (plan.approval) return 'approved';
  const vCount = getViolationsCount(plan);
  if (vCount > 0 || plan.passed === false) return 'violation';
  if (canApprove(plan)) return 'ready';
  return 'none';
}

export function getPlanBadgeState(plan) {
  if (!plan) {
    return {
      strategyLabel: '',
      stagesLabel: '',
      violationsLabel: '',
      isStale: false,
      isApproved: false,
      hasViolations: false
    };
  }

  const vCount = getViolationsCount(plan);
  const stages = plan.n_stages ?? plan.info?.n_stages ?? (Array.isArray(plan.stages) ? plan.stages.length : 0);
  const isStale = isPlanStale(plan);
  const isApproved = Boolean(plan.approval);
  const hasViolations = vCount > 0 || plan.passed === false;

  return {
    strategyLabel: getStrategyLabel(plan.strategy),
    stagesLabel: T.stagesCount(stages),
    violationsLabel: hasViolations ? T.violations(vCount) : T.workspace.passed,
    isStale,
    isApproved,
    hasViolations
  };
}

export function getPlanCardActionState(plan) {
  if (!plan) {
    return {
      isStale: false,
      isApproved: false,
      canApprove: false,
      reviewStatus: 'not_requested',
      canRetryReview: false,
      reviewMessage: '',
      reviewError: null,
      approvedAt: null
    };
  }

  const isStale = isPlanStale(plan);
  const isApproved = Boolean(plan.approval);
  const reviewStatus = plan.review?.status || 'not_requested';
  const canRetryReview = !isStale && !isApproved && (reviewStatus === 'not_requested' || reviewStatus === 'failed' || reviewStatus === 'skipped');
  const approvable = !isStale && !isApproved && canApprove(plan);

  return {
    isStale,
    isApproved,
    canApprove: approvable,
    reviewStatus,
    canRetryReview,
    reviewMessage: plan.review?.message || '',
    reviewError: plan.review?.error || null,
    approvedAt: plan.approval?.approved_at || (typeof plan.approval === 'string' ? plan.approval : (plan.approved_at || null))
  };
}

export function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  } catch {
    return String(isoString);
  }
}

/**
 * Render a plan card DOM element.
 *
 * @param {Object} plan - Plan data
 * @param {Object} options
 * @param {number} options.index - 0-based plan order
 * @param {boolean} options.isViewing - Whether this plan is currently viewed
 * @param {Function} options.onSelect - Callback when clicking view button
 * @param {Function} options.onApprove - Callback when confirming approval: async () => Promise<void>
 * @param {Function} options.onRevoke - Callback when revoking approval: async () => Promise<void>
 * @param {Function} options.onRequestReview - Callback when retrying review: async () => Promise<void>
 * @param {Function} options.getStlUrl - (planId) => string
 * @returns {HTMLElement}
 */
export function renderPlanCard(plan, {
  index = 0,
  isViewing = false,
  onSelect = null,
  onApprove = null,
  onRevoke = null,
  onRequestReview = null,
  getStlUrl = null
} = {}) {
  const planId = plan.plan_id || plan.id || '';
  const title = formatPlanTitle(index);
  const badgeState = getPlanBadgeState(plan);
  const actionState = getPlanCardActionState(plan);

  const card = h('div', {
    class: [
      'plan-card',
      isViewing ? 'plan-card-viewing' : '',
      badgeState.isStale ? 'plan-card-stale' : '',
      badgeState.isApproved ? 'plan-card-approved' : ''
    ].filter(Boolean).join(' '),
    title: planId
  });

  // Header row: Title and view button (36px)
  const header = h('div', { class: 'plan-card-header' });
  const titleWrap = h('div', { class: 'plan-card-title-wrap' });
  const titleEl = h('h3', { class: 'plan-card-title', title: planId }, title);
  titleWrap.appendChild(titleEl);

  let viewBtn;
  if (isViewing) {
    viewBtn = h('button', {
      type: 'button',
      class: 'btn btn-outline plan-card-view-btn plan-card-view-active',
      disabled: true
    }, WORKSPACE_VOCAB.viewing);
  } else {
    viewBtn = h('button', {
      type: 'button',
      class: 'btn btn-outline plan-card-view-btn',
      onClick: () => {
        if (typeof onSelect === 'function') {
          onSelect(plan);
        }
      }
    }, WORKSPACE_VOCAB.view);
  }

  header.appendChild(titleWrap);
  header.appendChild(viewBtn);
  card.appendChild(header);

  // Badges row: Strategy, Stages, Violations, Stale, Approved
  const badgesRow = h('div', { class: 'plan-card-badges' });

  // Strategy badge
  badgesRow.appendChild(h('span', { class: 'badge plan-badge-strategy' }, badgeState.strategyLabel));

  // Stages badge
  badgesRow.appendChild(h('span', { class: 'badge plan-badge-stages' }, badgeState.stagesLabel));

  // Violations badge
  if (badgeState.hasViolations) {
    badgesRow.appendChild(h('span', { class: 'badge badge-violation plan-badge-violation' }, badgeState.violationsLabel));
  } else {
    badgesRow.appendChild(h('span', { class: 'badge badge-ready plan-badge-pass' }, badgeState.violationsLabel));
  }

  // Stale badge
  if (badgeState.isStale) {
    badgesRow.appendChild(h('span', { class: 'badge plan-badge-stale' }, WORKSPACE_VOCAB.staleBadge));
  }

  // Approved badge
  if (badgeState.isApproved) {
    badgesRow.appendChild(h('span', { class: 'badge badge-approved plan-badge-approved' }, T.workspace.approvedState));
  }

  card.appendChild(badgesRow);

  // Action area (only rendered for the viewing plan)
  if (isViewing) {
    const actionArea = h('div', { class: 'plan-card-actions' });

    // 1. Stale warning notice if applicable
    if (actionState.isStale) {
      const staleNotice = h('div', { class: 'plan-notice-stale' }, T.workspace.stalePlanNotice);
      actionArea.appendChild(staleNotice);
    }

    // 2. Review row
    const reviewRow = h('div', { class: 'plan-review-row' });
    const reviewSummary = h('div', { class: 'plan-review-summary' });

    let reviewStatusLabel = T.workspace.skipped;
    let reviewBadgeClass = 'plan-review-skipped';
    if (actionState.reviewStatus === 'passed') {
      reviewStatusLabel = T.workspace.passed;
      reviewBadgeClass = 'plan-review-passed';
    } else if (actionState.reviewStatus === 'failed') {
      reviewStatusLabel = T.workspace.failed;
      reviewBadgeClass = 'plan-review-failed';
    }

    const reviewStatusBadge = h('span', { class: `plan-review-badge ${reviewBadgeClass}` }, WORKSPACE_VOCAB.reviewBadge(reviewStatusLabel));
    const toggleMemoBtn = h('button', {
      type: 'button',
      class: 'btn-ghost plan-review-toggle-btn'
    }, WORKSPACE_VOCAB.memoExpand);

    reviewSummary.appendChild(reviewStatusBadge);
    reviewSummary.appendChild(toggleMemoBtn);
    reviewRow.appendChild(reviewSummary);

    // Review memo drawer
    const memoDrawer = h('div', { class: 'plan-review-memo-drawer', style: { display: 'none' } });
    const memoContent = h('div', { class: 'plan-review-memo-content' });
    let memoText = actionState.reviewMessage;
    if (!memoText) {
      if (actionState.reviewError === 503 || String(actionState.reviewError).includes('503')) {
        memoText = WORKSPACE_VOCAB.reviewModelDisconnected;
      } else if (actionState.reviewError) {
        memoText = WORKSPACE_VOCAB.errorPrefix(actionState.reviewError);
      } else {
        memoText = WORKSPACE_VOCAB.noReviewMemo;
      }
    }
    memoContent.textContent = memoText;
    memoDrawer.appendChild(memoContent);

    let memoOpen = false;
    toggleMemoBtn.addEventListener('click', () => {
      memoOpen = !memoOpen;
      memoDrawer.style.display = memoOpen ? 'block' : 'none';
      toggleMemoBtn.textContent = memoOpen ? WORKSPACE_VOCAB.memoCollapse : WORKSPACE_VOCAB.memoExpand;
    });
    reviewRow.appendChild(memoDrawer);

    // Retry review button (shown if skipped or failed)
    if (actionState.canRetryReview) {
      const retryWrap = h('div', { class: 'plan-review-retry-wrap' });
      const initialErrorMsg = (actionState.reviewStatus === 'failed' && (actionState.reviewError || actionState.reviewMessage))
        ? (actionState.reviewError === 503 || String(actionState.reviewError).includes('503')
            ? (actionState.reviewMessage || WORKSPACE_VOCAB.reviewModelDisconnected)
            : (actionState.reviewMessage || WORKSPACE_VOCAB.errorPrefix(actionState.reviewError)))
        : '';
      const retryErrEl = h('div', {
        class: 'plan-action-error plan-review-error-msg',
        style: { display: initialErrorMsg ? 'block' : 'none' }
      }, initialErrorMsg);
      const retryBtn = h('button', {
        type: 'button',
        class: 'btn btn-outline plan-review-retry-btn',
        onClick: async () => {
          retryBtn.disabled = true;
          retryBtn.textContent = WORKSPACE_VOCAB.requestingReview;
          retryErrEl.style.display = 'none';
          try {
            if (typeof onRequestReview === 'function') {
              await onRequestReview(planId);
            }
          } catch (err) {
            retryBtn.disabled = false;
            retryBtn.textContent = WORKSPACE_VOCAB.requestReviewRetry;
            const is503 = err.status === 503 || String(err.message).includes('503');
            let errorMsg = err.message || err.detail;
            if (is503 && (!errorMsg || errorMsg === 'Service Unavailable' || errorMsg.includes('503'))) {
              errorMsg = WORKSPACE_VOCAB.reviewModelDisconnected;
            } else if (!errorMsg) {
              errorMsg = T.errors.requestFailed;
            }
            retryErrEl.textContent = errorMsg;
            retryErrEl.style.display = 'block';
          }
        }
      }, WORKSPACE_VOCAB.requestReviewRetry);

      retryWrap.appendChild(retryBtn);
      retryWrap.appendChild(retryErrEl);
      reviewRow.appendChild(retryWrap);
    }

    actionArea.appendChild(reviewRow);

    // 3. Approval state vs Approvable state
    if (actionState.isApproved) {
      // Approved section: Approved time, STL download link, Revoke button
      const approvedSection = h('div', { class: 'plan-approved-section' });

      const approvedMeta = h('div', { class: 'plan-approved-meta' });
      const timeFormatted = formatDateTime(actionState.approvedAt);
      approvedMeta.textContent = timeFormatted ? WORKSPACE_VOCAB.approvedTime(timeFormatted) : WORKSPACE_VOCAB.approvedDone;
      approvedSection.appendChild(approvedMeta);

      const approvedButtons = h('div', { class: 'plan-approved-buttons' });

      // STL download link
      const stlHref = typeof getStlUrl === 'function' ? getStlUrl(planId) : stlUrl(planId);
      const downloadLink = h('a', {
        href: actionState.isStale ? undefined : stlHref,
        download: `cualign_${planId}_stages.zip`,
        class: `btn btn-primary plan-download-btn ${actionState.isStale ? 'disabled' : ''}`,
        'aria-disabled': actionState.isStale ? 'true' : undefined
      }, T.workspace.exportStlButton);
      approvedButtons.appendChild(downloadLink);

      // Revoke approval button
      const revokeErrEl = h('div', { class: 'plan-action-error', style: { display: 'none' } });
      const revokeBtn = h('button', {
        type: 'button',
        class: 'btn btn-outline plan-revoke-btn',
        disabled: actionState.isStale,
        onClick: async () => {
          revokeBtn.disabled = true;
          revokeBtn.textContent = WORKSPACE_VOCAB.revoking;
          revokeErrEl.style.display = 'none';
          try {
            if (typeof onRevoke === 'function') {
              await onRevoke(planId);
            }
          } catch (err) {
            revokeBtn.disabled = false;
            revokeBtn.textContent = WORKSPACE_VOCAB.revokeApproval;
            revokeErrEl.textContent = err.message || T.errors.requestFailed;
            revokeErrEl.style.display = 'block';
          }
        }
      }, WORKSPACE_VOCAB.revokeApproval);
      approvedButtons.appendChild(revokeBtn);

      approvedSection.appendChild(approvedButtons);
      approvedSection.appendChild(revokeErrEl);
      actionArea.appendChild(approvedSection);

    } else if (actionState.canApprove) {
      // Approval button with inline confirmation step
      const approveSection = h('div', { class: 'plan-approve-section' });

      const initialStep = h('div', { class: 'plan-approve-initial' });
      const triggerBtn = h('button', {
        type: 'button',
        class: 'btn btn-primary plan-approve-btn'
      }, T.workspace.approveButton);
      initialStep.appendChild(triggerBtn);

      // Inline confirmation drawer
      const confirmStep = h('div', { class: 'plan-approve-confirm-step', style: { display: 'none' } });
      const confirmNotice = h('div', { class: 'plan-approve-confirm-notice' }, T.workspace.requireDoctorConfirm);
      const confirmActions = h('div', { class: 'plan-approve-confirm-actions' });
      const confirmErrEl = h('div', { class: 'plan-action-error', style: { display: 'none' } });

      const executeBtn = h('button', {
        type: 'button',
        class: 'btn btn-primary plan-confirm-execute-btn',
        onClick: async () => {
          executeBtn.disabled = true;
          executeBtn.textContent = WORKSPACE_VOCAB.approving;
          confirmErrEl.style.display = 'none';
          try {
            if (typeof onApprove === 'function') {
              await onApprove(planId);
            }
          } catch (err) {
            executeBtn.disabled = false;
            executeBtn.textContent = WORKSPACE_VOCAB.confirmAndApprove;
            confirmErrEl.textContent = err.message || T.errors.requestFailed;
            confirmErrEl.style.display = 'block';
          }
        }
      }, WORKSPACE_VOCAB.confirmAndApprove);

      const cancelBtn = h('button', {
        type: 'button',
        class: 'btn btn-outline plan-confirm-cancel-btn',
        onClick: () => {
          confirmStep.style.display = 'none';
          initialStep.style.display = 'block';
        }
      }, WORKSPACE_VOCAB.cancel);

      triggerBtn.addEventListener('click', () => {
        initialStep.style.display = 'none';
        confirmStep.style.display = 'block';
      });

      confirmActions.appendChild(executeBtn);
      confirmActions.appendChild(cancelBtn);
      confirmStep.appendChild(confirmNotice);
      confirmStep.appendChild(confirmActions);
      confirmStep.appendChild(confirmErrEl);

      approveSection.appendChild(initialStep);
      approveSection.appendChild(confirmStep);
      actionArea.appendChild(approveSection);
    } else if (!actionState.isStale) {
      // Cannot approve (violations exist or review failed)
      const reasons = [];
      if (badgeState.hasViolations) reasons.push(WORKSPACE_VOCAB.reasonViolations);
      if (actionState.reviewStatus !== 'passed' && actionState.reviewStatus !== 'skipped') reasons.push(WORKSPACE_VOCAB.reasonReviewNeeded);
      const cannotApproveEl = h('div', { class: 'plan-cannot-approve-hint' }, WORKSPACE_VOCAB.cannotApproveHint(reasons));
      actionArea.appendChild(cannotApproveEl);
    }

    card.appendChild(actionArea);
  }

  return card;
}
