import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STRATEGY_LABELS,
  getStrategyLabel,
  isPlanStale,
  getViolationsCount,
  formatPlanTitle,
  calculateRailStage,
  getPlanBadgeState,
  getPlanCardActionState,
  formatDateTime
} from '../../src/cualign/server/static/v2/js/screens/workspace/plan-card.js';

import {
  sortPlansByCreation
} from '../../src/cualign/server/static/v2/js/screens/workspace/plans.js';

test('Plan Card: formatPlanTitle formats 0-based index to 1-based title', () => {
  assert.equal(formatPlanTitle(0), '계획 1');
  assert.equal(formatPlanTitle(1), '계획 2');
  assert.equal(formatPlanTitle(5), '계획 6');
  assert.equal(formatPlanTitle(undefined), '계획 1');
});

test('Plan Card: getStrategyLabel maps strategies to Korean', () => {
  assert.equal(getStrategyLabel('expansion'), '확장');
  assert.equal(getStrategyLabel('ipr'), 'IPR');
  assert.equal(getStrategyLabel('expansion_ipr'), '확장 + IPR');
  assert.equal(getStrategyLabel('extraction'), '발치');
  assert.equal(getStrategyLabel('unknown'), 'unknown');
  assert.equal(getStrategyLabel(null), '전략 미정');
});

test('Plan Card: isPlanStale detects all stale flags', () => {
  assert.equal(isPlanStale(null), false);
  assert.equal(isPlanStale({}), false);
  assert.equal(isPlanStale({ input_stale: true }), true);
  assert.equal(isPlanStale({ is_stale: true }), true);
  assert.equal(isPlanStale({ stale_scan: true }), true);
  assert.equal(isPlanStale({ stale: true }), true);
  assert.equal(isPlanStale({ input_stale: false, is_stale: false }), false);
});

test('Plan Card: getViolationsCount handles number and array', () => {
  assert.equal(getViolationsCount(null), 0);
  assert.equal(getViolationsCount({}), 0);
  assert.equal(getViolationsCount({ violations: 3 }), 3);
  assert.equal(getViolationsCount({ violations: ['v1', 'v2'] }), 2);
  assert.equal(getViolationsCount({ violations: [] }), 0);
});

test('Plan Card: calculateRailStage maps plan states to rail stage tokens', () => {
  assert.equal(calculateRailStage(null), 'none');

  // 1. Approved stage has highest precedence
  const approvedPlan = {
    plan_id: 'p1',
    passed: true,
    violations: 0,
    review: { status: 'passed' },
    approval: { approved_at: '2026-09-27T12:00:00Z' }
  };
  assert.equal(calculateRailStage(approvedPlan), 'approved');

  // 2. Ready stage when canApprove is true
  const readyPlan = {
    plan_id: 'p2',
    passed: true,
    violations: 0,
    review: { status: 'passed' }
  };
  assert.equal(calculateRailStage(readyPlan), 'ready');

  // 3. Violation stage when violations > 0 or passed is false
  const violationPlan = {
    plan_id: 'p3',
    passed: false,
    violations: 2,
    review: { status: 'passed' }
  };
  assert.equal(calculateRailStage(violationPlan), 'violation');

  const passedFalsePlan = {
    plan_id: 'p4',
    passed: false,
    violations: 0,
    review: { status: 'passed' }
  };
  assert.equal(calculateRailStage(passedFalsePlan), 'violation');

  // 4. Stale plan or unreviewed plan with 0 violations returns none (not ready, not violation)
  const stalePlan = {
    plan_id: 'p5',
    passed: true,
    violations: 0,
    input_stale: true,
    review: { status: 'passed' }
  };
  assert.equal(calculateRailStage(stalePlan), 'none');

  const unreviewedPlan = {
    plan_id: 'p6',
    passed: true,
    violations: 0,
    review: { status: 'not_requested' }
  };
  assert.equal(calculateRailStage(unreviewedPlan), 'none');
});

