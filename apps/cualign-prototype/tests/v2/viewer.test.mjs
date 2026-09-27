import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateToothPosition,
  getViolationsAtStage,
  getStageViolationsSummary,
  calculateTickPosition,
  calculateMaxMovement,
  calculateMovementHeat,
  calculateIprContacts,
  calculateViewCamera,
  projectNormalizedToScreen
} from '../../src/cualign/server/static/v2/js/viewer/math.js';
import { VIEWER_T } from '../../src/cualign/server/static/v2/js/domain/vocab/viewer.js';

test('Pose synthesis: zero translation and zero rotation keeps pivot in place', () => {
  const result = calculateToothPosition([0, 0, 0], [10, 20, 30], 0);
  assert.deepEqual(result.position, [0, 0, 0]);
  assert.deepEqual(result.rotation, [0, 0, 0]);
  assert.equal(result.rotationDeg, 0);
});

test('Pose synthesis: pure translation without rotation', () => {
  const result = calculateToothPosition([1.5, -2.0, 0.5], [10, 20, 30], 0);
  assert.deepEqual(result.position, [1.5, -2.0, 0.5]);
  assert.deepEqual(result.rotation, [0, 0, 0]);
});

test('Pose synthesis: rotation around pivot calculates position = d + c - R*c', () => {
  // Pivot at (10, 0, 0). Rotation 90 degrees around z-axis:
  // cos(90) = 0, sin(90) = 1
  // R * c = [0*10 - 1*0, 1*10 + 0*0] = [0, 10]
  // position = d + c - R*c = [0, 0, 0] + [10, 0, 0] - [0, 10, 0] = [10, -10, 0]
  const result = calculateToothPosition([0, 0, 0], [10, 0, 0], 90);
  assert.ok(Math.abs(result.position[0] - 10) < 1e-6);
  assert.ok(Math.abs(result.position[1] - (-10)) < 1e-6);
  assert.ok(Math.abs(result.position[2] - 0) < 1e-6);
  assert.ok(Math.abs(result.rotation[2] - Math.PI / 2) < 1e-6);

  // Rotation 180 degrees around z-axis:
  // R * c = [-10, 0]
  // position = [10, 0, 0] - [-10, 0, 0] = [20, 0, 0]
  const result180 = calculateToothPosition([0, 0, 0], [10, 0, 0], 180);
  assert.ok(Math.abs(result180.position[0] - 20) < 1e-6);
  assert.ok(Math.abs(result180.position[1] - 0) < 1e-6);

  // Translation + Rotation:
  const resultCombined = calculateToothPosition([2, 3, 4], [10, 0, 0], 90);
  assert.ok(Math.abs(resultCombined.position[0] - (2 + 10)) < 1e-6);
  assert.ok(Math.abs(resultCombined.position[1] - (3 - 10)) < 1e-6);
  assert.ok(Math.abs(resultCombined.position[2] - 4) < 1e-6);
});

test('Pose synthesis: pivot center invariant (pivot point always maps to pivot + d)', () => {
  // Any point at pivot c rotated by R and translated by position must end at c + d:
  // p' = position + R * c = (d + c - R*c) + R*c = d + c
  const d = [3.2, -1.8, 0.4];
  const c = [12.5, -8.3, 14.0];
  const angle = 37.5;

  const result = calculateToothPosition(d, c, angle);
  const a = (angle * Math.PI) / 180;
  const rcX = Math.cos(a) * c[0] - Math.sin(a) * c[1];
  const rcY = Math.sin(a) * c[0] + Math.cos(a) * c[1];

  const transformedPivotX = result.position[0] + rcX;
  const transformedPivotY = result.position[1] + rcY;
  const transformedPivotZ = result.position[2] + c[2];

  assert.ok(Math.abs(transformedPivotX - (c[0] + d[0])) < 1e-5);
  assert.ok(Math.abs(transformedPivotY - (c[1] + d[1])) < 1e-5);
  assert.ok(Math.abs(transformedPivotZ - (c[2] + d[2])) < 1e-5);
});

test('Pose synthesis: 360 degree rotation returns to initial position', () => {
  const result360 = calculateToothPosition([5, -2, 1], [15, 25, 0], 360);
  assert.ok(Math.abs(result360.position[0] - 5) < 1e-6);
  assert.ok(Math.abs(result360.position[1] - (-2)) < 1e-6);
  assert.ok(Math.abs(result360.position[2] - 1) < 1e-6);
});

