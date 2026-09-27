import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStagingModel,
  classifyToothMove,
  STANDARD_FDI_TEETH,
  MOVE_TYPE_HEX
} from '../../src/cualign/server/static/v2/js/domain/staging-model.js';

// ============================================================================
// Fixtures modeled after Poseidon-000001 and Poseidon-000131
// ============================================================================

/**
 * 000001-shaped plan: 18 stages, expansion strategy, collisions on teeth 12-13
 */
function makeFakePlan000001() {
  const stages = [];
  const rotations = [];

  for (let s = 1; s <= 18; s++) {
    const fraction = s / 18;
    stages.push({
      // Universal 2 (FDI 17): molar arch expansion on X
      '2': [-1.7939 * fraction, 0.148 * fraction, 0.0],
      // Universal 3 (FDI 16): molar arch expansion on X
      '3': [-1.7939 * fraction, 0.148 * fraction, 0.0],
      // Universal 4 (FDI 15): premolar buccolingual
      '4': [-2.5274 * fraction, 0.494 * fraction, 0.0],
      // Universal 5 (FDI 14): premolar buccolingual
      '5': [-3.5953 * fraction, 1.334 * fraction, -1.9116 * fraction],
      // Universal 6 (FDI 13): canine extrusion/vertical
      '6': [-0.3116 * fraction, 0.0841 * fraction, 3.1399 * fraction],
      // Universal 7 (FDI 12): lateral incisor buccolingual
      '7': [-1.4278 * fraction, 2.4457 * fraction, 0.0],
      // Universal 8 (FDI 11): central incisor rotation
      '8': [-0.0248 * fraction, 0.24 * fraction, 0.0],
      // Universal 9 (FDI 21): central incisor buccolingual
      '9': [0.1094 * fraction, 1.8154 * fraction, 0.0],
      // Universal 10 (FDI 22): lateral incisor buccolingual
      '10': [0.6696 * fraction, 1.716 * fraction, 0.0],
      // Universal 11 (FDI 23): canine extrusion
      '11': [0.5917 * fraction, 0.1997 * fraction, 1.3846 * fraction],
      // Universal 12 (FDI 24): premolar buccolingual
      '12': [2.9827 * fraction, 0.5884 * fraction, -1.388 * fraction],
      // Universal 13 (FDI 25): premolar buccolingual
      '13': [1.7973 * fraction, 0.1472 * fraction, 0.0],
      // Universal 14 (FDI 26): molar complex
      '14': [1.7881 * fraction, 0.2066 * fraction, -1.6288 * fraction],
      // Universal 15 (FDI 27): molar complex
      '15': [1.7881 * fraction, 0.2066 * fraction, 0.0]
    });

    rotations.push({
      '8': -24.3 * fraction
    });
  }

  // 7 collision violations on Universal [6, 7] (FDI [12, 13]) from stage 6 to 12
  const violations = [];
  for (let st = 6; st <= 12; st++) {
    violations.push({
      stage: st,
      type: 'collision',
      teeth: [6, 7],
      overlap_mm3: st === 9 ? 1.47 : 1.27,
      baseline: 0.23
    });
  }

  return {
    plan_id: 'p-fake-000001',
    case_id: 'poseidon-000001',
    strategy: 'expansion',
    info: {
      n_stages: 18,
      per_stage_mm: 0.238,
      max_move_mm: 4.28,
      crowding_mm: 4.2,
      secured_mm: 4.25
    },
    stages,
    rotations,
    violations
  };
}

/**
 * 000131-shaped plan: 9 stages, expansion strategy, clean (no violations)
 */
function makeFakePlan000131() {
  const stages = [];
  const rotations = [];

  for (let s = 1; s <= 9; s++) {
    const fraction = s / 9;
    stages.push({
      '2': [-0.984 * fraction, 0.178 * fraction, 0.0],
      '3': [-0.984 * fraction, 0.178 * fraction, 0.0],
      '7': [-0.575 * fraction, -0.066 * fraction, 1.429 * fraction], // FDI 12
      '8': [-0.873 * fraction, 0.858 * fraction, 0.0]
    });

    rotations.push({
      '7': -14.24 * fraction // FDI 12
    });
  }

  return {
    plan_id: 'p-fake-000131',
    case_id: 'poseidon-000131',
    strategy: 'expansion',
    info: {
      n_stages: 9,
      per_stage_mm: 0.232,
      max_move_mm: 2.09
    },
    stages,
    rotations,
    violations: []
  };
}

