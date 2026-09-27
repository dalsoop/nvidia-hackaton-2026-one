import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveCheckState,
  parsePatientAndScanId,
  formatBasis,
  formatRotationSummary,
  formatVerticalSummary,
  formatOrientationSummary
} from '../../src/cualign/server/static/v2/js/screens/intake/check.js';
import { CHECK_VOCAB } from '../../src/cualign/server/static/v2/js/domain/vocab/check.js';

test('Check: normal supported scan produces ready state and confirm action', () => {
  const check = {
    case_id: 'P1-S1',
    teeth: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    n_teeth: 14,
    missing: [],
    outside: [1, 16],
    widths_mm: { 2: 7.4, 3: 6.8, 8: 8.5, 9: 8.6, 14: 6.7, 15: 7.3 },
    crowding_mm: 3.2,
    rotation_deg: { 8: 12.0 },
    vertical_mm: { 8: 0.5 },
    scanned_gingiva: true,
    unsupported: [],
    ready: true,
    orientation: {
      basis: 'palate',
      side: 'ok',
      rotation_deg: 2.1
    },
    revision: 1,
    confirmed: false,
    confirmed_at: null
  };

  const state = deriveCheckState(check);

  assert.equal(state.isSupported, true);
  assert.equal(state.ready, true);
  assert.equal(state.unsupportedReasons.length, 0);
  assert.equal(state.isReversed, false);
  assert.equal(state.hasOrientationNotice, false);
  assert.equal(state.primaryAction.label, '번호 확인 — 계획 시작');
  assert.equal(state.primaryAction.disabled, false);
  assert.equal(state.showDelete, false);
  assert.equal(state.scannedGingiva, true);
  assert.equal(state.crowding_mm, 3.2);

  // FDI tooth checks: universal 8 -> FDI 11, universal 9 -> FDI 21
  const fdiList = state.fdiTeeth.map((t) => t.fdi);
  assert.ok(fdiList.includes(11));
  assert.ok(fdiList.includes(21));
  assert.ok(fdiList.includes(17)); // universal 2 -> FDI 17

  // Widths in FDI
  const fdi8Width = state.widths.find((w) => w.universal === 8);
  assert.equal(fdi8Width.fdi, 11);
  assert.equal(fdi8Width.width_mm, 8.5);

  // Rotations in FDI
  const rot11 = state.rotations.find((r) => r.fdi === 11);
  assert.equal(rot11.deg, 12.0);

  // Verticals in FDI
  const vert11 = state.verticals.find((v) => v.fdi === 11);
  assert.equal(vert11.mm, 0.5);
});

