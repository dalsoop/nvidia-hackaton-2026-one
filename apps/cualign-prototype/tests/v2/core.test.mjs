import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UPPER_UNIVERSAL,
  universalToFdi,
  fdiToUniversal
} from '../../src/cualign/server/static/v2/js/domain/teeth.js';

import {
  caseStatus,
  preferredPlan,
  canApprove
} from '../../src/cualign/server/static/v2/js/domain/status.js';

import { T } from '../../src/cualign/server/static/v2/js/domain/vocab.js';

test('Teeth numbering: UPPER_UNIVERSAL contains 16 maxillary teeth', () => {
  assert.equal(UPPER_UNIVERSAL.length, 16);
  assert.deepEqual(UPPER_UNIVERSAL, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test('Teeth numbering: all 16 universalToFdi conversions', () => {
  const expectedMap = {
    1: 18, 2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11,
    9: 21, 10: 22, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28
  };

  for (const [uStr, fdi] of Object.entries(expectedMap)) {
    const u = Number(uStr);
    assert.equal(universalToFdi(u), fdi, `universalToFdi(${u}) should be ${fdi}`);
    assert.equal(universalToFdi(String(u)), fdi, `universalToFdi("${u}") should be ${fdi}`);
    assert.equal(universalToFdi(`${u}.stl`), fdi, `universalToFdi("${u}.stl") should be ${fdi}`);
    assert.equal(fdiToUniversal(fdi), u, `fdiToUniversal(${fdi}) should be ${u}`);
  }
});

test('Teeth numbering: invalid inputs return null', () => {
  assert.equal(universalToFdi(0), null);
  assert.equal(universalToFdi(17), null);
  assert.equal(universalToFdi('gingiva.stl'), null);
  assert.equal(universalToFdi('invalid'), null);
  assert.equal(fdiToUniversal(99), null);
  assert.equal(fdiToUniversal(null), null);
});

test('Status: caseStatus returns scan_check when scan is unconfirmed', () => {
  const result = caseStatus({
    scan: { scan_id: 'S1', confirmed: false },
    plans: []
  });
  assert.equal(result, 'scan_check');
});

test('Status: caseStatus returns needs_plan when plans array is empty', () => {
  const result = caseStatus({
    scan: { scan_id: 'S1', confirmed: true },
    plans: []
  });
  assert.equal(result, 'needs_plan');
});

test('Status: caseStatus returns violation when representative plan has violations', () => {
  const result = caseStatus({
    scan: { scan_id: 'S1', confirmed: true },
    plans: [
      { plan_id: 'p1', strategy: 'expansion', passed: false, violations: 3 }
    ]
  });
  assert.equal(result, 'violation');
});

test('Status: caseStatus returns ready when representative plan passes with 0 violations', () => {
  const result = caseStatus({
    scan: { scan_id: 'S1', confirmed: true },
    plans: [
      { plan_id: 'p1', strategy: 'expansion', passed: true, violations: 0, approval: null }
    ]
  });
  assert.equal(result, 'ready');
});

test('Status: caseStatus returns approved when plan is approved', () => {
  const result = caseStatus({
    scan: { scan_id: 'S1', confirmed: true },
    plans: [
      { plan_id: 'p1', strategy: 'expansion', passed: true, violations: 0, approval: { confirmed: true } }
    ]
  });
  assert.equal(result, 'approved');
});

test('Status: preferredPlan strategy priority and pass preference', () => {
  const plans = [
    { plan_id: 'p-ipr', strategy: 'ipr', passed: true, violations: 0 },
    { plan_id: 'p-exp', strategy: 'expansion', passed: true, violations: 0 },
    { plan_id: 'p-ext', strategy: 'extraction', passed: true, violations: 0 }
  ];
  const preferred = preferredPlan(plans);
  assert.equal(preferred.plan_id, 'p-exp');

  // If expansion failed, ipr should be chosen
  const plansWithFailedExp = [
    { plan_id: 'p-exp-fail', strategy: 'expansion', passed: false, violations: 2 },
    { plan_id: 'p-ipr-pass', strategy: 'ipr', passed: true, violations: 0 }
  ];
  assert.equal(preferredPlan(plansWithFailedExp).plan_id, 'p-ipr-pass');
});

test('Status: canApprove conditions', () => {
  const validPlan = {
    plan_id: 'p1',
    violations: 0,
    review: { status: 'passed' },
    is_stale: false
  };
  assert.equal(canApprove(validPlan), true);

  const skippedReviewPlan = {
    plan_id: 'p2',
    violations: 0,
    review: { status: 'skipped' },
    is_stale: false
  };
  assert.equal(canApprove(skippedReviewPlan), true);

  assert.equal(canApprove({ ...validPlan, violations: 1 }), false);
  assert.equal(canApprove({ ...validPlan, review: { status: 'failed' } }), false);
  assert.equal(canApprove({ ...validPlan, review: { status: 'pending' } }), false);
  assert.equal(canApprove({ ...validPlan, is_stale: true }), false);
  assert.equal(canApprove({ ...validPlan, stale_scan: true }), false);
  assert.equal(canApprove(null), false);
});

test('Vocab: formatting functions produce expected Korean text', () => {
  assert.equal(T.violations(0), '위반 0건');
  assert.equal(T.violations(5), '위반 5건');
  assert.equal(T.stagesCount(18), '18장');
  assert.equal(T.monthsCount(12), '12개월');
  assert.equal(T.teethCount(14), '치아 14개');
  assert.equal(T.status.scan_check, '스캔 확인 필요');
  assert.equal(T.status.approved, '승인됨');
  assert.equal(T.rail.steps.cases, '케이스');
  assert.equal(T.rail.steps.workspace, '작업대');
});
