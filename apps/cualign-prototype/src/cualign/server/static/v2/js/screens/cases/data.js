// Pure data transformation, grouping, filtering, and formatting for cases screen

import { caseStatus, preferredPlan } from '../../domain/status.js';
import { universalToFdi } from '../../domain/teeth.js';
import { T as TCommon } from '../../domain/vocab.js';
import { TCases } from '../../domain/vocab/cases.js';

export const FDI_COORDINATES = Object.freeze({
  18: { x: 12, y: 235 },
  17: { x: 10, y: 181 },
  16: { x: 15, y: 127 },
  15: { x: 29, y: 89 },
  14: { x: 51, y: 59 },
  13: { x: 81, y: 36 },
  12: { x: 116, y: 20 },
  11: { x: 155, y: 12 },
  21: { x: 195, y: 12 },
  22: { x: 234, y: 20 },
  23: { x: 269, y: 36 },
  24: { x: 299, y: 59 },
  25: { x: 321, y: 89 },
  26: { x: 335, y: 127 },
  27: { x: 340, y: 181 },
  28: { x: 338, y: 235 }
});

export function groupPlansByCaseId(plans) {
  const map = new Map();
  if (!Array.isArray(plans)) {
    return map;
  }
  for (const plan of plans) {
    if (!plan || !plan.case_id) {
      continue;
    }
    const list = map.get(plan.case_id) || [];
    list.push(plan);
    map.set(plan.case_id, list);
  }
  return map;
}

export function transformCasesData({ casesData, patientsData, plansData }) {
  const plansList = plansData?.plans || (Array.isArray(plansData) ? plansData : []);
  const plansByCase = groupPlansByCaseId(plansList);

  const result = [];

  // 1. Patient scans as individual cases
  const patientsList = patientsData?.patients || (Array.isArray(patientsData) ? patientsData : []);
  for (const patient of patientsList) {
    const scans = Array.isArray(patient?.scans) ? patient.scans : [];
    for (const scan of scans) {
      const caseId = scan.case_id || `${patient.patient_id}-${scan.scan_id}`;
      const isConfirmed = Boolean(
        scan.confirmed_revision !== null &&
        scan.confirmed_revision !== undefined &&
        scan.confirmed_revision === (scan.revision ?? 1)
      );
      const scanObj = { ...scan, confirmed: isConfirmed };
      const plans = plansByCase.get(caseId) || [];
      const status = caseStatus({ scan: scanObj, plans });
      const pref = preferredPlan(plans);

      const titleParts = [caseId];
      if (patient.memo) {
        titleParts.push(patient.memo);
      }
      if (isConfirmed) {
        titleParts.push(TCases.confirmed);
      }
      const displayTitle = titleParts.join(' · ');
      const displayId = patient.alias ? `${patient.alias} · ${scan.scan_id}` : caseId;

      result.push({
        case_id: caseId,
        kind: 'patient',
        patient_id: patient.patient_id,
        patient_alias: patient.alias,
        patient_memo: patient.memo || '',
        scan_id: scan.scan_id,
        displayId,
        displayTitle,
        prescription: TCases.defaultConditions,
        note: patient.memo || '',
        constraints: scan.constraints || null,
        scan: scanObj,
        plans,
        status,
        preferredPlan: pref
      });
    }
  }

  // 2. Sample cases
  const rawCases = casesData?.cases || (Array.isArray(casesData) ? casesData : []);
  for (const c of rawCases) {
    if (c.kind && c.kind !== 'sample') {
      continue;
    }
    const caseId = c.case_id;
    const plans = plansByCase.get(caseId) || [];
    const status = caseStatus({ scan: null, plans });
    const pref = preferredPlan(plans);

    result.push({
      case_id: caseId,
      kind: 'sample',
      patient_id: null,
      patient_alias: null,
      patient_memo: '',
      scan_id: null,
      displayId: caseId,
      displayTitle: c.title || caseId,
      prescription: c.prescription || '',
      note: c.note || '',
      constraints: c.constraints || null,
      scan: null,
      plans,
      status,
      preferredPlan: pref
    });
  }

  return result;
}

export function filterCases(cases, { statusFilter = 'all', kindFilter = 'all' } = {}) {
  if (!Array.isArray(cases)) {
    return [];
  }
  return cases.filter((c) => {
    if (statusFilter && statusFilter !== 'all' && c.status !== statusFilter) {
      return false;
    }
    if (kindFilter && kindFilter !== 'all' && c.kind !== kindFilter) {
      return false;
    }
    return true;
  });
}