// ============================================================================
// Tests
// ============================================================================

test('buildStagingModel: handles null and empty plan safely', () => {
  const empty = buildStagingModel(null);
  assert.deepEqual(empty.colLabels, STANDARD_FDI_TEETH);
  assert.equal(empty.nStages, 0);
  assert.deepEqual(empty.bars, []);
  assert.deepEqual(empty.dots, []);
  assert.deepEqual(empty.collisions, []);
  assert.equal(empty.summary, null);
  assert.equal(empty.moveHistoryText, '');
});

test('buildStagingModel: plan 000001 summary asserts values without months', () => {
  const plan = makeFakePlan000001();
  const model = buildStagingModel(plan);

  assert.ok(model.summary);
  assert.equal(model.summary.strategy, '확장');
  assert.equal(model.summary.totalStages, 18);
  assert.equal(model.summary.totalStagesText, '18장');
  assert.equal(model.summary.maxMovePerStageMm, 0.238);
  assert.equal(model.summary.maxMovePerStageText, '0.238 mm');
  assert.equal(model.summary.crowdingMm, 4.2);
  assert.equal(model.summary.securedMm, 4.25);
  assert.equal(model.summary.crowdingSecuredText, '총생 4.2 mm → 확보 4.25 mm');

  // Verify months field is NOT in summary
  assert.equal('months' in model.summary, false);
});

test('buildStagingModel: plan 000001 tooth movement types and bar ranges', () => {
  const plan = makeFakePlan000001();
  const model = buildStagingModel(plan);

  assert.equal(model.nStages, 18);
  assert.equal(model.rowLabels.length, 19); // 0..18

  // Molar 17, 16 -> 복합
  assert.equal(model.teeth[17].moveType, '복합');
  assert.equal(model.teeth[17].moveTypeKey, 'complex');
  assert.equal(model.teeth[17].startStage, 1);
  assert.equal(model.teeth[17].endStage, 18);

  // Canine 13 -> 정출함입
  assert.equal(model.teeth[13].moveType, '정출함입');
  assert.equal(model.teeth[13].moveTypeKey, 'extrusion');
  assert.ok(model.teeth[13].dz >= 3.0);

  // Incisor 11 -> 회전
  assert.equal(model.teeth[11].moveType, '회전');
  assert.equal(model.teeth[11].moveTypeKey, 'rotation');
  assert.equal(model.teeth[11].rotDeg, -24.3);

  // Premolar 14 -> 협설
  assert.equal(model.teeth[14].moveType, '협설');
  assert.equal(model.teeth[14].moveTypeKey, 'buccolingual');

  // Molar 26, 27 -> 복합
  assert.equal(model.teeth[26].moveType, '복합');
  assert.equal(model.teeth[27].moveType, '복합');

  // Verify bars count equals active moving teeth (14 teeth)
  assert.equal(model.bars.length, 14);
  const bar11 = model.bars.find(b => b.fdi === 11);
  assert.ok(bar11);
  assert.equal(bar11.color, MOVE_TYPE_HEX.rotation);
  assert.equal(bar11.startStage, 1);
  assert.equal(bar11.endStage, 18);
});

