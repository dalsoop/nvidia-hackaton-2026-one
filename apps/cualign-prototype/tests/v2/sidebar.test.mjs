import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupViolations,
  VIOLATION_LABELS
} from '../../src/cualign/server/static/v2/js/screens/workspace/sidebar/checks.js';

import {
  calculateConditionDiff,
  normalizeToothList,
  DEFAULT_CONSTRAINTS
} from '../../src/cualign/server/static/v2/js/screens/workspace/sidebar/conditions.js';

import {
  getFdiColumnsForPlan,
  getToothMovementInfo,
  hasToothCollision
} from '../../src/cualign/server/static/v2/js/screens/workspace/sidebar/staging.js';
import {
  planStageIndex,
  resolveCreatedPlanId,
  selectViewingPlan,
  violationCount
} from '../../src/cualign/server/static/v2/js/screens/workspace/sidebar/plan-state.js';

// ============================================================================
// 1. Grouping Violations Tests (위반 묶기)
// ============================================================================

test('groupViolations: handles empty or invalid inputs', () => {
  const empty = groupViolations([]);
  assert.equal(empty.length, 0);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.byType, {});

  const nullRes = groupViolations(null);
  assert.equal(nullRes.length, 0);
  assert.equal(nullRes.total, 0);

  const undefinedRes = groupViolations(undefined);
  assert.equal(undefinedRes.length, 0);
});

test('groupViolations: groups collisions by tooth pair and maps to FDI', () => {
  const rawViolations = [
    { stage: 1, type: 'collision', teeth: [8, 9], overlap_mm3: 0.12 },
    { stage: 2, type: 'collision', teeth: [9, 8], overlap_mm3: 0.28 }, // Reverse order, same pair
    { stage: 4, type: 'collision', teeth: [8, 9], overlap_mm3: 0.05 },
    { stage: 2, type: 'collision', teeth: [9, 10], overlap_mm3: 0.15 } // Different pair
  ];

  const grouped = groupViolations(rawViolations);
  assert.equal(grouped.length, 1);
  assert.equal(grouped.total, 4);

  const colGroup = grouped.byType.collision;
  assert.ok(colGroup);
  assert.equal(colGroup.type, 'collision');
  assert.equal(colGroup.count, 4);
  assert.equal(colGroup.pairs.length, 2);

  // Pair [8, 9] -> Universal [8, 9] corresponds to FDI [11, 21]
  const pair89 = colGroup.pairs.find(p => p.pairKey === '8-9');
  assert.ok(pair89);
  assert.deepEqual(pair89.teeth, [8, 9]);
  assert.deepEqual(pair89.fdiTeeth, [11, 21]);
  assert.equal(pair89.count, 3);
  assert.deepEqual(pair89.stages, [1, 2, 4]);
  assert.equal(pair89.maxOverlap, 0.28);

  // Pair [9, 10] -> Universal [9, 10] corresponds to FDI [21, 22]
  const pair910 = colGroup.pairs.find(p => p.pairKey === '9-10');
  assert.ok(pair910);
  assert.deepEqual(pair910.teeth, [9, 10]);
  assert.deepEqual(pair910.fdiTeeth, [21, 22]);
  assert.equal(pair910.count, 1);
  assert.deepEqual(pair910.stages, [2]);
  assert.equal(pair910.maxOverlap, 0.15);
});

test('groupViolations: groups single-tooth violations (move_limit, rotation_limit, locked_tooth)', () => {
  const rawViolations = [
    { stage: 1, type: 'move_limit', teeth: [8], mm: 0.32 },
    { stage: 3, type: 'move_limit', teeth: [8], mm: 0.28 },
    { stage: 2, type: 'move_limit', teeth: [9], mm: 0.35 },
    { stage: 1, type: 'rotation_limit', teeth: [7], deg: 3.2 },
    { stage: 4, type: 'locked_tooth', teeth: [13] }
  ];

  const grouped = groupViolations(rawViolations);
  assert.equal(grouped.length, 3); // move_limit, rotation_limit, locked_tooth

  const moveGroup = grouped.byType.move_limit;
  assert.ok(moveGroup);
  assert.equal(moveGroup.count, 3);
  assert.equal(moveGroup.byTooth.length, 2);

  const tooth8 = moveGroup.byTooth.find(t => t.tooth === 8);
  assert.ok(tooth8);
  assert.equal(tooth8.tooth, 8);
  assert.equal(tooth8.fdiTooth, 11);
  assert.equal(tooth8.count, 2);
  assert.deepEqual(tooth8.stages, [1, 3]);

  const rotGroup = grouped.byType.rotation_limit;
  assert.ok(rotGroup);
  assert.equal(rotGroup.byTooth[0].fdiTooth, 12); // Universal 7 -> FDI 12

  const lockGroup = grouped.byType.locked_tooth;
  assert.ok(lockGroup);
  assert.equal(lockGroup.byTooth[0].fdiTooth, 25); // Universal 13 -> FDI 25
});

