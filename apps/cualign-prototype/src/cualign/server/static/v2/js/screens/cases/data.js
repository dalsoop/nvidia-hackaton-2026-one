// Pure data transformation, grouping, filtering, and formatting for cases screen

import { caseStatus, preferredPlan } from '../../domain/status.js';
import { universalToFdi } from '../../domain/teeth.js';
import { T } from '../../domain/vocab.js';

export const LABEL_ALL = '\uC804\uCCB4';
export const LABEL_DEFAULT_CONDITIONS = '\uC870\uAC74 \u00B7 \uAE30\uBC18\uAC12';
export const LABEL_CONFIRMED = '\uBC88\uD638 \uD655\uC778\uB428';
export const LABEL_EXAMPLE = '(\uC608\uC2DC)';
export const LABEL_CONFLICT = '\uCDA9\uB3CC';
export const LABEL_NONE = '\uC5C6\uC74C';
export const LABEL_EXIST = '\uC788\uC74C';
export const LABEL_NON_EXTRACTION = '\uBE44\uBC1C\uCE58';
export const LABEL_EXTRACTION = '\uBC1C\uCE58';
export const LABEL_EXPANSION = '\uD655\uC7A5';
export const LABEL_IPR = 'IPR';
export const LABEL_EXPANSION_IPR = '\uD655\uC7A5 \u00B7 IPR';
export const LABEL_VIOLATION = '\uC704\uBC18';
export const LABEL_CLOSE_DETAIL = '\uC0C1\uC138 \uB2EB\uAE30';
export const LABEL_OPEN_WORKSPACE = '\uC791\uC5C5\uB300 \uC5F4\uAE30';
export const LABEL_GO_CHECK = '\uC785\uB825 \uD655\uC778\uC73C\uB85C';
export const LABEL_TEETH_INFO = '\uCE58\uC544 \uC815\uBCF4 \u00B7 \uC0C1\uC545 \u00B7 FDI';
export const LABEL_MAXILLARY = '\uC0C1\uC545';
export const LABEL_ROT_CORRECTION = '\uD68C\uC804 \uBCF4\uC815 \uB300\uC0C1';
export const LABEL_HEIGHT_CORRECTION = '\uB192\uC774 \uBCF4\uC815 \uB300\uC0C1';
export const LABEL_SCAN_CHECK = '\uC4A4\uCEA4 \uD655\uC778';
export const LABEL_CROWDING = '\uCD1D\uC0DD';
export const LABEL_MISSING_OUTSIDE = '\uB204\uB77D\u00B7\uBC94\uC704 \uBC16';
export const LABEL_ROTATION = '\uD68C\uC804 \uBCF4\uC815';
export const LABEL_VERTICAL = '\uB192\uC774 \uBCF4\uC815';
export const LABEL_GUM_SCAN = '\uC787\uBAB8 \uC4A4\uCEA4';

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

      const titleSuffix = isConfirmed ? ` \u00B7 ${LABEL_CONFIRMED}` : '';
      const displayTitle = `${caseId} \u00B7 ${T.cases.anonymizedPatient} ${LABEL_EXAMPLE}${titleSuffix}`;
      const displayId = patient.alias ? `${patient.alias} \u00B7 ${scan.scan_id}` : caseId;

      result.push({
        case_id: caseId,
        kind: 'patient',
        patient_id: patient.patient_id,
        patient_alias: patient.alias,
        patient_memo: patient.memo || '',
        scan_id: scan.scan_id,
        displayId,
        displayTitle,
        prescription: LABEL_DEFAULT_CONDITIONS,
        note: patient.memo || '',
        constraints: null,
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
    return '\u2014';
  }
  const strategyMap = {
    expansion: LABEL_EXPANSION,
    ipr: LABEL_IPR,
    expansion_ipr: LABEL_EXPANSION_IPR,
    extraction: LABEL_EXTRACTION
  };
  const strat = strategyMap[plan.strategy] || plan.strategy || '';
  const stages = T.stagesCount(plan.n_stages ?? plan.info?.n_stages ?? 0);
  const vCount = typeof plan.violations === 'number' ? plan.violations : (plan.violations?.length ?? 0);
  const outcome = plan.passed && vCount === 0 ? T.workspace.passed : LABEL_VIOLATION;

  return [strat, stages, outcome].filter(Boolean).join(' \u00B7 ');
}

export function formatViolations(item, plan) {
  if (item?.status === 'scan_check' || !plan) {
    return '\u2014';
  }
  const count = typeof plan.violations === 'number' ? plan.violations : (plan.violations?.length ?? 0);
  if (count === 0) {
    return '0';
  }
  return `${LABEL_CONFLICT} ${count}`;
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
