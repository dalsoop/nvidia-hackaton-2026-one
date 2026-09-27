// Main panel of the intake screen: patient header, scan list and scan upload.
// The upload block is kept across re-renders of the same patient so files a
// user already picked are not dropped when a delete prompt opens or closes.

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { isScanConfirmed } from '../../domain/status.js';
import { INTAKE_TEXTS } from '../../domain/vocab/intake.js';
import { formatPatientDate } from './patient-list.js';
import { renderUpload } from './upload.js';

function confirmBox(text, onConfirm, onCancel) {
  return h('div', { class: 'intake-inline-confirm-box', role: 'alert' },
    h('span', { class: 'intake-inline-confirm-text' }, text),
    h('button', { type: 'button', class: 'btn btn-danger small', onClick: onConfirm }, INTAKE_TEXTS.deleteConfirmBtn),
    h('button', { type: 'button', class: 'btn btn-ghost small', onClick: onCancel }, INTAKE_TEXTS.cancelBtn)
  );
}

function patientHeader(patient, ui, actions) {
  const headerActions = h('div', { class: 'intake-patient-header-actions' });
  headerActions.appendChild(ui.deletingPatient
    ? confirmBox(
      INTAKE_TEXTS.confirmDeletePatient(patient.alias, patient.patient_id),
      actions.onDeletePatient,
      () => actions.onAskDeletePatient(false)
    )
    : h('button', {
      type: 'button',
      class: 'btn btn-ghost intake-delete-patient-btn',
      title: INTAKE_TEXTS.deletePatientTitle,
      onClick: () => actions.onAskDeletePatient(true)
    }, INTAKE_TEXTS.deletePatientBtn));

  return h('div', { class: 'intake-patient-header' },
    h('div', { class: 'intake-patient-header-text' },
      h('h2', { class: 'intake-patient-alias' }, patient.alias),
      h('div', { class: 'intake-patient-meta' },
        INTAKE_TEXTS.patientMeta(patient.patient_id, formatPatientDate(patient.created_at), patient.memo)
      )
    ),
    headerActions
  );
}

function scanRow(patient, scan, ui, actions) {
  const confirmed = isScanConfirmed(scan);
  const caseId = scan.case_id || `${patient.patient_id}-${scan.scan_id}`;
  const rowActions = h('div', { class: 'intake-scan-actions' });

  if (ui.deletingScanId === scan.scan_id) {
    rowActions.appendChild(confirmBox(
      INTAKE_TEXTS.confirmDeleteScan(scan.scan_id),
      () => actions.onDeleteScan(scan.scan_id, caseId),
      () => actions.onAskDeleteScan(null)
    ));
  } else {
    rowActions.append(
      h('a', { href: `#/check/${encodeURIComponent(caseId)}`, class: 'btn btn-ghost small intake-check-btn' }, INTAKE_TEXTS.checkScanBtn),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost small intake-scan-del-btn',
        title: INTAKE_TEXTS.deleteScanTitle,
        onClick: () => actions.onAskDeleteScan(scan.scan_id)
      }, INTAKE_TEXTS.deleteScanBtn)
    );
  }

  return h('div', { class: 'intake-scan-row' },
    h('div', { class: 'intake-scan-info' },
      h('div', { class: 'intake-scan-title-row' },
        h('span', { class: 'intake-scan-id font-bold' }, INTAKE_TEXTS.scanMaxilla(scan.scan_id)),
        h('span', { class: ['badge', confirmed ? 'badge-ready' : 'badge-scan-check'] },
          confirmed ? INTAKE_TEXTS.confirmedBadge : INTAKE_TEXTS.unconfirmedBadge)
      ),
      h('div', { class: 'intake-scan-meta' },
        INTAKE_TEXTS.scanMeta({
          teethCount: scan.teeth?.length || 0,
          hasGingiva: Boolean(scan.gingiva),
          uploadedAt: formatPatientDate(scan.uploaded_at),
          isConfirmed: confirmed,
          plansCount: scan.plans ?? 0
        })
      )
    ),
    rowActions
  );
}

function scanSection(patient, ui, actions) {
  const scans = patient.scans || [];
  const section = h('div', { class: 'intake-scans-section' },
    h('div', { class: 'intake-section-header' },
      h('h3', { class: 'intake-section-title' }, INTAKE_TEXTS.scanListTitle),
      h('span', { class: 'intake-section-badge' }, T.itemsCount(scans.length))
    )
  );
  if (!scans.length) {
    section.appendChild(h('div', { class: 'intake-scans-empty' }, INTAKE_TEXTS.noScans));
    return section;
  }
  // Newest scan first.
  section.appendChild(h('div', { class: 'intake-scans-list' },
    ...[...scans].reverse().map((scan) => scanRow(patient, scan, ui, actions))
  ));
  return section;
}

export function createPatientDetail(container, { ctx, actions }) {
  let uploadEl = null;
  let uploadPid = null;

  function uploadFor(patient) {
    if (uploadPid !== patient.patient_id) {
      uploadPid = patient.patient_id;
      uploadEl = h('div', { class: 'intake-upload-wrapper' });
      renderUpload(uploadEl, { patient, ctx, onUploaded: actions.onUploaded });
    }
    return uploadEl;
  }

  return {
    showEmpty({ hasPatients, error }) {
      clear(container);
      uploadEl = uploadPid = null;
      if (error) container.appendChild(h('div', { class: 'upload-error-card intake-error-bar', role: 'alert' }, error));
      container.appendChild(h('div', { class: 'intake-empty-view' },
        hasPatients ? null : h('p', { class: 'intake-empty-title' }, INTAKE_TEXTS.noPatients)
      ));
    },
    showPatient(patient, ui) {
      clear(container);
      container.appendChild(patientHeader(patient, ui, actions));
      if (ui.error) {
        container.appendChild(h('div', { class: 'upload-error-card intake-error-bar', role: 'alert' }, ui.error));
      }
      container.appendChild(scanSection(patient, ui, actions));
      container.appendChild(uploadFor(patient));
    }
  };
}