test('groupViolations: groups general and plan-level violations (space_deficit, stage_cap, ipr_limit)', () => {
  const rawViolations = [
    { stage: null, type: 'space_deficit', mm: 0.8, limit: 0 },
    { stage: null, type: 'stage_cap', n: 25, limit: 20 },
    { stage: null, type: 'ipr_limit', mm: 0.3, limit: 0.25 }
  ];

  const grouped = groupViolations(rawViolations);
  assert.equal(grouped.length, 3);

  const spaceGroup = grouped.byType.space_deficit;
  assert.ok(spaceGroup);
  assert.equal(spaceGroup.count, 1);
  assert.equal(spaceGroup.general.length, 1);
  assert.equal(spaceGroup.general[0].mm, 0.8);
});

// ============================================================================
// 2. Calculating Condition Diff Tests (조건 차이 계산)
// ============================================================================

test('calculateConditionDiff: returns empty diff when values are identical', () => {
  const base = {
    allow_extraction: false,
    lock: [13, 14],
    ipr_exclude: [7, 8, 9, 10],
    ipr_limit_mm: 0.25,
    stage_cap: 20,
    order: 'simultaneous'
  };

  const currentSame = {
    allow_extraction: false,
    lock: [14, 13], // Different ordering, same set of teeth
    ipr_exclude: [7, 8, 9, 10],
    ipr_limit_mm: 0.25,
    stage_cap: 20,
    order: 'simultaneous'
  };

  const diff = calculateConditionDiff(currentSame, base);
  assert.deepEqual(diff, {});
});

test('calculateConditionDiff: detects allow_extraction toggle', () => {
  const base = { allow_extraction: false };

  const diffOn = calculateConditionDiff({ allow_extraction: true }, base);
  assert.deepEqual(diffOn, { allow_extraction: true });

  const diffOff = calculateConditionDiff({ allow_extraction: false }, { allow_extraction: true });
  assert.deepEqual(diffOff, { allow_extraction: false });
});

test('calculateConditionDiff: detects locked teeth changes with set-normalization', () => {
  const base = { lock: [13] };

  // Added tooth 14
  const diffAdd = calculateConditionDiff({ lock: [13, 14] }, base);
  assert.deepEqual(diffAdd, { lock: [13, 14] });

  // Emptied locked teeth
  const diffEmpty = calculateConditionDiff({ lock: [] }, base);
  assert.deepEqual(diffEmpty, { lock: [] });

  // String input is interpreted as FDI and converted for the API.
  const diffString = calculateConditionDiff({ lock: '13, 14' }, base);
  assert.deepEqual(diffString, { lock: [5, 6] });

  // Duplicate tooth numbers and reverse order normalized
  const diffDuplicates = calculateConditionDiff({ lock: [13, 13] }, base);
  assert.deepEqual(diffDuplicates, {}); // [13, 13] === [13]
});

test('calculateConditionDiff: detects IPR exclusion list changes', () => {
  const base = { ipr_exclude: [8, 9] };

  const diff = calculateConditionDiff({ ipr_exclude: [7, 8, 9, 10] }, base);
  assert.deepEqual(diff, { ipr_exclude: [7, 8, 9, 10] });

  const diffCleared = calculateConditionDiff({ ipr_exclude: [] }, base);
  assert.deepEqual(diffCleared, { ipr_exclude: [] });
});