export function countByStatus(cases) {
  const counts = {
    all: 0,
    scan_check: 0,
    needs_plan: 0,
    violation: 0,
    ready: 0,
    approved: 0
  };
  if (!Array.isArray(cases)) {
    return counts;
  }
  counts.all = cases.length;
  for (const c of cases) {
    if (c.status in counts) {
      counts[c.status] += 1;
    }
  }
  return counts;
}

export function countByKind(cases) {
  const counts = {
    all: 0,
    sample: 0,
    patient: 0
  };
  if (!Array.isArray(cases)) {
    return counts;
  }
  counts.all = cases.length;
  for (const c of cases) {
    if (c.kind in counts) {
      counts[c.kind] += 1;
    }
  }
  return counts;
}

export function formatPlanSummary(plan) {
  if (!plan) {
    return '—';
  }
  const strategyMap = {
    expansion: TCases.expansion,
    ipr: TCases.ipr,
    expansion_ipr: TCases.expansionIpr,
    extraction: TCases.extraction
  };
  const strat = strategyMap[plan.strategy] || plan.strategy || '';
  const stages = TCommon.stagesCount(plan.n_stages ?? plan.info?.n_stages ?? 0);
  const vCount = typeof plan.violations === 'number' ? plan.violations : (plan.violations?.length ?? 0);
  const outcome = plan.passed && vCount === 0 ? TCases.passed : TCases.violation;

  return [strat, stages, outcome].filter(Boolean).join(' · ');
}

export function formatViolations(item, plan) {
  if (item?.status === 'scan_check' || !plan) {
    return '—';
  }
  const count = typeof plan.violations === 'number' ? plan.violations : (plan.violations?.length ?? 0);
  if (count === 0) {
    return '0';
  }
  return TCases.conflict(count);
}

export function formatConstraintTags(constraints) {
  if (!constraints) {
    return [];
  }
  const tags = [];
  const isExtraction = Boolean(constraints.allow_extraction);
  tags.push({ text: isExtraction ? TCases.extraction : TCases.nonExtraction, accent: false });

  if (Array.isArray(constraints.lock) && constraints.lock.length > 0) {
    const fdiLocks = constraints.lock.map((u) => universalToFdi(u) || u);
    tags.push({ text: TCases.lockTeeth(fdiLocks.join(', ')), accent: true });
  }

  if (Array.isArray(constraints.ipr_exclude) && constraints.ipr_exclude.length > 0) {
    const fdiExcludes = constraints.ipr_exclude.map((u) => universalToFdi(u) || u);
    tags.push({ text: TCases.iprExclude(fdiExcludes.join(', ')), accent: true });
  }

  if (typeof constraints.ipr_limit_mm === 'number') {
    tags.push({ text: TCases.iprLimit(constraints.ipr_limit_mm), accent: false });
  }

  if (typeof constraints.stage_cap === 'number' && constraints.stage_cap > 0) {
    tags.push({ text: TCases.stageCap(constraints.stage_cap), accent: false });
  } else if (constraints.stage_cap === null || constraints.stage_cap === undefined) {
    tags.push({ text: TCases.noStageCap, accent: false });
  }

  if (constraints.order === 'anterior_first') {
    tags.push({ text: TCases.orderAnteriorFirst, accent: false });
  } else if (constraints.order === 'sequential') {
    tags.push({ text: TCases.orderSequential, accent: false });
  } else if (constraints.order === 'simultaneous' || constraints.order) {
    tags.push({ text: TCases.orderSimultaneous, accent: false });
  }

  return tags;
}

export function sortCases(cases, { sortBy = 'default', order = 'asc' } = {}) {
  if (!Array.isArray(cases)) {
    return [];
  }
  const list = [...cases];
  if (sortBy === 'default') {
    return list;
  }
  const direction = order === 'desc' ? -1 : 1;
  return list.sort((a, b) => {
    if (sortBy === 'id' || sortBy === 'case') {
      const aVal = a.displayId || a.case_id || '';
      const bVal = b.displayId || b.case_id || '';
      return direction * aVal.localeCompare(bVal);
    }
    if (sortBy === 'status') {
      const orderMap = { scan_check: 1, needs_plan: 2, violation: 3, ready: 4, approved: 5 };
      const aVal = orderMap[a.status] || 99;
      const bVal = orderMap[b.status] || 99;
      return direction * (aVal - bVal);
    }
    if (sortBy === 'plans') {
      const aCount = a.plans ? a.plans.length : 0;
      const bCount = b.plans ? b.plans.length : 0;
      return direction * (aCount - bCount);
    }
    return 0;
  });
}
