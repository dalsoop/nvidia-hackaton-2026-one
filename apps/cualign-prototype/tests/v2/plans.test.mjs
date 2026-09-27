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

import {
  WORKSPACE_VOCAB
} from '../../src/cualign/server/static/v2/js/domain/vocab/workspace.js';

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

test('Plan Card: null and undefined inputs for badge and action states', () => {
  const defaultBadges = getPlanBadgeState(null);
  assert.equal(defaultBadges.isStale, false);
  assert.equal(defaultBadges.isApproved, false);
  assert.equal(defaultBadges.hasViolations, false);
  assert.equal(defaultBadges.strategyLabel, '');

  const defaultActions = getPlanCardActionState(null);
  assert.equal(defaultActions.canApprove, false);
  assert.equal(defaultActions.isApproved, false);
  assert.equal(defaultActions.canRetryReview, false);
  assert.equal(defaultActions.reviewStatus, 'not_requested');
});

test('Plan Card: stages fallback to info.n_stages and array violations count', () => {
  const planWithInfo = {
    plan_id: 'p-info',
    info: { n_stages: 8 },
    violations: [{ type: 'collision', stage: 2 }],
    passed: true
  };
  const badges = getPlanBadgeState(planWithInfo);
  assert.equal(badges.stagesLabel, '8장');
  assert.equal(badges.hasViolations, true);
  assert.equal(badges.violationsLabel, '위반 1건');
});

test('Plans: sortPlansByCreation does not mutate original array', () => {
  const original = [
    { plan_id: 'p-2', created_at: '2026-09-27T12:00:00Z' },
    { plan_id: 'p-1', created_at: '2026-09-27T10:00:00Z' }
  ];
  const copy = [...original];
  const sorted = sortPlansByCreation(original);

  assert.deepEqual(original, copy);
  assert.equal(sorted[0].plan_id, 'p-1');
  assert.equal(sorted[1].plan_id, 'p-2');
});

test('Workspace Vocab: constants and helper functions format properly', () => {
  assert.equal(WORKSPACE_VOCAB.rules, '규칙');
  assert.equal(WORKSPACE_VOCAB.conditions, '조건');
  assert.equal(WORKSPACE_VOCAB.stages, '단계 표');
  assert.equal(WORKSPACE_VOCAB.agent, '에이전트');
  assert.equal(WORKSPACE_VOCAB.plansTitle, '계획 목록');
  assert.equal(WORKSPACE_VOCAB.plansCount(3), '계획 3개');
  assert.equal(WORKSPACE_VOCAB.stagesCount(12), '12장');
  assert.equal(WORKSPACE_VOCAB.violationsCount(2), '위반 2건');
  assert.equal(WORKSPACE_VOCAB.viewing, '보는 중');
  assert.equal(WORKSPACE_VOCAB.view, '보기');
  assert.equal(WORKSPACE_VOCAB.approveButton, '승인');
  assert.equal(WORKSPACE_VOCAB.confirmAndApprove, '확인하고 승인');
  assert.equal(WORKSPACE_VOCAB.revokeApproval, '승인 취소');
  assert.equal(WORKSPACE_VOCAB.requestReviewRetry, '검토 다시 요청');
  assert.equal(WORKSPACE_VOCAB.reviewModelDisconnected, '검토 모델이 연결되지 않았습니다.');
  assert.equal(WORKSPACE_VOCAB.cannotApproveHint(['이유 1', '이유 2']), '승인 불가 · 이유 1, 이유 2');
  assert.equal(WORKSPACE_VOCAB.calculationFailed('네트워크 오류'), '계산 실패: 네트워크 오류');
  assert.equal(WORKSPACE_VOCAB.loadingCase('P1'), 'P1 케이스를 여는 중...');
  assert.equal(WORKSPACE_VOCAB.strategies.expansion_ipr, '확장 + IPR');
  assert.equal(WORKSPACE_VOCAB.planTitle(1), '계획 1');
  assert.equal(WORKSPACE_VOCAB.reviewBadge('통과'), '검토: 통과');
  assert.equal(WORKSPACE_VOCAB.errorPrefix('연결 실패'), '오류: 연결 실패');
  assert.equal(WORKSPACE_VOCAB.approvedTime('2026-09-27 12:00'), '승인 시각: 2026-09-27 12:00');
  assert.equal(WORKSPACE_VOCAB.emptyPlansMessage, '이 케이스에 생성된 계획이 없습니다.');
});

test('Plan Card: getViolationsCount handles info.violations number and array', () => {
  assert.equal(getViolationsCount({ info: { violations: 4 } }), 4);
  assert.equal(getViolationsCount({ info: { violations: ['c1', 'c2'] } }), 2);
  assert.equal(getViolationsCount({ info: {} }), 0);
});

test('Plan Card: getPlanBadgeState calculates stages from stages array fallback', () => {
  const plan = {
    plan_id: 'p-stages-arr',
    strategy: 'ipr',
    stages: [{ 1: [0, 0, 0] }, { 1: [1, 0, 0] }, { 1: [2, 0, 0] }],
    violations: 0,
    passed: true
  };
  const badgeState = getPlanBadgeState(plan);
  assert.equal(badgeState.stagesLabel, '3장');
  assert.equal(badgeState.strategyLabel, 'IPR');
  assert.equal(badgeState.violationsLabel, '통과');
  assert.equal(badgeState.hasViolations, false);
});

test('Plan Card: calculateRailStage stale approved plan returns none', () => {
  const staleApprovedPlan = {
    plan_id: 'p-stale-approved',
    input_stale: true,
    approval: { approved_at: '2026-09-27T10:00:00Z' }
  };
  assert.equal(calculateRailStage(staleApprovedPlan), 'none');
});

test('Plan Card: getPlanCardActionState approved_at from top-level or string approval', () => {
  const plan1 = {
    plan_id: 'p-str-app',
    approval: '2026-09-27T11:00:00Z',
    passed: true
  };
  const act1 = getPlanCardActionState(plan1);
  assert.equal(act1.isApproved, true);
  assert.equal(act1.approvedAt, '2026-09-27T11:00:00Z');

  const plan2 = {
    plan_id: 'p-top-app',
    approval: true,
    approved_at: '2026-09-27T12:00:00Z',
    passed: true
  };
  const act2 = getPlanCardActionState(plan2);
  assert.equal(act2.isApproved, true);
  assert.equal(act2.approvedAt, '2026-09-27T12:00:00Z');
});