test('calculateConditionDiff: detects IPR limit changes within 0..0.25mm', () => {
  const base = { ipr_limit_mm: 0.25 };

  const diffReduced = calculateConditionDiff({ ipr_limit_mm: 0.15 }, base);
  assert.equal(diffReduced.ipr_limit_mm, 0.15);

  // Clamping to max 0.25
  const diffExceeded = calculateConditionDiff({ ipr_limit_mm: 0.4 }, base);
  assert.deepEqual(diffExceeded, {}); // Clamped to 0.25, matches base
});

test('calculateConditionDiff: handles stage_cap and clear_stage_cap properly', () => {
  // Case A: Set cap when previously null
  const baseNull = { stage_cap: null };
  const diffSet = calculateConditionDiff({ stage_cap: 18 }, baseNull);
  assert.deepEqual(diffSet, { stage_cap: 18 });

  // Case B: Clear existing cap -> sets clear_stage_cap: true
  const baseWithCap = { stage_cap: 20 };
  const diffClearedNull = calculateConditionDiff({ stage_cap: null }, baseWithCap);
  assert.deepEqual(diffClearedNull, { clear_stage_cap: true });

  const diffClearedEmptyStr = calculateConditionDiff({ stage_cap: '' }, baseWithCap);
  assert.deepEqual(diffClearedEmptyStr, { clear_stage_cap: true });

  // Case C: Value changed
  const diffChanged = calculateConditionDiff({ stage_cap: 15 }, baseWithCap);
  assert.deepEqual(diffChanged, { stage_cap: 15 });

  // Case D: Same value
  const diffSame = calculateConditionDiff({ stage_cap: 20 }, baseWithCap);
  assert.deepEqual(diffSame, {});
});

test('calculateConditionDiff: detects movement order changes', () => {
  const base = { order: 'simultaneous' };

  const diffAnterior = calculateConditionDiff({ order: 'anterior_first' }, base);
  assert.deepEqual(diffAnterior, { order: 'anterior_first' });

  const diffSequential = calculateConditionDiff({ order: 'sequential' }, base);
  assert.deepEqual(diffSequential, { order: 'sequential' });
});

test('calculateConditionDiff: computes composite diff for multiple changed fields', () => {
  const base = {
    allow_extraction: false,
    lock: [],
    ipr_exclude: [],
    ipr_limit_mm: 0.25,
    stage_cap: 24,
    order: 'simultaneous'
  };

  const current = {
    allow_extraction: true,
    lock: [13],
    ipr_exclude: [8, 9],
    ipr_limit_mm: 0.2,
    stage_cap: null,
    order: 'anterior_first'
  };

  const diff = calculateConditionDiff(current, base);
  assert.deepEqual(diff, {
    allow_extraction: true,
    lock: [13],
    ipr_exclude: [8, 9],
    ipr_limit_mm: 0.2,
    clear_stage_cap: true,
    order: 'anterior_first'
  });
});

test('calculateConditionDiff: compares against DEFAULT_CONSTRAINTS when base is omitted', () => {
  const diff = calculateConditionDiff({
    allow_extraction: true,
    stage_cap: 16
  });

  assert.deepEqual(diff, {
    allow_extraction: true,
    stage_cap: 16
  });
});

// ============================================================================
// 3. Tooth Input Normalization Tests
// ============================================================================

test('normalizeToothList: accepts FDI display numbers and returns Universal API numbers', () => {
  assert.deepEqual(normalizeToothList('13, 14, 13'), [5, 6]);

  // FDI numbers > 16 converted to Universal:
  // FDI 21 -> Universal 9, FDI 22 -> Universal 10
  assert.deepEqual(normalizeToothList('21, 22'), [9, 10]);

  assert.deepEqual(normalizeToothList('13, 25'), [6, 13]);

  // Values outside the supported upper-arch FDI range are ignored.
  assert.deepEqual(normalizeToothList('1, 10, 29, 99'), []);
});

test('plan state helpers prefer the full viewing plan and use stageIndex', () => {
  const summary = { plan_id: 'p-summary', violations: 3 };
  const full = { plan_id: 'p-full', stages: [{}], violations: [] };
  assert.equal(selectViewingPlan({ viewingPlan: full, viewingPlanId: full.plan_id, plans: [summary] }), full);
  assert.equal(selectViewingPlan({ viewingPlan: full, viewingPlanId: summary.plan_id, plans: [summary] }), summary);
  assert.equal(selectViewingPlan({ viewingPlanId: summary.plan_id, plans: [summary] }), summary);
  assert.equal(violationCount(summary), 3);
  assert.equal(violationCount(full), 0);
  assert.equal(planStageIndex({ stageIndex: 4, stage: 'violation' }), 4);
  assert.equal(planStageIndex({ stage: 4 }), 0);
});

