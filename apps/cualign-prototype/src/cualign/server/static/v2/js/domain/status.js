// Case and plan status calculation logic

const STRATEGY_ORDER = Object.freeze([
  'expansion',
  'ipr',
  'expansion_ipr',
  'extraction'
]);

function getViolationsCount(p) {
  if (!p) {
    return 0;
  }
  if (typeof p.violations === 'number') {
    return p.violations;
  }
  if (Array.isArray(p.violations)) {
    return p.violations.length;
  }
  return 0;
}

export function preferredPlan(plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return null;
  }

  const strategyRank = (s) => {
    const idx = STRATEGY_ORDER.indexOf(s);
    return idx === -1 ? STRATEGY_ORDER.length : idx;
  };

  const passed = plans.filter((p) => Boolean(p.passed) && getViolationsCount(p) === 0);
  if (passed.length > 0) {
    return [...passed].sort((a, b) => {
      const diff = strategyRank(a.strategy) - strategyRank(b.strategy);
      if (diff !== 0) {
        return diff;
      }
      const stagesA = a.n_stages ?? a.info?.n_stages ?? 0;
      const stagesB = b.n_stages ?? b.info?.n_stages ?? 0;
      return stagesA - stagesB;
    })[0];
  }

  return [...plans].sort((a, b) => getViolationsCount(a) - getViolationsCount(b))[0];
}

export function canApprove(plan) {
  if (!plan) {
    return false;
  }
  if (getViolationsCount(plan) !== 0) {
    return false;
  }
  const revStatus = plan.review?.status;
  if (revStatus !== 'passed' && revStatus !== 'skipped') {
    return false;
  }
  if (plan.input_stale) {
    return false;
  }
  return true;
}

const PATIENT_CASE_RE = /^(P\d+)-(S\d+)$/;

export function parsePatientCaseId(caseId) {
  const match = String(caseId || '').match(PATIENT_CASE_RE);
  return match ? { pid: match[1], sid: match[2] } : null;
}

export function isPatientCase(caseId, patients = []) {
  if (parsePatientCaseId(caseId)) {
    return true;
  }
  return patients.some((patient) =>
    (patient?.scans || []).some((scan) => scan?.case_id === caseId)
  );
}

export function isScanConfirmed(scan) {
  if (!scan) {
    return false;
  }
  if (typeof scan.confirmed === 'boolean') {
    return scan.confirmed;
  }
  return scan.confirmed_revision !== null &&
    scan.confirmed_revision !== undefined &&
    scan.confirmed_revision === (scan.revision ?? 1);
}

export function sampleCaseNumber(value) {
  if (value && typeof value === 'object') {
    const explicit = value.sample_number ?? value.number;
    if (explicit !== null && explicit !== undefined && String(explicit).trim()) {
      return String(explicit).trim();
    }
    value = value.case_id;
  }
  const match = String(value || '').match(/(\d+)(?!.*\d)/);
  return match ? match[1] : String(value || '');
}

// The server prescription ends with a parenthetical numbering cross-reference
// (FDI vs app numbering); the screen shows only the prescription itself.
const TRAILING_PAREN = /\s*\([^()]*\)\s*$/;

export function stripPrescriptionNote(text) {
  return String(text || '').replace(TRAILING_PAREN, '').trim();
}

export function patientCaseLabel(patient, scan) {
  return patient?.alias && scan?.scan_id ? `${patient.alias} · ${scan.scan_id}` : String(scan?.case_id || '');
}

export function caseStatus({ scan = null, plans = [] } = {}) {
  if (scan && scan.confirmed === false) {
    return 'scan_check';
  }
  if (!Array.isArray(plans) || plans.length === 0) {
    return 'needs_plan';
  }
  if (plans.some((p) => Boolean(p.approval))) {
    return 'approved';
  }

  const pref = preferredPlan(plans);
  if (!pref) {
    return 'needs_plan';
  }
  if (pref.approval) {
    return 'approved';
  }
  if (!pref.passed || getViolationsCount(pref) > 0) {
    return 'violation';
  }
  return 'ready';
}
