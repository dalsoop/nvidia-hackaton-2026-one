// Restores the case shown by the shell (topbar label, rail scan state,
// sample prescription) when a case route is entered directly or reloaded.

import {
  isScanConfirmed,
  parsePatientCaseId,
  patientCaseLabel,
  sampleCaseNumber,
  stripPrescriptionNote
} from '../domain/status.js';

export function patientContext(patient, caseId) {
  const scan = (patient?.scans || []).find((item) => item?.case_id === caseId);
  if (!scan) return null;
  return {
    caseDisplayId: patientCaseLabel(patient, scan),
    caseTitle: patient.memo || '',
    currentScan: { ...scan, confirmed: isScanConfirmed(scan) }
  };
}

export function sampleContext(casesResponse, caseId) {
  const found = (casesResponse?.cases || []).find((item) => item?.case_id === caseId);
  if (!found) return null;
  return {
    caseDisplayId: sampleCaseNumber(found),
    caseTitle: found.title || '',
    currentCase: {
      case_id: found.case_id,
      title: found.title || '',
      prescription: stripPrescriptionNote(found.prescription),
      note: found.note || ''
    }
  };
}

export async function loadCaseContext(api, caseId) {
  const patientIds = parsePatientCaseId(caseId);
  if (patientIds) {
    return patientContext(await api.getPatient(patientIds.pid), caseId);
  }
  return sampleContext(await api.listCases(), caseId);
}
