// Scan file upload component: drag & drop, client validation, Universal-FDI correspondence table, and error display

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { UPPER_UNIVERSAL, universalToFdi } from '../../domain/teeth.js';
import { ApiError } from '../../api/endpoints.js';
import {
  TOOTH_NAMES,
  INTAKE_TEXTS,
  UPLOAD_MESSAGES
} from '../../domain/vocab/intake.js';

export const MAX_FILE_BYTES = 60 * 1024 * 1024;       // 60 MB: per-file STL limit
export const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;   // 400 MB: total scan upload limit

export const UPLOAD_ERROR_CODES = {
  EMPTY: 'EMPTY',
  LOWER_ARCH: 'LOWER_ARCH',
  DUPLICATE_TOOTH: 'DUPLICATE_TOOTH',
  SIZE_EXCEEDED: 'SIZE_EXCEEDED',
  MONOLITHIC_SCAN: 'MONOLITHIC_SCAN',
  NO_TEETH: 'NO_TEETH',
  SERVER_ERROR: 'SERVER_ERROR'
};

export { TOOTH_NAMES };

export function scanFileName(fileName) {
  const base = String(fileName || '').split('/').pop().split('\\').pop();
  if (base.toLowerCase() === 'gingiva.stl') {
    return { name: 'gingiva.stl', kind: 'gum', toothNumber: null, rawName: base };
  }

  // Exact tooth numbers: 1..32 without leading zero padding (e.g. "000018.stl" is a scan ID, not tooth 18)
  const match = base.match(/^([1-9]|[12]\d|3[0-2])\.stl$/i);
  if (match) {
    const n = Number(match[1]);
    if (n <= 16) {
      return { name: `${n}.stl`, kind: 'tooth', toothNumber: n, rawName: base };
    }
    return { name: null, kind: 'lower', toothNumber: n, rawName: base };
  }

  return { name: null, kind: 'other', toothNumber: null, rawName: base };
}

