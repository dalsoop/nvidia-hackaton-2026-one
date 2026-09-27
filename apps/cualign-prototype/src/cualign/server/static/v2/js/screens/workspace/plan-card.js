// Plan card component and status decision logic (J6 contract)

import { clear, h } from '../../ui/dom.js';
import { canApprove } from '../../domain/status.js';
import { T } from '../../domain/vocab.js';

export const STRATEGY_LABELS = Object.freeze({
  expansion: '확장',
  ipr: 'IPR',
  expansion_ipr: '확장 + IPR',
  extraction: '발치'
});

export function getStrategyLabel(strategy) {
  if (!strategy) return '전략 미정';
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
  return 0;
}

export function formatPlanTitle(index) {
  const num = typeof index === 'number' ? index + 1 : 1;
  return `계획 ${num}`;
}

export function calculateRailStage(plan) {
  if (!plan) return 'none';
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
  const stages = plan.n_stages ?? plan.info?.n_stages ?? 0;
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
    approvedAt: plan.approval?.approved_at || null
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
 * @param {Function} options.onSelect - Callback when clicking "보기"
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
    }, '보는 중');
  } else {
    viewBtn = h('button', {
      type: 'button',
      class: 'btn btn-outline plan-card-view-btn',
      onClick: () => {
        if (typeof onSelect === 'function') {
          onSelect(plan);
        }
      }
    }, '보기');
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
    badgesRow.appendChild(h('span', { class: 'badge plan-badge-stale' }, '이전 스캔 기준'));
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

    const reviewStatusBadge = h('span', { class: `plan-review-badge ${reviewBadgeClass}` }, `검토: ${reviewStatusLabel}`);
    const toggleMemoBtn = h('button', {
      type: 'button',
      class: 'btn-ghost plan-review-toggle-btn'
    }, '메모 펼치기 ▾');

    reviewSummary.appendChild(reviewStatusBadge);
    reviewSummary.appendChild(toggleMemoBtn);
    reviewRow.appendChild(reviewSummary);

    // Review memo drawer
    const memoDrawer = h('div', { class: 'plan-review-memo-drawer', style: { display: 'none' } });
    const memoContent = h('div', { class: 'plan-review-memo-content' });
    const memoText = actionState.reviewMessage || (actionState.reviewError ? `오류: ${actionState.reviewError}` : '검토 메모가 없습니다.');
    memoContent.textContent = memoText;
    memoDrawer.appendChild(memoContent);

    let memoOpen = false;
    toggleMemoBtn.addEventListener('click', () => {
      memoOpen = !memoOpen;
      memoDrawer.style.display = memoOpen ? 'block' : 'none';
      toggleMemoBtn.textContent = memoOpen ? '메모 접기 ▴' : '메모 펼치기 ▾';
    });
    reviewRow.appendChild(memoDrawer);

    // Retry review button (shown if skipped or failed)
    if (actionState.canRetryReview) {
      const retryWrap = h('div', { class: 'plan-review-retry-wrap' });
      const retryErrEl = h('div', { class: 'plan-action-error', style: { display: 'none' } });
      const retryBtn = h('button', {
        type: 'button',
        class: 'btn btn-outline plan-review-retry-btn',
        onClick: async () => {
          retryBtn.disabled = true;
          retryBtn.textContent = '검토 요청 중...';
          retryErrEl.style.display = 'none';
          try {
            if (typeof onRequestReview === 'function') {
              await onRequestReview(planId);
            }
          } catch (err) {
            retryBtn.disabled = false;
            const is503 = err.status === 503 || String(err.message).includes('503');
            let errorMsg = err.message || err.detail;
            if (is503 && (!errorMsg || errorMsg === 'Service Unavailable' || errorMsg.includes('503'))) {
              errorMsg = '검토 모델이 연결되지 않았습니다.';
            } else if (!errorMsg) {
              errorMsg = T.errors.requestFailed;
            }
            retryErrEl.textContent = errorMsg;
            retryErrEl.style.display = 'block';
          }
        }
      }, T.workspace.requestReviewRetry);

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
      approvedMeta.textContent = timeFormatted ? `승인 시각: ${timeFormatted}` : '승인 완료';
      approvedSection.appendChild(approvedMeta);

      const approvedButtons = h('div', { class: 'plan-approved-buttons' });

      // STL download link
      const stlHref = typeof getStlUrl === 'function' ? getStlUrl(planId) : `/api/plans/${encodeURIComponent(planId)}/stl.zip`;
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
          revokeBtn.textContent = '승인 취소 중...';
          revokeErrEl.style.display = 'none';
          try {
            if (typeof onRevoke === 'function') {
              await onRevoke(planId);
            }
          } catch (err) {
            revokeBtn.disabled = false;
            revokeBtn.textContent = '승인 취소';
            revokeErrEl.textContent = err.message || T.errors.requestFailed;
            revokeErrEl.style.display = 'block';
          }
        }
      }, '승인 취소');
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
          executeBtn.textContent = '승인 처리 중...';
          confirmErrEl.style.display = 'none';
          try {
            if (typeof onApprove === 'function') {
              await onApprove(planId);
            }
          } catch (err) {
            executeBtn.disabled = false;
            executeBtn.textContent = '확인하고 승인';
            confirmErrEl.textContent = err.message || T.errors.requestFailed;
            confirmErrEl.style.display = 'block';
          }
        }
      }, '확인하고 승인');

      const cancelBtn = h('button', {
        type: 'button',
        class: 'btn btn-outline plan-confirm-cancel-btn',
        onClick: () => {
          confirmStep.style.display = 'none';
          initialStep.style.display = 'block';
        }
      }, '취소');

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
      if (badgeState.hasViolations) reasons.push('규칙 위반 해결 필요');
      if (actionState.reviewStatus !== 'passed' && actionState.reviewStatus !== 'skipped') reasons.push('검토 완료 필요');
      const cannotApproveEl = h('div', { class: 'plan-cannot-approve-hint' }, `승인 불가 · ${reasons.join(', ')}`);
      actionArea.appendChild(cannotApproveEl);
    }

    card.appendChild(actionArea);
  }

  return card;
}