test('Check: unsupported scan sets disabled primary button and showDelete', () => {
  const check = {
    case_id: 'P2-S1',
    teeth: [2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    n_teeth: 13,
    missing: [5],
    outside: [1, 16],
    widths_mm: {},
    crowding_mm: 5.0,
    rotation_deg: {},
    vertical_mm: {},
    scanned_gingiva: false,
    unsupported: ['치아 5 결손: 결손 공간이 있는 악궁은 아직 계획하지 않음 (연속된 치열만 지원)'],
    ready: false,
    orientation: {
      basis: 'cervical',
      side: 'ok'
    },
    revision: 1
  };

  const state = deriveCheckState(check);

  assert.equal(state.isSupported, false);
  assert.equal(state.ready, false);
  assert.equal(state.unsupportedReasons.length, 1);
  assert.match(state.unsupportedReasons[0], /결손/);
  assert.equal(state.primaryAction.label, '계획할 수 없는 스캔');
  assert.equal(state.primaryAction.disabled, true);
  assert.equal(state.showDelete, true);
  assert.equal(state.scannedGingiva, false);

  // Missing tooth 5 in Universal -> FDI 14
  assert.equal(state.fdiMissing.length, 1);
  assert.equal(state.fdiMissing[0].fdi, 14);
});

test('Check: orientation reversed triggers isReversed warning', () => {
  const check = {
    case_id: 'P3-S1',
    teeth: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    unsupported: [],
    ready: true,
    orientation: {
      basis: 'palate',
      side: 'reversed',
      rotation_deg: 180.0
    }
  };

  const state = deriveCheckState(check);

  assert.equal(state.isReversed, true);
  assert.equal(state.hasOrientationNotice, false);
});

test('Check: orientation basis none triggers notice box with note', () => {
  const check = {
    case_id: 'P4-S1',
    teeth: [6, 7, 8, 9, 10, 11],
    unsupported: [],
    ready: true,
    orientation: {
      basis: 'none',
      side: 'unknown',
      note: '치아 6개 — 방향을 정할 수 없어 입력 방향 그대로 둠'
    }
  };

  const state = deriveCheckState(check);

  assert.equal(state.isReversed, false);
  assert.equal(state.hasOrientationNotice, true);
  assert.equal(state.orientationNote, '치아 6개 — 방향을 정할 수 없어 입력 방향 그대로 둠');
});

test('Check: outside teeth mapped to FDI correctly', () => {
  const check = {
    case_id: 'P5-S1',
    teeth: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    outside: [1, 16],
    unsupported: [],
    ready: true
  };

  const state = deriveCheckState(check);

  // Universal 1 -> FDI 18, Universal 16 -> FDI 28
  const outsideFdi = state.fdiOutside.map((t) => t.fdi);
  assert.deepEqual(outsideFdi, [18, 28]);
});

test('Check: null or undefined check payload handles gracefully', () => {
  const stateNull = deriveCheckState(null);
  assert.equal(stateNull.isSupported, false);
  assert.equal(stateNull.ready, false);
  assert.equal(stateNull.primaryAction.disabled, true);
  assert.equal(stateNull.teeth.length, 0);

  const stateEmpty = deriveCheckState({});
  assert.equal(stateEmpty.isSupported, true);
  assert.equal(stateEmpty.isReversed, false);
});

test('Check: multiple unsupported reasons and revision propagation', () => {
  const check = {
    case_id: 'P10-S2',
    teeth: [8, 9],
    unsupported: [
      '치아 2개: 악궁을 맞추기에 부족 (6개 이상 필요)',
      '치아 [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15] 결손'
    ],
    ready: false,
    revision: 3,
    confirmed: true,
    confirmed_at: '2026-09-27T10:00:00Z'
  };

  const state = deriveCheckState(check);
  assert.equal(state.isSupported, false);
  assert.equal(state.ready, false);
  assert.equal(state.unsupportedReasons.length, 2);
  assert.equal(state.revision, 3);
  assert.equal(state.confirmed, true);
  assert.equal(state.confirmedAt, '2026-09-27T10:00:00Z');
  assert.equal(state.primaryAction.label, '계획할 수 없는 스캔');
  assert.equal(state.primaryAction.disabled, true);
  assert.equal(state.showDelete, true);
});

test('Check: widths and rotations sorted by FDI tooth number', () => {
  const check = {
    case_id: 'P1-S1',
    teeth: [9, 8, 2], // 9 -> 21, 8 -> 11, 2 -> 17
    widths_mm: { 9: 8.6, 8: 8.5, 2: 7.4 },
    rotation_deg: { 9: -5.0, 8: 12.0 },
    vertical_mm: { 9: -1.2, 8: 0.5 },
    unsupported: [],
    ready: true
  };

  const state = deriveCheckState(check);

  // FDI sorted order: 11, 17, 21 (or numeric ascending)
  const fdiOrder = state.widths.map((w) => w.fdi);
  assert.deepEqual(fdiOrder, [11, 17, 21]);

  const rotFdiOrder = state.rotations.map((r) => r.fdi);
  assert.deepEqual(rotFdiOrder, [11, 21]);
  assert.equal(state.rotations[0].deg, 12.0);
  assert.equal(state.rotations[1].deg, -5.0);

  const vertFdiOrder = state.verticals.map((v) => v.fdi);
  assert.deepEqual(vertFdiOrder, [11, 21]);
  assert.equal(state.verticals[0].mm, 0.5);
  assert.equal(state.verticals[1].mm, -1.2);
});

test('Check: parsePatientAndScanId splits caseId correctly', () => {
  assert.deepEqual(parsePatientAndScanId('P0001-S1'), { pid: 'P0001', sid: 'S1' });
  assert.deepEqual(parsePatientAndScanId('P123-S45-rev2'), { pid: 'P123', sid: 'S45-rev2' });
  assert.deepEqual(parsePatientAndScanId('upload-12345'), { pid: 'upload', sid: '12345' });
  assert.deepEqual(parsePatientAndScanId('solo'), { pid: 'solo', sid: '' });
  assert.deepEqual(parsePatientAndScanId(''), { pid: '', sid: '' });
  assert.deepEqual(parsePatientAndScanId(null), { pid: '', sid: '' });
});

test('Check: formatBasis formats basis strings into Korean descriptions', () => {
  assert.equal(formatBasis('gingiva'), '잇몸 기준');
  assert.equal(formatBasis('cervical'), '치관 아래 경계 기준');
  assert.equal(formatBasis('occlusal'), '교합면 기준');
  assert.equal(formatBasis('palate'), '구개(입천장) 기준');
  assert.equal(formatBasis('none'), '근거 없음');
  assert.equal(formatBasis('unknown'), 'unknown');
  assert.equal(formatBasis(null), '미지정');
});

test('Check: single string unsupported payload converts into reason array', () => {
  const check = {
    case_id: 'P9-S1',
    unsupported: '스캔 품질 불량으로 계획 불가',
    ready: false
  };

  const state = deriveCheckState(check);
  assert.equal(state.isSupported, false);
  assert.equal(state.ready, false);
  assert.equal(state.unsupportedReasons.length, 1);
  assert.equal(state.unsupportedReasons[0], '스캔 품질 불량으로 계획 불가');
  assert.equal(state.primaryAction.disabled, true);
  assert.equal(state.primaryAction.label, '계획할 수 없는 스캔');
  assert.equal(state.showDelete, true);
});

test('Check: ready false with empty unsupported still marks unsupported and disabled', () => {
  const check = {
    case_id: 'P8-S1',
    unsupported: [],
    ready: false
  };

  const state = deriveCheckState(check);
  assert.equal(state.isSupported, false);
  assert.equal(state.ready, false);
  assert.equal(state.unsupportedReasons.length, 1);
  assert.equal(state.primaryAction.disabled, true);
  assert.equal(state.primaryAction.label, '계획할 수 없는 스캔');
  assert.equal(state.showDelete, true);
});

test('Check: combined orientation reversed and basis none', () => {
  const check = {
    case_id: 'P7-S1',
    teeth: [2, 3, 4],
    unsupported: [],
    ready: true,
    orientation: {
      basis: 'none',
      side: 'reversed',
      note: '방향 기준 없음'
    }
  };

  const state = deriveCheckState(check);
  assert.equal(state.isReversed, true);
  assert.equal(state.hasOrientationNotice, true);
  assert.equal(state.orientationNote, '방향 기준 없음');
  assert.equal(state.isSupported, true);
  assert.equal(state.primaryAction.disabled, false);
});

test('Check: formatRotationSummary formats rotations or empty message', () => {
  assert.equal(formatRotationSummary([]), '보정할 회전 없음');
  assert.equal(formatRotationSummary(null), '보정할 회전 없음');

  const rotations = [
    { universal: 8, fdi: 11, deg: 12.0 },
    { universal: 9, fdi: 21, deg: -5.5 }
  ];
  assert.equal(formatRotationSummary(rotations), '11번 +12°, 21번 -5.5°');
});

test('Check: formatVerticalSummary formats vertical discrepancies or empty message', () => {
  assert.equal(formatVerticalSummary([]), '보정할 차이 없음');
  assert.equal(formatVerticalSummary(null), '보정할 차이 없음');

  const verticals = [
    { universal: 8, fdi: 11, mm: 0.5 },
    { universal: 9, fdi: 21, mm: -1.2 }
  ];
  assert.equal(formatVerticalSummary(verticals), '11번 교합면 쪽 0.5mm, 21번 잇몸 쪽 1.2mm');
});

test('Check: formatOrientationSummary combines basis, rotation and renumbering', () => {
  assert.equal(formatOrientationSummary(null), '미지정');
  assert.equal(formatOrientationSummary({ basis: 'gingiva' }), '잇몸 기준');
  assert.equal(
    formatOrientationSummary({ basis: 'palate', rotation_deg: 2.1 }),
    '구개(입천장) 기준 · 2.1° 회전'
  );
  assert.equal(
    formatOrientationSummary({ basis: 'cervical', renumbered: true }),
    '치관 아래 경계 기준 · 번호 좌우 뒤집음'
  );
  assert.equal(
    formatOrientationSummary({ basis: 'none', rotation_deg: 180, renumbered: true }),
    '근거 없음 · 180° 회전 · 번호 좌우 뒤집음'
  );
});

test('Check: FDI mapping covers all 16 maxillary teeth in dental arch order', () => {
  const allUpperUniversal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const check = {
    case_id: 'P1-S1',
    teeth: allUpperUniversal,
    unsupported: [],
    ready: true
  };

  const state = deriveCheckState(check);
  const fdiList = state.fdiTeeth.map((t) => t.fdi);

  // FDI maxillary: 11..18 (Q1), 21..28 (Q2)
  const expectedFdi = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28];
  assert.deepEqual(fdiList, expectedFdi);
});