test('resolveCreatedPlanId selects the new rule-plan result before list fallback', () => {
  assert.equal(resolveCreatedPlanId({ chosen: { plan_id: 'p-chosen' } }, [{ plan_id: 'p-list' }]), 'p-chosen');
  assert.equal(resolveCreatedPlanId({ best_failed: { plan_id: 'p-failed' } }, [{ plan_id: 'p-list' }]), 'p-failed');
  assert.equal(resolveCreatedPlanId({ tried: [{ plan_id: 'p-tried' }] }, [{ plan_id: 'p-list' }]), 'p-tried');
});

// ============================================================================
// 4. Staging Utilities Tests
// ============================================================================

test('getFdiColumnsForPlan: returns FDI teeth sorted in dental arch order', () => {
  const plan = {
    stages: [
      { '6': [0, 0, 0], '7': [0, 0, 0], '8': [0, 0, 0], '9': [0, 0, 0], '10': [0, 0, 0], '11': [0, 0, 0] }
    ]
  };

  // Universal: 6, 7, 8, 9, 10, 11
  // FDI: 13, 12, 11 (Q1 descending), 21, 22, 23 (Q2 ascending)
  const columns = getFdiColumnsForPlan(plan);
  assert.deepEqual(columns, [13, 12, 11, 21, 22, 23]);
});

test('getToothMovementInfo and hasToothCollision: identify movements and collision rings', () => {
  const plan = {
    constraints: { lock: [6] },
    target: { removed: [5] },
    stages: [
      { '8': [0.1, 0, 0], '9': [0, 0, 0.2] } // Stage 1
    ],
    rotations: [
      { '8': 1.5, '9': 0 }
    ],
    violations: [
      { stage: 1, type: 'collision', teeth: [8, 9], overlap_mm3: 0.18 }
    ]
  };

  // Locked tooth 6
  assert.equal(getToothMovementInfo(plan, 1, 6).kind, 'locked');

  // Removed tooth 5
  assert.equal(getToothMovementInfo(plan, 1, 5).kind, 'extracted');

  // Tooth 8 has rotation >= 0.5 deg
  assert.equal(getToothMovementInfo(plan, 1, 8).kind, 'rot');

  // Tooth 9 has vertical displacement (dz = 0.2)
  assert.equal(getToothMovementInfo(plan, 1, 9).kind, 'vert');

  // Collision detection
  assert.equal(hasToothCollision(plan, 1, 8), true);
  assert.equal(hasToothCollision(plan, 1, 9), true);
  assert.equal(hasToothCollision(plan, 1, 10), false);
  assert.equal(hasToothCollision(plan, 2, 8), false); // Stage 2 has no collision
});

test('calculateConditionDiff: handles explicit clear_stage_cap flag', () => {
  const base = { stage_cap: 20 };
  const diff = calculateConditionDiff({ clear_stage_cap: true }, base);
  assert.deepEqual(diff, { clear_stage_cap: true });

  // If already null, clear_stage_cap is not added
  const diffNull = calculateConditionDiff({ clear_stage_cap: true }, { stage_cap: null });
  assert.deepEqual(diffNull, {});
});

test('calculateConditionDiff: clamps negative ipr_limit_mm to 0', () => {
  const base = { ipr_limit_mm: 0.25 };
  const diff = calculateConditionDiff({ ipr_limit_mm: -0.1 }, base);
  assert.equal(diff.ipr_limit_mm, 0);
});

test('groupViolations: handles numeric strings in teeth and stages', () => {
  const rawViolations = [
    { stage: '2', type: 'collision', teeth: ['8', '9'], overlap_mm3: '0.22' },
    { stage: 2, type: 'collision', teeth: ['9', '8'], overlap_mm3: 0.1 }
  ];

  const grouped = groupViolations(rawViolations);
  assert.equal(grouped.length, 1);
  assert.equal(grouped.total, 2);

  const colGroup = grouped.byType.collision;
  assert.equal(colGroup.pairs.length, 1);
  assert.deepEqual(colGroup.pairs[0].teeth, [8, 9]);
  assert.deepEqual(colGroup.pairs[0].stages, [2]);
  assert.equal(colGroup.pairs[0].maxOverlap, 0.22);
});

