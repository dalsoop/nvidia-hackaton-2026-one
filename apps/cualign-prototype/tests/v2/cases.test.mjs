import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupPlansByCaseId,
  transformCasesData,
  filterCases,
  sortCases,
  countByStatus,
  countByKind,
  formatPlanSummary,
  formatViolations,
  FDI_COORDINATES
} from '../../src/cualign/server/static/v2/js/screens/cases/data.js';

import { universalToFdi } from '../../src/cualign/server/static/v2/js/domain/teeth.js';

test('Cases data: groupPlansByCaseId groups correctly without N+1', () => {
  const plans = [
    { plan_id: 'p1', case_id: 'c1', strategy: 'expansion', passed: true },
    { plan_id: 'p2', case_id: 'c1', strategy: 'ipr', passed: true },
    { plan_id: 'p3', case_id: 'c2', strategy: 'extraction', passed: false }
  ];

  const map = groupPlansByCaseId(plans);
  assert.equal(map.get('c1').length, 2);
  assert.equal(map.get('c2').length, 1);
  assert.equal(map.get('c3'), undefined);

  assert.equal(groupPlansByCaseId(null).size, 0);
  assert.equal(groupPlansByCaseId([]).size, 0);
});

test('Cases data: transformCasesData handles patient scans as individual cases', () => {
  const patientsData = {
    patients: [
      {
        patient_id: 'P0001',
        alias: '3월 상담 A',
        memo: '가명 환자 메모',
        scans: [
          {
            scan_id: 'S1',
            case_id: 'P0001-S1',
            revision: 1,
            confirmed_revision: null
          },
          {
            scan_id: 'S2',
            case_id: 'P0001-S2',
            revision: 1,
            confirmed_revision: 1
          }
        ]
      }
    ]
  };

  const casesData = { cases: [] };
  const plansData = { plans: [] };

  const result = transformCasesData({ casesData, patientsData, plansData });
  assert.equal(result.length, 2);

  // S1 is unconfirmed -> scan_check
  const s1 = result.find((c) => c.case_id === 'P0001-S1');
  assert.ok(s1);
  assert.equal(s1.kind, 'patient');
  assert.equal(s1.status, 'scan_check');
  assert.equal(s1.displayId, '3월 상담 A · S1');
  assert.equal(s1.scan.confirmed, false);

  // S2 is confirmed -> needs_plan
  const s2 = result.find((c) => c.case_id === 'P0001-S2');
  assert.ok(s2);
  assert.equal(s2.kind, 'patient');
  assert.equal(s2.status, 'needs_plan');
  assert.equal(s2.displayId, '3월 상담 A · S2');
  assert.equal(s2.scan.confirmed, true);
});

test('Cases data: transformCasesData computes sample status correctly', () => {
  const casesData = {
    cases: [
      { case_id: 'sample-1', title: '샘플 1', prescription: '비발치' },
      { case_id: 'sample-2', title: '샘플 2', prescription: '발치' },
      { case_id: 'sample-3', title: '샘플 3', prescription: '확장' }
    ]
  };

  const plansData = {
    plans: [
      // sample-1 has passing plan -> ready
      {
        plan_id: 'p-1',
        case_id: 'sample-1',
        strategy: 'expansion',
        passed: true,
        violations: 0,
        n_stages: 10
      },
      // sample-2 has failing plan -> violation
      {
        plan_id: 'p-2',
        case_id: 'sample-2',
        strategy: 'expansion',
        passed: false,
        violations: 3,
        n_stages: 15
      },
      // sample-3 has approved plan -> approved
      {
        plan_id: 'p-3',
        case_id: 'sample-3',
        strategy: 'extraction',
        passed: true,
        violations: 0,
        n_stages: 20,
        approval: { confirmed: true }
      }
    ]
  };

  const result = transformCasesData({ casesData, patientsData: { patients: [] }, plansData });
  assert.equal(result.length, 3);

  const c1 = result.find((c) => c.case_id === 'sample-1');
  assert.equal(c1.status, 'ready');
  assert.equal(c1.preferredPlan.plan_id, 'p-1');

  const c2 = result.find((c) => c.case_id === 'sample-2');
  assert.equal(c2.status, 'violation');

  const c3 = result.find((c) => c.case_id === 'sample-3');
  assert.equal(c3.status, 'approved');
});

test('Cases data: filterCases filters by status and kind', () => {
  const items = [
    { case_id: '1', kind: 'sample', status: 'ready' },
    { case_id: '2', kind: 'sample', status: 'violation' },
    { case_id: '3', kind: 'patient', status: 'scan_check' },
    { case_id: '4', kind: 'patient', status: 'needs_plan' },
    { case_id: '5', kind: 'patient', status: 'ready' }
  ];

  assert.equal(filterCases(items, { statusFilter: 'all', kindFilter: 'all' }).length, 5);
  assert.equal(filterCases(items, { statusFilter: 'ready', kindFilter: 'all' }).length, 2);
  assert.equal(filterCases(items, { statusFilter: 'all', kindFilter: 'sample' }).length, 2);
  assert.equal(filterCases(items, { statusFilter: 'all', kindFilter: 'patient' }).length, 3);
  assert.equal(filterCases(items, { statusFilter: 'ready', kindFilter: 'patient' }).length, 1);
  assert.equal(filterCases(items, { statusFilter: 'approved', kindFilter: 'all' }).length, 0);
});