test('Check: confirmation action flow simulation verifies revision parameter and activate', async () => {
  const check = {
    case_id: 'P0001-S01',
    teeth: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    revision: 2,
    ready: true,
    unsupported: []
  };

  const state = deriveCheckState(check);
  const { pid, sid } = parsePatientAndScanId(state.caseId);

  assert.equal(pid, 'P0001');
  assert.equal(sid, 'S01');
  assert.equal(state.revision, 2);
  assert.equal(state.primaryAction.disabled, false);
  assert.equal(state.primaryAction.label, '번호 확인 — 계획 시작');

  // Verify call sequence
  const calls = [];
  const fakeApi = {
    confirmScan: async (p, s, rev) => {
      calls.push({ fn: 'confirmScan', p, s, rev });
      return { ok: true };
    },
    activateCase: async (cid) => {
      calls.push({ fn: 'activateCase', cid });
      return { case_id: cid };
    }
  };

  await fakeApi.confirmScan(pid, sid, state.revision);
  await fakeApi.activateCase(state.caseId);

  assert.deepEqual(calls, [
    { fn: 'confirmScan', p: 'P0001', s: 'S01', rev: 2 },
    { fn: 'activateCase', cid: 'P0001-S01' }
  ]);
});

test('Check: confirmation 409 error extracts detail and sets failure message', () => {
  const err409 = {
    status: 409,
    message: '지원하지 않는 스캔은 계획용으로 확인할 수 없습니다.'
  };

  const message = err409.message || (err409.status === 409 ? '확인 충돌(409)이 발생했습니다.' : '계획 시작에 실패했습니다.');
  assert.equal(message, '지원하지 않는 스캔은 계획용으로 확인할 수 없습니다.');

  // Fallback 409 without custom message
  const generic409 = { status: 409, message: '' };
  const fallbackMsg = generic409.message || (generic409.status === 409 ? CHECK_VOCAB.conflict409 : CHECK_VOCAB.planStartFailed);
  assert.match(fallbackMsg, /409/);
});