test('groupViolations: handles extraction_forbidden and general violations with stage', () => {
  const raw = [
    { stage: 3, type: 'extraction_forbidden', teeth: [4] },
    { stage: 5, type: 'space_deficit', mm: 1.2, limit: 0 }
  ];

  const grouped = groupViolations(raw);
  assert.equal(grouped.length, 2);
  const extGroup = grouped.byType.extraction_forbidden;
  assert.equal(extGroup.count, 1);
  assert.equal(extGroup.byTooth[0].tooth, 4);
  assert.deepEqual(extGroup.byTooth[0].stages, [3]);

  const spaceGroup = grouped.byType.space_deficit;
  assert.equal(spaceGroup.count, 1);
  assert.equal(spaceGroup.general[0].stage, 5);
});

test('hasToothCollision: handles string stage and string tooth in teeth array', () => {
  const plan = {
    violations: [
      { stage: '3', type: 'collision', teeth: ['8', '9'] }
    ]
  };

  assert.equal(hasToothCollision(plan, 3, 8), true);
  assert.equal(hasToothCollision(plan, 3, 9), true);
  assert.equal(hasToothCollision(plan, 3, 10), false);
  assert.equal(hasToothCollision(plan, 1, 8), false);
  assert.equal(hasToothCollision(null, 3, 8), false);
});

test('getFdiColumnsForPlan: handles null, missing stages, and full maxillary arch', () => {
  // Null plan returns standard 14 teeth (17..11, 21..27)
  const defaultCols = getFdiColumnsForPlan(null);
  assert.equal(defaultCols.length, 14);
  assert.equal(defaultCols[0], 17);
  assert.equal(defaultCols[defaultCols.length - 1], 27);

  // Full 16 teeth arch including wisdom teeth 1 (18) and 16 (28)
  const fullPlan = {
    stages: [
      { '1': [0, 0, 0], '8': [0, 0, 0], '9': [0, 0, 0], '16': [0, 0, 0] }
    ]
  };
  const fullCols = getFdiColumnsForPlan(fullPlan);
  assert.deepEqual(fullCols, [18, 11, 21, 28]);
});

test('getToothMovementInfo: returns idle for zero displacement and handles stage 0', () => {
  const plan = {
    stages: [{ '8': [0, 0, 0] }],
    rotations: [{ '8': 0 }]
  };

  assert.equal(getToothMovementInfo(plan, 0, 8).kind, 'idle');
  assert.equal(getToothMovementInfo(plan, 1, 8).kind, 'idle');
});

test('SIDEBAR_VOCAB: contains all required Korean strings for tabs, staging, rules, and conditions', async () => {
  const { SIDEBAR_VOCAB } = await import('../../src/cualign/server/static/v2/js/domain/vocab/sidebar.js');

  assert.equal(SIDEBAR_VOCAB.tabs.stages, '단계 표');
  assert.equal(SIDEBAR_VOCAB.tabs.rules, '규칙');
  assert.equal(SIDEBAR_VOCAB.tabs.conditions, '조건');

  assert.equal(SIDEBAR_VOCAB.conditions.recalculate, '이 조건으로 계산');
  assert.equal(SIDEBAR_VOCAB.conditions.allowExtraction, '발치 허용');
  assert.equal(SIDEBAR_VOCAB.conditions.prescriptionBannerTitle, '처방 문장 (의사 진단)');

  assert.equal(SIDEBAR_VOCAB.rules.violations.collision, '치아 충돌');
  assert.equal(SIDEBAR_VOCAB.rules.violations.move_limit, '이동량 한도 초과');
  assert.equal(SIDEBAR_VOCAB.rules.violations.rotation_limit, '회전 한도 초과');
  assert.equal(SIDEBAR_VOCAB.rules.violations.locked_tooth, '고정 치아 이동');
  assert.equal(SIDEBAR_VOCAB.rules.violations.stage_cap, '단계 상한 초과');
});