test('Plan Card: getPlanBadgeState calculates correct badge labels and flags', () => {
  const plan = {
    plan_id: 'p-1',
    strategy: 'expansion_ipr',
    n_stages: 14,
    violations: 0,
    passed: true,
    approval: { approved_at: '2026-09-27T10:00:00Z' }
  };

  const badgeState = getPlanBadgeState(plan);
  assert.equal(badgeState.strategyLabel, '확장 + IPR');
  assert.equal(badgeState.stagesLabel, '14장');
  assert.equal(badgeState.violationsLabel, '통과');
  assert.equal(badgeState.isStale, false);
  assert.equal(badgeState.isApproved, true);
  assert.equal(badgeState.hasViolations, false);

  const staleViolationPlan = {
    plan_id: 'p-2',
    strategy: 'extraction',
    n_stages: 22,
    violations: 3,
    passed: false,
    input_stale: true
  };

  const badgeState2 = getPlanBadgeState(staleViolationPlan);
  assert.equal(badgeState2.strategyLabel, '발치');
  assert.equal(badgeState2.stagesLabel, '22장');
  assert.equal(badgeState2.violationsLabel, '위반 3건');
  assert.equal(badgeState2.isStale, true);
  assert.equal(badgeState2.isApproved, false);
  assert.equal(badgeState2.hasViolations, true);
});

test('Plan Card: getPlanCardActionState calculates approve and retry capabilities', () => {
  // Approvable plan
  const validPlan = {
    plan_id: 'p1',
    strategy: 'expansion',
    passed: true,
    violations: 0,
    review: { status: 'passed', message: '임상 규칙 통과' }
  };
  const act1 = getPlanCardActionState(validPlan);
  assert.equal(act1.canApprove, true);
  assert.equal(act1.isApproved, false);
  assert.equal(act1.isStale, false);
  assert.equal(act1.canRetryReview, false);
  assert.equal(act1.reviewStatus, 'passed');
  assert.equal(act1.reviewMessage, '임상 규칙 통과');

  // Plan needing review retry (failed review)
  const failedReviewPlan = {
    plan_id: 'p2',
    passed: true,
    violations: 0,
    review: { status: 'failed', message: 'NIM timeout', error: 'ServiceUnavailable' }
  };
  const act2 = getPlanCardActionState(failedReviewPlan);
  assert.equal(act2.canApprove, false);
  assert.equal(act2.canRetryReview, true);
  assert.equal(act2.reviewStatus, 'failed');
  assert.equal(act2.reviewError, 'ServiceUnavailable');

  // Plan needing review retry (skipped review)
  const skippedReviewPlan = {
    plan_id: 'p3',
    passed: true,
    violations: 0,
    review: { status: 'skipped' }
  };
  const act3 = getPlanCardActionState(skippedReviewPlan);
  // Skipped review is allowed for approval in canApprove, but also allows review retry
  assert.equal(act3.canApprove, true);
  assert.equal(act3.canRetryReview, true);

  // Already approved plan
  const approvedPlan = {
    plan_id: 'p4',
    passed: true,
    violations: 0,
    review: { status: 'passed' },
    approval: { approved_at: '2026-09-27T12:00:00Z' }
  };
  const act4 = getPlanCardActionState(approvedPlan);
  assert.equal(act4.isApproved, true);
  assert.equal(act4.canApprove, false); // already approved
  assert.equal(act4.canRetryReview, false);

  // Stale plan
  const stalePlan = {
    plan_id: 'p5',
    passed: true,
    violations: 0,
    input_stale: true,
    review: { status: 'passed' }
  };
  const act5 = getPlanCardActionState(stalePlan);
  assert.equal(act5.isStale, true);
  assert.equal(act5.canApprove, false);
  assert.equal(act5.canRetryReview, false);
});

test('Plans: sortPlansByCreation orders plans chronologically', () => {
  // Case A: With created_at
  const plansWithDates = [
    { plan_id: 'p-3', created_at: '2026-09-27T10:30:00Z' },
    { plan_id: 'p-1', created_at: '2026-09-27T09:00:00Z' },
    { plan_id: 'p-2', created_at: '2026-09-27T10:00:00Z' }
  ];
  const sortedA = sortPlansByCreation(plansWithDates);
  assert.deepEqual(sortedA.map(p => p.plan_id), ['p-1', 'p-2', 'p-3']);

  // Case B: Without created_at (reversed order from /api/plans is reversed back)
  const plansFromApi = [
    { plan_id: 'p-latest' },
    { plan_id: 'p-middle' },
    { plan_id: 'p-first' }
  ];
  const sortedB = sortPlansByCreation(plansFromApi);
  assert.deepEqual(sortedB.map(p => p.plan_id), ['p-first', 'p-middle', 'p-latest']);

  // Case C: Empty or invalid
  assert.deepEqual(sortPlansByCreation([]), []);
  assert.deepEqual(sortPlansByCreation(null), []);
});