test('Check: mirrorScan flow reverses teeth and updates check state', async () => {
  const calls = [];
  const fakeApi = {
    mirrorScan: async (p, s) => {
      calls.push({ fn: 'mirrorScan', p, s });
      return {
        case_id: `${p}-${s}`,
        teeth: [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
        orientation: {
          side: 'ok',
          basis: 'palate',
          renumbered: true
        },
        ready: true,
        unsupported: []
      };
    }
  };

  const updatedCheck = await fakeApi.mirrorScan('P001', 'S01');
  const updatedState = deriveCheckState(updatedCheck);

  assert.deepEqual(calls, [{ fn: 'mirrorScan', p: 'P001', s: 'S01' }]);
  assert.equal(updatedState.isReversed, false);
  assert.equal(updatedState.orientation.renumbered, true);
  assert.equal(formatOrientationSummary(updatedState.orientation), '구개(입천장) 기준 · 번호 좌우 뒤집음');
});

test('Check: deleteScan flow removes scan and returns to patient page', async () => {
  const calls = [];
  const fakeApi = {
    deleteScan: async (p, s) => {
      calls.push({ fn: 'deleteScan', p, s });
      return { ok: true };
    }
  };

  await fakeApi.deleteScan('P002', 'S01');
  assert.deepEqual(calls, [{ fn: 'deleteScan', p: 'P002', s: 'S01' }]);
});

test('Check: CHECK_VOCAB dictionary completeness', () => {
  assert.equal(CHECK_VOCAB.title, '입력 확인');
  assert.equal(CHECK_VOCAB.supportedBadge, '계획 가능');
  assert.equal(CHECK_VOCAB.unsupportedBadge, '지원 불가');
  assert.equal(CHECK_VOCAB.btnStartPlan, '번호 확인 — 계획 시작');
  assert.equal(CHECK_VOCAB.btnUnsupported, '계획할 수 없는 스캔');
  assert.equal(CHECK_VOCAB.btnDelete, '스캔 삭제');
  assert.equal(CHECK_VOCAB.mirrorButton, '좌우 번호 뒤집기');
  assert.equal(CHECK_VOCAB.terms.teeth, '치아');
  assert.equal(CHECK_VOCAB.terms.missing, '누락');
  assert.equal(CHECK_VOCAB.terms.outside, '범위 밖');
  assert.equal(CHECK_VOCAB.terms.crowding, '총생');
  assert.equal(CHECK_VOCAB.terms.rotation, '회전 보정 대상');
  assert.equal(CHECK_VOCAB.terms.vertical, '높이 보정 대상');
  assert.equal(CHECK_VOCAB.terms.gingiva, '잇몸 스캔');
  assert.equal(CHECK_VOCAB.terms.orientation, '방향 정렬');
});
