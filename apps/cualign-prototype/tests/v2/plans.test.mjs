import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateRailStage,
  formatDateTime,
  formatPlanTitle,
  getPlanBadgeState,
  getPlanCardActionState,
  getStrategyLabel,
  getViolationsCount,
  isPlanStale
} from '../../src/cualign/server/static/v2/js/screens/workspace/plan-card.js';
import {
  fetchPlanDetails,
  planId,
  sortPlansByCreation
} from '../../src/cualign/server/static/v2/js/screens/workspace/plans.js';
import { WORKSPACE_VOCAB as W } from '../../src/cualign/server/static/v2/js/domain/vocab/workspace.js';

const clean = (review = 'passed') => ({
  plan_id: 'p-clean',
  strategy: 'expansion',
  passed: true,
  violations: [],
  review: { status: review },
  input_stale: false,
  stages: [{}, {}]
});

test('server summary and detailed response keep distinct violation shapes', () => {
  assert.equal(getViolationsCount({ violations: 7 }), 7);
  assert.equal(getViolationsCount({ violations: [{ type: 'collision' }] }), 1);
  assert.equal(getViolationsCount({ info: { violations: 3 } }), 3);
  assert.equal(getViolationsCount(null), 0);
});

test('only the server input_stale field marks a plan stale', () => {
  assert.equal(isPlanStale({ input_stale: true }), true);
  assert.equal(isPlanStale({ input_stale: false, stale: true, stale_scan: true }), false);
  assert.equal(isPlanStale(null), false);
});

test('rail state uses detailed approval, violations, review, and stale state', () => {
  assert.equal(calculateRailStage({ ...clean(), approval: { approved_at: '2026-09-27T00:00:00Z' } }), 'approved');
  assert.equal(calculateRailStage({ ...clean(), passed: false, violations: [{}] }), 'violation');
  assert.equal(calculateRailStage(clean()), 'ready');
  assert.equal(calculateRailStage(clean('not_requested')), 'none');
  assert.equal(calculateRailStage({ ...clean(), input_stale: true }), 'none');
  assert.equal(calculateRailStage(null), 'none');
});

test('review retry is restricted to not_requested and failed', () => {
  for (const status of ['not_requested', 'failed']) {
    assert.equal(getPlanCardActionState(clean(status)).canRetryReview, true);
  }
  const skipped = getPlanCardActionState(clean('skipped'));
  assert.equal(skipped.canApprove, true);
  assert.equal(skipped.canRetryReview, false);
  assert.equal(getPlanCardActionState(clean('passed')).canRetryReview, false);
});

test('stale and approved plans cannot be approved again', () => {
  const stale = getPlanCardActionState({ ...clean(), input_stale: true });
  assert.equal(stale.isStale, true);
  assert.equal(stale.canApprove, false);
  const approved = getPlanCardActionState({ ...clean(), approval: { approved_at: '2026-09-27T12:00:00Z' } });
  assert.equal(approved.isApproved, true);
  assert.equal(approved.canApprove, false);
  assert.equal(approved.approvedAt, '2026-09-27T12:00:00Z');
});

test('badge state supports summary and detailed stage counts', () => {
  const summary = getPlanBadgeState({ strategy: 'expansion_ipr', n_stages: 9, passed: false, violations: 2 });
  assert.deepEqual(
    [summary.strategyLabel, summary.stagesLabel, summary.violationsLabel, summary.hasViolations],
    ['확장 + IPR', '9장', '위반 2건', true]
  );
  const detailed = getPlanBadgeState(clean());
  assert.equal(detailed.stagesLabel, '2장');
  assert.equal(detailed.violationsLabel, '통과');
});

test('strategy and title labels are deterministic', () => {
  assert.equal(getStrategyLabel('expansion'), '확장');
  assert.equal(getStrategyLabel('ipr'), 'IPR');
  assert.equal(getStrategyLabel('unknown'), 'unknown');
  assert.equal(getStrategyLabel(null), '전략 미정');
  assert.equal(formatPlanTitle(0), '계획 1');
  assert.equal(formatPlanTitle(2), '계획 3');
});

test('plan list is sorted once from newest-first server order', () => {
  const newestFirst = [{ plan_id: 'p3' }, { plan_id: 'p2' }, { plan_id: 'p1' }];
  assert.deepEqual(sortPlansByCreation(newestFirst).map(planId), ['p1', 'p2', 'p3']);
  assert.deepEqual(newestFirst.map(planId), ['p3', 'p2', 'p1']);
  const dated = [
    { plan_id: 'p2', created_at: '2026-09-27T11:00:00Z' },
    { plan_id: 'p1', created_at: '2026-09-27T10:00:00Z' }
  ];
  assert.deepEqual(sortPlansByCreation(dated).map(planId), ['p1', 'p2']);
  assert.deepEqual(sortPlansByCreation(null), []);
});

test('fetchPlanDetails always resolves the selected plan through getPlan', async () => {
  const calls = [];
  const api = { getPlan: async (id) => { calls.push(id); return { ...clean(), plan_id: id }; } };
  const detail = await fetchPlanDetails(api, { plan_id: 'p-selected', violations: 0 });
  assert.deepEqual(calls, ['p-selected']);
  assert.equal(detail.plan_id, 'p-selected');
  assert.equal(detail.stages.length, 2);
  await assert.rejects(() => fetchPlanDetails({}, 'p-selected'), TypeError);
});

test('workspace vocabulary matches review, approval, and failure states', () => {
  assert.equal(W.reviewLine('계획 3', W.skipped), '계획 3 검토 · 미실행 (규칙 폴백)');
  assert.equal(W.confirmAndApprove, '조건·3D·검토 확인 — 승인');
  assert.equal(W.cannotApproveViolations(7), '위반 7건을 해결해야 승인할 수 있습니다');
  assert.equal(W.noStages, '계획이 없어 단계가 없습니다.');
  assert.deepEqual(W.constraintTags({
    allow_extraction: false,
    ipr_exclude: [2, 3, 14, 15],
    ipr_limit_mm: 0.25,
    stage_cap: null,
    order: 'simultaneous'
  }), ['비발치', 'IPR 제외 17, 16, 26, 27', '면당 0.25 mm', '단계 상한 없음', '이동 동시']);
});

test('date formatting is stable and preserves invalid values', () => {
  const formatted = formatDateTime('2026-09-27T15:30:00Z');
  assert.match(formatted, /^2026-09-(27|28) \d{2}:\d{2}$/);
  assert.equal(formatDateTime('not-a-date'), 'not-a-date');
  assert.equal(formatDateTime(null), '');
});