test('Plan Card: formatDateTime formats ISO string cleanly', () => {
  const formatted = formatDateTime('2026-09-27T15:30:00Z');
  assert.ok(formatted.includes('2026-09-27') || formatted.includes('2026-09-28'));
  assert.equal(formatDateTime(''), '');
  assert.equal(formatDateTime(null), '');
});

test('Plan Card: getPlanCardActionState review statuses and edge cases', () => {
  // 1. Not requested (미실행): canRetryReview is true, canApprove is false
  const unrequested = {
    plan_id: 'p-unrequested',
    passed: true,
    violations: 0,
    review: { status: 'not_requested' }
  };
  const actUnrequested = getPlanCardActionState(unrequested);
  assert.equal(actUnrequested.reviewStatus, 'not_requested');
  assert.equal(actUnrequested.canRetryReview, true);
  assert.equal(actUnrequested.canApprove, false);

  // 2. Failed with 503 error details
  const failed503 = {
    plan_id: 'p-503',
    passed: true,
    violations: 0,
    review: {
      status: 'failed',
      message: '검토 모델이 연결되지 않았습니다.',
      error: 503
    }
  };
  const act503 = getPlanCardActionState(failed503);
  assert.equal(act503.reviewStatus, 'failed');
  assert.equal(act503.canRetryReview, true);
  assert.equal(act503.canApprove, false);
  assert.equal(act503.reviewMessage, '검토 모델이 연결되지 않았습니다.');
  assert.equal(act503.reviewError, 503);

  // 3. Stale plan that is already approved: canApprove false, canRetryReview false, isStale true
  const staleApproved = {
    plan_id: 'p-stale-app',
    passed: true,
    violations: 0,
    input_stale: true,
    review: { status: 'passed' },
    approval: { approved_at: '2026-09-26T10:00:00Z' }
  };
  const actStaleApp = getPlanCardActionState(staleApproved);
  assert.equal(actStaleApp.isStale, true);
  assert.equal(actStaleApp.isApproved, true);
  assert.equal(actStaleApp.canApprove, false);
  assert.equal(actStaleApp.canRetryReview, false);
  assert.equal(actStaleApp.approvedAt, '2026-09-26T10:00:00Z');

  // 4. Plan with violations: canApprove false
  const violated = {
    plan_id: 'p-violated',
    passed: false,
    violations: 1,
    review: { status: 'passed' }
  };
  const actViolated = getPlanCardActionState(violated);
  assert.equal(actViolated.canApprove, false);
  assert.equal(actViolated.canRetryReview, false); // already reviewed as passed
});

test('Plan Card: calculateRailStage precedence and stage tokens', () => {
  // Precedence 1: Approved overrides violations
  const approvedWithViolations = {
    plan_id: 'p-app-v',
    passed: false,
    violations: 1,
    approval: { approved_at: '2026-09-27T00:00:00Z' }
  };
  assert.equal(calculateRailStage(approvedWithViolations), 'approved');

  // Precedence 2: Violation when violations > 0
  const violationPlan = {
    plan_id: 'p-viol',
    passed: true,
    violations: 1,
    review: { status: 'passed' }
  };
  assert.equal(calculateRailStage(violationPlan), 'violation');

  // Precedence 3: Ready when canApprove is true
  const readyPlan = {
    plan_id: 'p-rdy',
    passed: true,
    violations: 0,
    review: { status: 'passed' }
  };
  assert.equal(calculateRailStage(readyPlan), 'ready');

  // Fallback: None when not ready, no violations, not approved (e.g. unreviewed or stale)
  const unreviewedPlan = {
    plan_id: 'p-none',
    passed: true,
    violations: 0,
    review: { status: 'not_requested' }
  };
  assert.equal(calculateRailStage(unreviewedPlan), 'none');

  const staleCleanPlan = {
    plan_id: 'p-stale-clean',
    passed: true,
    violations: 0,
    stale: true,
    review: { status: 'passed' }
  };
  assert.equal(calculateRailStage(staleCleanPlan), 'none');
});