test('Violations at stage: filters stage and groups by tooth', () => {
  const violations = [
    { stage: 1, type: 'collision', teeth: [8, 9], overlap_mm3: 0.25 },
    { stage: 1, type: 'move_limit', teeth: [8] },
    { stage: 2, type: 'collision', teeth: [9, 10], overlap_mm3: 0.15 },
    { stage: 3, type: 'collision', teeth: [11] }
  ];

  const stage1 = getViolationsAtStage(violations, 1);
  assert.equal(stage1.list.length, 2);
  assert.equal(stage1.collisionCount, 1);
  assert.equal(stage1.moveLimitCount, 1);
  assert.ok(stage1.byTooth['8'].has('collision'));
  assert.ok(stage1.byTooth['8'].has('move_limit'));
  assert.ok(stage1.byTooth['9'].has('collision'));
  assert.equal(stage1.byTooth['10'], undefined);

  const stage2 = getViolationsAtStage(violations, 2);
  assert.equal(stage2.list.length, 1);
  assert.equal(stage2.collisionCount, 1);
  assert.equal(stage2.moveLimitCount, 0);
  assert.ok(stage2.byTooth['10'].has('collision'));

  const stage0 = getViolationsAtStage(violations, 0);
  assert.equal(stage0.list.length, 0);
  assert.equal(stage0.collisionCount, 0);
});

test('Stage violations summary: aggregates for scrubber ticks', () => {
  const violations = [
    { stage: 1, type: 'collision', teeth: [8, 9] },
    { stage: 1, type: 'move_limit', teeth: [7] },
    { stage: 3, type: 'collision', teeth: [9, 10] },
    { stage: 3, type: 'rotation_limit', teeth: [10] },
    { stage: null, type: 'collision' } // ignored
  ];

  const summary = getStageViolationsSummary(violations);
  assert.deepEqual(summary[1], { collision: 1, move_limit: 1, other: 0, total: 2 });
  assert.deepEqual(summary[3], { collision: 1, move_limit: 0, other: 1, total: 2 });
  assert.equal(summary[2], undefined);
});

test('Slider tick position: percentage calculation and boundaries', () => {
  assert.equal(calculateTickPosition(0, 10), 0);
  assert.equal(calculateTickPosition(5, 10), 50);
  assert.equal(calculateTickPosition(10, 10), 100);
  assert.equal(calculateTickPosition(12, 10), 100); // clamped
  assert.equal(calculateTickPosition(-2, 10), 0); // clamped
  assert.equal(calculateTickPosition(0, 0), 0); // zero stages
  assert.equal(calculateTickPosition(1, 4), 25);
  assert.equal(calculateTickPosition(3, 4), 75);
});

test('Max movement and movement heat calculation', () => {
  const stages = [
    { '8': [0.1, 0, 0], '9': [0.2, 0, 0] },
    { '8': [0.3, 0.4, 0], '9': [0.1, 0.2, 0] } // tooth 8 hypot = 0.5
  ];
  const maxMove = calculateMaxMovement(stages);
  assert.ok(Math.abs(maxMove - 0.5) < 1e-6);

  // calculateMovementHeat: 0.5 displacement out of 0.5 max gives 0.75
  const fullHeat = calculateMovementHeat(0.5, maxMove);
  assert.ok(Math.abs(fullHeat - 0.75) < 1e-6);

  // half displacement gives 0.375
  const halfHeat = calculateMovementHeat(0.25, maxMove);
  assert.ok(Math.abs(halfHeat - 0.375) < 1e-6);

  // zero displacement gives 0
  assert.equal(calculateMovementHeat(0, maxMove), 0);

  // Over max displacement is capped at 0.75
  assert.equal(calculateMovementHeat(1.0, maxMove), 0.75);
});

test('IPR contacts: calculates mm between adjacent teeth with exclusions', () => {
  const archOrder = ['1', '2', '3', '4'];
  const target = {
    ipr_mm_per_surface: 0.4,
    ipr_exclude: ['1'],
    removed: ['4']
  };

  const contacts = calculateIprContacts(archOrder, target);
  // Contacts between:
  // 1 and 2: 1 is excluded (0), 2 is included (1) => 0.4 * 0.5 * 1 = 0.2
  // 2 and 3: both included (1+1=2) => 0.4 * 0.5 * 2 = 0.4
  // 3 and 4: 4 is removed => no contact
  assert.equal(contacts.length, 2);
  assert.deepEqual(contacts[0], { a: '1', b: '2', mm: 0.2 });
  assert.deepEqual(contacts[1], { a: '2', b: '3', mm: 0.4 });
});

test('View camera calculation: returns correct positions and up vectors', () => {
  const center = [10, 20, 30];
  const size = [40, 50, 20];

  const occlusal = calculateViewCamera({ kind: 'occlusal', center, size, fov: 35 });
  assert.deepEqual(occlusal.up, [0, 1, 0]);
  assert.equal(occlusal.position[0], 10);
  assert.equal(occlusal.position[1], 20);
  assert.ok(occlusal.position[2] > 30); // looks down from +z
  assert.deepEqual(occlusal.target, center);

  const frontal = calculateViewCamera({ kind: 'frontal', center, size, fov: 35 });
  assert.deepEqual(frontal.up, [0, 0, -1]);
  assert.equal(frontal.position[0], 10);
  assert.ok(frontal.position[1] > 20); // looks from anterior (+y)

  const left = calculateViewCamera({ kind: 'left', center, size, fov: 35 });
  assert.deepEqual(left.up, [0, 0, -1]);
  assert.ok(left.position[0] > 10); // looks from patient's left (+x)

  const right = calculateViewCamera({ kind: 'right', center, size, fov: 35 });
  assert.deepEqual(right.up, [0, 0, -1]);
  assert.ok(right.position[0] < 10); // looks from patient's right (-x)

  const back = calculateViewCamera({ kind: 'back', center, size, fov: 35 });
  assert.deepEqual(back.up, [0, 0, -1]);
  assert.equal(back.position[0], 10);
  assert.ok(back.position[1] < 20); // looks from palate side (-y)

  const base = calculateViewCamera({ kind: 'base', center, size, fov: 35 });
  assert.deepEqual(base.up, [0, 1, 0]);
  assert.equal(base.position[0], 10);
  assert.equal(base.position[1], 20);
  assert.ok(base.position[2] < 30); // looks from base (-z)
});

