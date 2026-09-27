import test from 'node:test';
import assert from 'node:assert/strict';

import { patientContext, sampleContext, loadCaseContext } from '../../src/cualign/server/static/v2/js/state/case-context.js';
import { patientCaseLabel } from '../../src/cualign/server/static/v2/js/domain/status.js';
import { nextSidebarOpen } from '../../src/cualign/server/static/v2/js/screens/workspace/drawers.js';
import { matchRoutePattern } from '../../src/cualign/server/static/v2/js/shell/router.js';

const patient = {
  patient_id: 'P7',
  alias: 'alias-a',
  memo: 'memo-a',
  scans: [
    { scan_id: 'S1', case_id: 'P7-S1', revision: 2, confirmed_revision: 2 },
    { scan_id: 'S2', case_id: 'P7-S2', revision: 1, confirmed_revision: null }
  ]
};

test('Case context: a reloaded patient case restores label and confirmed scan', () => {
  const confirmed = patientContext(patient, 'P7-S1');
  assert.equal(confirmed.caseDisplayId, 'alias-a · S1');
  assert.equal(confirmed.caseTitle, 'memo-a');
  assert.equal(confirmed.currentScan.confirmed, true);

  const pending = patientContext(patient, 'P7-S2');
  assert.equal(pending.currentScan.confirmed, false);
  assert.equal(patientContext(patient, 'P7-S9'), null);
});

test('Case context: a reloaded sample case restores number, title and bare prescription', () => {
  const res = { cases: [{ case_id: 'demo-000042', title: 't', prescription: 'rx (FDI 1-2)', note: 'n' }] };
  const ctx = sampleContext(res, 'demo-000042');
  assert.equal(ctx.caseDisplayId, '000042');
  assert.equal(ctx.caseTitle, 't');
  assert.deepEqual(ctx.currentCase, { case_id: 'demo-000042', title: 't', prescription: 'rx', note: 'n' });
  assert.equal(sampleContext(res, 'other'), null);
});

test('Case context: loader asks the patient API only for patient cases', async () => {
  const calls = [];
  const api = {
    getPatient: async (pid) => { calls.push(['getPatient', pid]); return patient; },
    listCases: async () => { calls.push(['listCases']); return { cases: [] }; }
  };
  await loadCaseContext(api, 'P7-S1');
  await loadCaseContext(api, 'demo-000042');
  assert.deepEqual(calls, [['getPatient', 'P7'], ['listCases']]);
});

test('Case label: patient cases read alias and scan, falling back to the case id', () => {
  assert.equal(patientCaseLabel({ alias: 'a' }, { scan_id: 'S3', case_id: 'P1-S3' }), 'a · S3');
  assert.equal(patientCaseLabel({}, { scan_id: 'S3', case_id: 'P1-S3' }), 'P1-S3');
});

test('Drawers: the shown tab closes an open sidebar drawer, other clicks open it', () => {
  assert.equal(nextSidebarOpen({ open: false, clickedActive: true }), true);
  assert.equal(nextSidebarOpen({ open: true, clickedActive: true }), false);
  assert.equal(nextSidebarOpen({ open: true, clickedActive: false }), true);
});

test('Router: case routes decode ids and unknown hashes fall back to the cases list', () => {
  const routes = [
    { pattern: '#/cases' },
    { pattern: '#/cases/:caseId' },
    { pattern: '#/patients/:pid' }
  ];
  assert.deepEqual(matchRoutePattern(routes, '#/cases/a%20b').params, { caseId: 'a b' });
  assert.equal(matchRoutePattern(routes, '#/patients/new').params.pid, 'new');
  assert.equal(matchRoutePattern(routes, '#/nowhere').route.pattern, '#/cases');
  assert.equal(matchRoutePattern(routes, '').route.pattern, '#/cases');
});