test('buildStagingModel: plan 000001 collision detection on neighbor teeth', () => {
  const plan = makeFakePlan000001();
  const model = buildStagingModel(plan);

  assert.equal(model.collisions.length, 1);
  const col = model.collisions[0];
  assert.deepEqual(col.teeth, [12, 13]); // sorted pair
  assert.deepEqual(col.stages, [6, 7, 8, 9, 10, 11, 12]);
  assert.equal(col.overlapMm3, 1.47);
  assert.equal(col.baseline, 0.23);

  // Links connect the 2 neighbor teeth for 7 stages
  assert.equal(model.links.length, 7);
  assert.deepEqual(model.links[0].pair, [12, 13]);
  assert.equal(model.links[0].stage, 6);

  // Rings exist on both teeth for 7 stages (14 rings total)
  assert.equal(model.rings.length, 14);
  const ring13 = model.rings.filter(r => r.fdi === 13);
  assert.equal(ring13.length, 7);
});

test('buildStagingModel: plan 000001 moveHistoryText line', () => {
  const plan = makeFakePlan000001();
  const model = buildStagingModel(plan);

  assert.ok(model.moveHistoryText.includes('악궁 편측 1.8mm 확장'));
  assert.ok(model.moveHistoryText.includes('11 회전 −24.3°'));
  assert.ok(model.moveHistoryText.includes('13 수직 +3.1mm'));
  assert.ok(model.moveHistoryText.includes('14 수직 −1.9mm'));
  assert.ok(model.moveHistoryText.includes('23 수직 +1.4mm'));
  assert.ok(model.moveHistoryText.includes('26 수직 −1.6mm'));
});

test('buildStagingModel: plan 000131 clean plan without crowding fields in summary', () => {
  const plan = makeFakePlan000131();
  const model = buildStagingModel(plan);

  assert.equal(model.nStages, 9);
  assert.equal(model.collisions.length, 0);
  assert.equal(model.links.length, 0);
  assert.equal(model.rings.length, 0);

  assert.equal(model.summary.strategy, '확장');
  assert.equal(model.summary.totalStages, 9);
  assert.equal(model.summary.maxMovePerStageMm, 0.232);

  // Server doesn't provide crowding/secured in info for 131 -> must be null
  assert.equal(model.summary.crowdingMm, null);
  assert.equal(model.summary.securedMm, null);
  assert.equal(model.summary.crowdingSecuredText, null);

  // Tooth 12 rotated
  assert.equal(model.teeth[12].moveType, '회전');
  assert.equal(model.teeth[12].rotDeg, -14.24);
});

test('buildStagingModel: row height fits within 400px sidebar up to 18 stages', () => {
  const plan18 = makeFakePlan000001();
  const model18 = buildStagingModel(plan18);

  // 18 stages * 25px = 450px, fits within ~523px container
  assert.equal(model18.rowHeight, 25);
  const totalChartHeight = model18.topOffset + 18 * model18.rowHeight;
  assert.ok(totalChartHeight <= 523);

  // Adaptive height test for > 18 stages
  const bigPlan = {
    strategy: 'expansion',
    stages: Array.from({ length: 25 }, () => ({ '8': [0, 0, 0] }))
  };
  const modelBig = buildStagingModel(bigPlan);
  assert.ok(modelBig.rowHeight < 25);
  assert.ok(modelBig.topOffset + 25 * modelBig.rowHeight <= 523);
});

test('classifyToothMove: correctly classifies all 5 movement categories', () => {
  assert.deepEqual(classifyToothMove(17, 1.0, 0, 0, 0), { moveType: '복합', moveTypeKey: 'complex' });
  assert.deepEqual(classifyToothMove(11, 0, 0, 0, -12), { moveType: '회전', moveTypeKey: 'rotation' });
  assert.deepEqual(classifyToothMove(13, 0, 0, 1.5, 0), { moveType: '정출함입', moveTypeKey: 'extrusion' });
  assert.deepEqual(classifyToothMove(14, 2.0, 0, 0, 0), { moveType: '협설', moveTypeKey: 'buccolingual' });
  assert.deepEqual(classifyToothMove(21, 0, 1.2, 0, 0), { moveType: '협설', moveTypeKey: 'buccolingual' });
  assert.deepEqual(classifyToothMove(15, 0, 0.04, 0, 0), { moveType: '평행', moveTypeKey: 'parallel' });
  assert.deepEqual(classifyToothMove(11, 0, 0, 0, 0), { moveType: null, moveTypeKey: null });
});