test('Screen projection: converts normalized device coordinates to screen pixels', () => {
  // Center (0, 0)
  const center = projectNormalizedToScreen(0, 0, 800, 600);
  assert.equal(center.x, 400);
  assert.equal(center.y, 300);

  // Top-left (-1, 1 in NDC is 0, 0 in screen)
  const topLeft = projectNormalizedToScreen(-1, 1, 800, 600);
  assert.equal(topLeft.x, 0);
  assert.equal(topLeft.y, 0);

  // Bottom-right (1, -1 in NDC is 800, 600 in screen)
  const bottomRight = projectNormalizedToScreen(1, -1, 800, 600);
  assert.equal(bottomRight.x, 800);
  assert.equal(bottomRight.y, 600);

  // Default fallback when dimensions are 0
  const zeroDim = projectNormalizedToScreen(0, 0, 0, 0);
  assert.equal(zeroDim.x, 0);
  assert.equal(zeroDim.y, 0);
});

test('Pose synthesis: negative rotation angle', () => {
  // Rotation -90 degrees around z-axis:
  // cos(-90) = 0, sin(-90) = -1
  // Pivot at (10, 0, 0)
  // R * c = [0*10 - (-1)*0, (-1)*10 + 0*0] = [0, -10]
  // position = d + c - R*c = [0, 0, 0] + [10, 0, 0] - [0, -10, 0] = [10, 10, 0]
  const result = calculateToothPosition([0, 0, 0], [10, 0, 0], -90);
  assert.ok(Math.abs(result.position[0] - 10) < 1e-6);
  assert.ok(Math.abs(result.position[1] - 10) < 1e-6);
  assert.ok(Math.abs(result.position[2] - 0) < 1e-6);
  assert.ok(Math.abs(result.rotation[2] - (-Math.PI / 2)) < 1e-6);
});

test('IPR contacts: edge cases with no IPR or empty arch', () => {
  assert.deepEqual(calculateIprContacts([], { ipr_mm_per_surface: 0.5 }), []);
  assert.deepEqual(calculateIprContacts(['1'], { ipr_mm_per_surface: 0.5 }), []);
  assert.deepEqual(calculateIprContacts(['1', '2'], { ipr_mm_per_surface: 0 }), []);
  assert.deepEqual(calculateIprContacts(['1', '2'], null), []);
});

test('Viewer Vocabulary: verifies all core sections and label generators', () => {
  assert.equal(VIEWER_T.views.occlusal, '교합면');
  assert.equal(VIEWER_T.views.frontal, '정면');
  assert.equal(VIEWER_T.views.right, '우측');
  assert.equal(VIEWER_T.views.left, '좌측');
  assert.equal(VIEWER_T.arch.scanInfo('상악', 14), '상악 · 치아 14개 · 치료 전');
  assert.equal(VIEWER_T.arch.archInfo('상악', 14, 3, 9), '상악 · 치아 14개 · 계획 3 · 단계 9');

  assert.equal(VIEWER_T.layers.ghost, '치료 전 겹쳐 보기');
  assert.equal(VIEWER_T.layers.heat, '이동량 색');
  assert.equal(VIEWER_T.layers.ipr, 'IPR');
  assert.equal(VIEWER_T.layers.numbers, '치아 번호');
  assert.equal(VIEWER_T.layers.gum, '잇몸');

  assert.equal(VIEWER_T.stageBar.noPlan, '계획 없음');
  assert.equal(VIEWER_T.stageBar.beforeTreatment(10), '치료 전 · 총 10단계');
  assert.equal(VIEWER_T.stageBar.beforeTreatmentWithMonths(10, 5), '치료 전 · 총 10단계 · 예상 5개월');
  assert.equal(VIEWER_T.stageBar.stageLabel(2, 10), '단계 2 / 10');
  assert.equal(VIEWER_T.stageBar.stageLabelWithMonths(2, 10, 5), '단계 2 / 10 · 예상 5개월');

  assert.equal(VIEWER_T.overlay.selectedTeeth, '선택한 치아:');
  assert.equal(VIEWER_T.overlay.clearSelection, '모두 해제');
  assert.equal(VIEWER_T.overlay.toothPrefix('11'), '치아 #11');
  assert.equal(VIEWER_T.overlay.cumulativeMove(1.234), '누적 이동: 1.23 mm');
});