test('Cases data: countByStatus and countByKind aggregation', () => {
  const items = [
    { case_id: '1', kind: 'sample', status: 'ready' },
    { case_id: '2', kind: 'sample', status: 'violation' },
    { case_id: '3', kind: 'patient', status: 'scan_check' },
    { case_id: '4', kind: 'patient', status: 'needs_plan' },
    { case_id: '5', kind: 'patient', status: 'ready' }
  ];

  const statusCounts = countByStatus(items);
  assert.equal(statusCounts.all, 5);
  assert.equal(statusCounts.ready, 2);
  assert.equal(statusCounts.violation, 1);
  assert.equal(statusCounts.scan_check, 1);
  assert.equal(statusCounts.needs_plan, 1);
  assert.equal(statusCounts.approved, 0);

  const kindCounts = countByKind(items);
  assert.equal(kindCounts.all, 5);
  assert.equal(kindCounts.sample, 2);
  assert.equal(kindCounts.patient, 3);
});

test('Cases data: formatPlanSummary produces expected text', () => {
  assert.equal(formatPlanSummary(null), '—');

  const passingPlan = {
    strategy: 'expansion',
    n_stages: 18,
    passed: true,
    violations: 0
  };
  assert.equal(formatPlanSummary(passingPlan), '확장 · 18장 · 통과');

  const failingPlan = {
    strategy: 'expansion',
    n_stages: 18,
    passed: false,
    violations: 7
  };
  assert.equal(formatPlanSummary(failingPlan), '확장 · 18장 · 위반');

  const extractionPlan = {
    strategy: 'extraction',
    n_stages: 20,
    passed: true,
    violations: 0
  };
  assert.equal(formatPlanSummary(extractionPlan), '발치 · 20장 · 통과');
});

test('Cases data: formatViolations formats violations count correctly', () => {
  assert.equal(formatViolations({ status: 'scan_check' }, null), '—');
  assert.equal(formatViolations({ status: 'ready' }, null), '—');

  const zeroViolations = { violations: 0 };
  assert.equal(formatViolations({ status: 'ready' }, zeroViolations), '0');

  const sevenViolations = { violations: 7 };
  assert.equal(formatViolations({ status: 'violation' }, sevenViolations), '충돌 7');
});

test('Cases data: FDI coordinates map covers standard maxillary teeth', () => {
  // Check dental arch teeth 11-17, 21-27
  const requiredFdi = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27];
  for (const fdi of requiredFdi) {
    const coord = FDI_COORDINATES[fdi];
    assert.ok(coord, `Missing coordinates for FDI ${fdi}`);
    assert.ok(typeof coord.x === 'number');
    assert.ok(typeof coord.y === 'number');
  }

  // Universal teeth 2..15 should all resolve to existing coordinates
  for (let u = 2; u <= 15; u++) {
    const fdi = universalToFdi(u);
    assert.ok(FDI_COORDINATES[fdi]);
  }
});

test('Cases data: sortCases sorts by id, status, and plans count', () => {
  const items = [
    { case_id: 'c', displayId: 'C', status: 'ready', plans: [{ id: 1 }, { id: 2 }] },
    { case_id: 'a', displayId: 'A', status: 'violation', plans: [{ id: 1 }] },
    { case_id: 'b', displayId: 'B', status: 'scan_check', plans: [] }
  ];

  // Default preserves original order
  const defaultSorted = sortCases(items, { sortBy: 'default' });
  assert.deepEqual(defaultSorted.map((x) => x.case_id), ['c', 'a', 'b']);

  // Sort by id asc / desc
  const idAsc = sortCases(items, { sortBy: 'id', order: 'asc' });
  assert.deepEqual(idAsc.map((x) => x.case_id), ['a', 'b', 'c']);

  const idDesc = sortCases(items, { sortBy: 'id', order: 'desc' });
  assert.deepEqual(idDesc.map((x) => x.case_id), ['c', 'b', 'a']);

  // Sort by status asc (scan_check -> violation -> ready)
  const statusAsc = sortCases(items, { sortBy: 'status', order: 'asc' });
  assert.deepEqual(statusAsc.map((x) => x.case_id), ['b', 'a', 'c']);

  // Sort by plans count asc
  const plansAsc = sortCases(items, { sortBy: 'plans', order: 'asc' });
  assert.deepEqual(plansAsc.map((x) => x.case_id), ['b', 'a', 'c']);

  const plansDesc = sortCases(items, { sortBy: 'plans', order: 'desc' });
  assert.deepEqual(plansDesc.map((x) => x.case_id), ['c', 'a', 'b']);

  // Handles null / empty
  assert.deepEqual(sortCases(null), []);
  assert.deepEqual(sortCases([]), []);
});

test('Cases data: formatPlanSummary handles ipr, expansion_ipr and array violations', () => {
  const iprPlan = {
    strategy: 'ipr',
    n_stages: 12,
    passed: true,
    violations: []
  };
  assert.equal(formatPlanSummary(iprPlan), 'IPR · 12장 · 통과');

  const expansionIprPlan = {
    strategy: 'expansion_ipr',
    n_stages: 16,
    passed: false,
    violations: ['v1', 'v2']
  };
  assert.equal(formatPlanSummary(expansionIprPlan), '확장 · IPR · 16장 · 위반');

  // Violations formatted with array
  assert.equal(formatViolations({ status: 'ready' }, iprPlan), '0');
  assert.equal(formatViolations({ status: 'violation' }, expansionIprPlan), '충돌 2');
});