export function validateScanFiles(files) {
  if (!files || files.length === 0) {
    return {
      ok: false,
      valid: false,
      code: UPLOAD_ERROR_CODES.EMPTY,
      error: UPLOAD_MESSAGES.selectFiles,
      teeth: [],
      hasGingiva: false,
      totalBytes: 0,
      offendingFiles: []
    };
  }

  const seen = new Set();
  const lower = [];
  const other = [];
  let totalBytes = 0;
  const teeth = [];
  let hasGingiva = false;

  for (const file of files) {
    const rawName = file.name || String(file);
    const size = typeof file.size === 'number' ? file.size : 0;
    const { name, kind, toothNumber } = scanFileName(rawName);

    if (kind === 'lower') {
      lower.push(rawName);
      continue;
    }

    if (name === null) {
      const lowerRaw = rawName.toLowerCase();
      if (lowerRaw.endsWith('.stl') || lowerRaw.endsWith('.ply') || lowerRaw.endsWith('.obj')) {
        other.push(rawName);
      }
      continue;
    }

    if (seen.has(name)) {
      return {
        ok: false,
        valid: false,
        code: UPLOAD_ERROR_CODES.DUPLICATE_TOOTH,
        error: UPLOAD_MESSAGES.duplicateTooth(name),
        offendingFile: name,
        offendingFiles: [name],
        teeth,
        hasGingiva,
        totalBytes
      };
    }
    seen.add(name);

    if (size > MAX_FILE_BYTES) {
      return {
        ok: false,
        valid: false,
        code: UPLOAD_ERROR_CODES.SIZE_EXCEEDED,
        error: UPLOAD_MESSAGES.sizeExceeded(MAX_FILE_BYTES >> 20, MAX_UPLOAD_BYTES >> 20),
        offendingFile: rawName,
        offendingFiles: [rawName],
        teeth,
        hasGingiva,
        totalBytes: totalBytes + size
      };
    }

    totalBytes += size;
    if (totalBytes > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        valid: false,
        code: UPLOAD_ERROR_CODES.SIZE_EXCEEDED,
        error: UPLOAD_MESSAGES.sizeExceeded(MAX_FILE_BYTES >> 20, MAX_UPLOAD_BYTES >> 20),
        offendingFile: rawName,
        offendingFiles: [rawName],
        teeth,
        hasGingiva,
        totalBytes
      };
    }

    if (kind === 'tooth') {
      teeth.push(toothNumber);
    } else if (kind === 'gum') {
      hasGingiva = true;
    }
  }

  if (lower.length > 0) {
    return {
      ok: false,
      valid: false,
      code: UPLOAD_ERROR_CODES.LOWER_ARCH,
      error: UPLOAD_MESSAGES.lowerArch(lower.slice(0, 3).join(', ')),
      offendingFiles: lower,
      teeth,
      hasGingiva,
      totalBytes
    };
  }

  if (other.length > 0 && teeth.length === 0) {
    return {
      ok: false,
      valid: false,
      code: UPLOAD_ERROR_CODES.MONOLITHIC_SCAN,
      error: UPLOAD_MESSAGES.monolithicScan(other.slice(0, 3).join(', ')),
      offendingFiles: other,
      teeth,
      hasGingiva,
      totalBytes
    };
  }

  if (teeth.length === 0) {
    return {
      ok: false,
      valid: false,
      code: UPLOAD_ERROR_CODES.NO_TEETH,
      error: UPLOAD_MESSAGES.noTeeth,
      offendingFiles: other,
      teeth: [],
      hasGingiva,
      totalBytes
    };
  }

  return {
    ok: true,
    valid: true,
    code: null,
    error: null,
    teeth: teeth.sort((a, b) => a - b),
    hasGingiva,
    totalBytes
  };
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function renderUpload(container, {
  patient,
  ctx,
  onUploaded = null
} = {}) {
  clear(container);

  let currentFiles = [];
  let currentValidation = null;
  let serverError = null;
  let isUploading = false;

  const sectionEl = h('div', { class: 'upload-container' });

  // 1. Header
  const headerEl = h('div', { class: 'upload-header' },
    h('h3', { class: 'upload-title' }, T.intake.uploadTitle),
    h('p', { class: 'upload-subtitle' }, T.intake.dropHint)
  );

  // 2. Dropzone
  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    accept: '.stl,.ply,.obj',
    class: 'upload-file-input',
    style: { display: 'none' },
    onChange: (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileSelection(Array.from(e.target.files));
      }
    }
  });

  const dropzoneIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dropzoneIcon.setAttribute('width', '36');
  dropzoneIcon.setAttribute('height', '36');
  dropzoneIcon.setAttribute('viewBox', '0 0 24 24');
  dropzoneIcon.setAttribute('fill', 'none');
  dropzoneIcon.setAttribute('stroke', 'currentColor');
  dropzoneIcon.setAttribute('stroke-width', '1.8');
  dropzoneIcon.setAttribute('stroke-linecap', 'round');
  dropzoneIcon.setAttribute('stroke-linejoin', 'round');
  const dPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  dPath.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12');
  dropzoneIcon.appendChild(dPath);

  const dropzoneEl = h('div', {
    class: 'upload-dropzone',
    tabIndex: 0,
    role: 'button',
    'aria-label': INTAKE_TEXTS.dropzoneAriaLabel,
    onClick: () => {
      if (!isUploading) {
        fileInput.click();
      }
    },
    onKeydown: (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
        e.preventDefault();
        fileInput.click();
      }
    },
    onDragover: (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneEl.classList.add('upload-dropzone-dragover');
    },
    onDragleave: (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneEl.classList.remove('upload-dropzone-dragover');
    },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneEl.classList.remove('upload-dropzone-dragover');
      if (isUploading) return;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelection(Array.from(e.dataTransfer.files));
      }
    }
  },
    dropzoneIcon,
    h('div', { class: 'upload-dropzone-primary-text' }, INTAKE_TEXTS.dropzonePrimary),
    h('div', { class: 'upload-dropzone-secondary-text' }, INTAKE_TEXTS.dropzoneSecondary),
    h('div', { class: 'upload-dropzone-limit-text' }, INTAKE_TEXTS.dropzoneLimits(MAX_FILE_BYTES >> 20, MAX_UPLOAD_BYTES >> 20))
  );

  // 3. Error and Status Display Box
  const statusContainerEl = h('div', { class: 'upload-status-area' });

  // 4. File preview & Upload action bar
  const actionContainerEl = h('div', { class: 'upload-actions-area' });

  // 5. Universal <-> FDI Correspondence Table
  const tableContainerEl = h('div', { class: 'upload-table-section' });

  function handleFileSelection(files) {
    currentFiles = files;
    serverError = null;
    currentValidation = validateScanFiles(files);
    updateStatusAndActions();
    renderTeethTable();
  }

  function updateStatusAndActions() {
    clear(statusContainerEl);
    clear(actionContainerEl);

    // If there is a validation error or server error, render UploadErrors view
    const errorMsg = serverError ? serverError.message : (currentValidation && !currentValidation.valid ? currentValidation.error : null);
    if (errorMsg) {
      const offending = currentValidation?.offendingFiles || [];
      const errorCard = h('div', { class: 'upload-error-card', role: 'alert' },
        h('div', { class: 'upload-error-message' }, errorMsg),
        offending.length > 0 ? h('div', { class: 'upload-error-chips' },
          ...offending.map((f) => h('span', { class: 'upload-error-file-chip' }, f))
        ) : null
      );
      statusContainerEl.appendChild(errorCard);
    }

    // If valid files are selected, render summary and upload CTA button
    if (currentValidation && currentValidation.valid && !serverError) {
      const teethList = currentValidation.teeth || [];
      const hasGum = currentValidation.hasGingiva;
      const countText = INTAKE_TEXTS.summaryTeethCount(teethList.length, hasGum);
      const sizeText = formatBytes(currentValidation.totalBytes);

      const summaryCard = h('div', { class: 'upload-summary-card' },
        h('div', { class: 'upload-summary-info' },
          h('span', { class: 'badge badge-ready' }, INTAKE_TEXTS.validationPassedBadge),
          h('span', { class: 'upload-summary-count' }, countText),
          h('span', { class: 'upload-summary-size' }, sizeText)
        ),
        h('div', { class: 'upload-summary-chips' },
          ...teethList.map((t) => h('span', { class: 'upload-tooth-chip' }, `${t}.stl (${universalToFdi(t) || t})`)),
          hasGum ? h('span', { class: 'upload-tooth-chip upload-tooth-chip-gum' }, 'gingiva.stl') : null
        )
      );
      statusContainerEl.appendChild(summaryCard);

      const submitBtn = h('button', {
        type: 'button',
        class: 'btn btn-primary upload-submit-btn',
        disabled: isUploading,
        onClick: () => doUpload()
      }, isUploading ? INTAKE_TEXTS.uploading : INTAKE_TEXTS.uploadBtn);

      const resetBtn = h('button', {
        type: 'button',
        class: 'btn btn-ghost upload-reset-btn',
        disabled: isUploading,
        onClick: () => {
          currentFiles = [];
          currentValidation = null;
          serverError = null;
          fileInput.value = '';
          updateStatusAndActions();
          renderTeethTable();
        }
      }, INTAKE_TEXTS.reselectBtn);

      actionContainerEl.appendChild(h('div', { class: 'upload-btn-row' }, submitBtn, resetBtn));
    }
  }

  async function doUpload() {
    if (!currentValidation || !currentValidation.valid || isUploading) {
      return;
    }
    if (!patient || !patient.patient_id) {
      serverError = new ApiError(0, INTAKE_TEXTS.noPatientSelected);
      updateStatusAndActions();
      return;
    }

    isUploading = true;
    serverError = null;
    updateStatusAndActions();

    try {
      const pid = patient.patient_id;
      const res = await ctx.api.uploadScan(pid, currentFiles);

      if (typeof onUploaded === 'function') {
        onUploaded(res);
      }

      // If upload succeeds and res contains check (or case_id), navigate directly to #/check/<case_id>
      const caseId = res?.check?.case_id || res?.case_id;
      if (caseId) {
        if (ctx.store) {
          ctx.store.set({ caseId });
        }
        if (ctx.navigate) {
          ctx.navigate(`#/check/${encodeURIComponent(caseId)}`);
        }
      }
    } catch (err) {
      isUploading = false;
      const message = err?.message || T.errors.requestFailed;
      serverError = new ApiError(err?.status || 500, message);
      updateStatusAndActions();
    }
  }

  function renderTeethTable() {
    clear(tableContainerEl);

    const uploadedTeethSet = new Set(currentValidation?.teeth || []);

    const heading = h('div', { class: 'upload-table-heading' },
      h('h4', { class: 'upload-table-title' }, INTAKE_TEXTS.tableTitle),
      h('span', { class: 'upload-table-note' }, INTAKE_TEXTS.tableNote)
    );

    const table = h('table', { class: 'upload-table' },
      h('thead', null,
        h('tr', null,
          h('th', { style: { width: '80px' } }, INTAKE_TEXTS.tableColUniversal),
          h('th', { style: { width: '70px' } }, INTAKE_TEXTS.tableColFdi),
          h('th', null, INTAKE_TEXTS.tableColName),
          h('th', { style: { width: '100px' } }, INTAKE_TEXTS.tableColFileName),
          h('th', { style: { width: '90px' } }, INTAKE_TEXTS.tableColStatus)
        )
      )
    );

    const tbody = h('tbody');
    for (const u of UPPER_UNIVERSAL) {
      const fdi = universalToFdi(u);
      const isSelected = uploadedTeethSet.has(u);
      const isOptional = u === 1 || u === 16;
      const fileName = `${u}.stl`;

      const statusBadge = isSelected
        ? h('span', { class: 'badge badge-ready' }, INTAKE_TEXTS.badgeSelected)
        : isOptional
        ? h('span', { class: 'badge badge-needs-plan' }, INTAKE_TEXTS.badgeOptionalWisdom)
        : h('span', { class: 'badge' }, INTAKE_TEXTS.badgeNotIncluded);

      const tr = h('tr', { class: isSelected ? 'upload-tr-selected' : '' },
        h('td', { class: 'upload-cell-mono font-bold' }, String(u)),
        h('td', { class: 'upload-cell-mono upload-cell-fdi' }, String(fdi)),
        h('td', null, TOOTH_NAMES[u] || INTAKE_TEXTS.defaultToothName(u)),
        h('td', { class: 'upload-cell-mono' }, fileName),
        h('td', null, statusBadge)
      );
      tbody.appendChild(tr);
    }

    // Gingiva row
    const isGumSelected = Boolean(currentValidation?.hasGingiva);
    const gumTr = h('tr', { class: isGumSelected ? 'upload-tr-selected' : '' },
      h('td', { class: 'upload-cell-mono' }, '-'),
      h('td', { class: 'upload-cell-mono' }, '-'),
      h('td', null, INTAKE_TEXTS.gingivaMeshLabel),
      h('td', { class: 'upload-cell-mono' }, 'gingiva.stl'),
      h('td', null, isGumSelected ? h('span', { class: 'badge badge-ready' }, INTAKE_TEXTS.badgeSelected) : h('span', { class: 'badge' }, INTAKE_TEXTS.badgeSelect))
    );
    tbody.appendChild(gumTr);

    table.appendChild(tbody);
    tableContainerEl.appendChild(heading);
    tableContainerEl.appendChild(table);
  }

  sectionEl.appendChild(headerEl);
  sectionEl.appendChild(fileInput);
  sectionEl.appendChild(dropzoneEl);
  sectionEl.appendChild(statusContainerEl);
  sectionEl.appendChild(actionContainerEl);
  sectionEl.appendChild(tableContainerEl);

  renderTeethTable();
  container.appendChild(sectionEl);

  return container;
}
