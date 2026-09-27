// Scan file upload component: drag & drop, client validation, Universal-FDI correspondence table, and error display

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { UPPER_UNIVERSAL, universalToFdi } from '../../domain/teeth.js';
import { ApiError } from '../../api/endpoints.js';

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

const TOOTH_NAMES = {
  1: '우측 제3대구치 (사랑니)',
  2: '우측 제2대구치',
  3: '우측 제1대구치',
  4: '우측 제2소구치',
  5: '우측 제1소구치',
  6: '우측 견치 (송곳니)',
  7: '우측 측절치',
  8: '우측 중절치 (앞니)',
  9: '좌측 중절치 (앞니)',
  10: '좌측 측절치',
  11: '좌측 견치 (송곳니)',
  12: '좌측 제1소구치',
  13: '좌측 제2소구치',
  14: '좌측 제1대구치',
  15: '좌측 제2대구치',
  16: '좌측 제3대구치 (사랑니)'
};

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
      error: '올릴 스캔 파일을 선택해 주세요.',
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
        error: `${name}: 같은 번호의 파일이 두 개 있습니다.`,
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
        error: `파일이 너무 큽니다(파일당 ${MAX_FILE_BYTES >> 20}MB, 한 번에 ${MAX_UPLOAD_BYTES >> 20}MB까지).`,
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
        error: `파일이 너무 큽니다(파일당 ${MAX_FILE_BYTES >> 20}MB, 한 번에 ${MAX_UPLOAD_BYTES >> 20}MB까지).`,
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
      error: `${lower.slice(0, 3).join(', ')}: 하악(Universal 17~32) 번호입니다. 지금은 상악 스캔만 받습니다.`,
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
      error: `${other.slice(0, 3).join(', ')}: 한 덩어리 악궁 스캔으로 보입니다. 지금은 치아별로 나뉜 파일(2.stl … 15.stl, 선택 gingiva.stl)만 받습니다. 자동 치아 분리는 실험 단계입니다.`,
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
      error: '치아별 STL(<치아번호>.stl, Universal 상악 2~15)을 한 개 이상 올려 주세요. 잇몸 파일만으로는 계획할 수 없습니다.',
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

export function resolveErrorCode(code, message) {
  if (code && code !== UPLOAD_ERROR_CODES.SERVER_ERROR) return code;
  if (!message) return UPLOAD_ERROR_CODES.SERVER_ERROR;
  if (message.includes('하악') || message.includes('Universal 17')) return UPLOAD_ERROR_CODES.LOWER_ARCH;
  if (message.includes('같은 번호') || message.includes('중복')) return UPLOAD_ERROR_CODES.DUPLICATE_TOOTH;
  if (message.includes('너무 큽니다') || message.includes('한 번에') || message.includes('413')) return UPLOAD_ERROR_CODES.SIZE_EXCEEDED;
  if (message.includes('한 덩어리 악궁 스캔')) return UPLOAD_ERROR_CODES.MONOLITHIC_SCAN;
  if (message.includes('치아별 STL') || message.includes('잇몸 파일만으로')) return UPLOAD_ERROR_CODES.NO_TEETH;
  return UPLOAD_ERROR_CODES.SERVER_ERROR;
}

export function getErrorDetails(code) {
  switch (code) {
    case UPLOAD_ERROR_CODES.LOWER_ARCH:
      return {
        title: '하악 치아 번호 감지',
        badge: '하악 불가',
        guide: '현재 cuAlign은 상악(Universal 1~16) 스캔 계획만 지원합니다. 하악 치아(Universal 17~32) 파일을 제외하고 올려주세요.'
      };
    case UPLOAD_ERROR_CODES.DUPLICATE_TOOTH:
      return {
        title: '중복 치아 번호 감지',
        badge: '중복 파일',
        guide: '동일한 번호의 치아 STL 파일이 중복 선택되었습니다. 하나의 파일만 남기고 다시 선택해주세요.'
      };
    case UPLOAD_ERROR_CODES.SIZE_EXCEEDED:
      return {
        title: '파일 크기 한도 초과',
        badge: '용량 초과',
        guide: '개별 파일은 60MB 이하, 전체 스캔 합계는 400MB 이하여야 합니다. 메시 해상도를 줄이거나 필요 없는 파일을 정리해주세요.'
      };
    case UPLOAD_ERROR_CODES.MONOLITHIC_SCAN:
      return {
        title: '한 덩어리 악궁 스캔 감지',
        badge: '미분리 스캔',
        guide: '치아가 개별 STL로 분리되지 않은 악궁 전체 메시입니다. 2.stl~15.stl로 분리된 치아 파일을 올려주세요.'
      };
    case UPLOAD_ERROR_CODES.NO_TEETH:
      return {
        title: '상악 치아 파일 누락',
        badge: '치아 없음',
        guide: '계획을 위해서는 2.stl~15.stl 중 최소 1개 이상의 상악 치아 STL이 필요합니다. 잇몸 파일(gingiva.stl)만으로는 계획할 수 없습니다.'
      };
    case UPLOAD_ERROR_CODES.SERVER_ERROR:
    default:
      return {
        title: '스캔 올리기 실패',
        badge: '서버 오류',
        guide: '스캔 데이터를 서버에서 처리하는 중 오류가 발생했습니다. 파일 손상 여부를 확인하세요.'
      };
  }
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
    'aria-label': '스캔 파일 드롭 영역',
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
    h('div', { class: 'upload-dropzone-primary-text' }, '치아별 STL 파일을 이곳에 끌어다 놓거나 클릭하여 선택'),
    h('div', { class: 'upload-dropzone-secondary-text' }, '파일명: 2.stl … 15.stl (Universal 상악 번호) · 선택: gingiva.stl (잇몸)'),
    h('div', { class: 'upload-dropzone-limit-text' }, `파일당 최대 ${MAX_FILE_BYTES >> 20}MB · 1회 업로드 최대 ${MAX_UPLOAD_BYTES >> 20}MB`)
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
    const rawCode = serverError ? UPLOAD_ERROR_CODES.SERVER_ERROR : (currentValidation && !currentValidation.valid ? currentValidation.code : null);
    const errorCode = resolveErrorCode(rawCode, errorMsg);

    if (errorMsg) {
      const details = getErrorDetails(errorCode);
      const offending = currentValidation?.offendingFiles || [];
      const errorCard = h('div', { class: 'upload-error-card', role: 'alert' },
        h('div', { class: 'upload-error-header' },
          h('span', { class: 'badge badge-violation upload-error-badge' }, details.badge),
          h('strong', { class: 'upload-error-title' }, details.title)
        ),
        h('div', { class: 'upload-error-message' }, errorMsg),
        offending.length > 0 ? h('div', { class: 'upload-error-chips' },
          ...offending.map((f) => h('span', { class: 'upload-error-file-chip' }, f))
        ) : null,
        h('div', { class: 'upload-error-guide' }, details.guide)
      );
      statusContainerEl.appendChild(errorCard);
    }

    // If valid files are selected, render summary and upload CTA button
    if (currentValidation && currentValidation.valid && !serverError) {
      const teethList = currentValidation.teeth || [];
      const hasGum = currentValidation.hasGingiva;
      const countText = `상악 치아 ${teethList.length}개${hasGum ? ' · 잇몸 파일 포함' : ''}`;
      const sizeText = formatBytes(currentValidation.totalBytes);

      const summaryCard = h('div', { class: 'upload-summary-card' },
        h('div', { class: 'upload-summary-info' },
          h('span', { class: 'badge badge-ready' }, '검사 통과'),
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
      }, isUploading ? '스캔 올리는 중 — 치아를 읽고 있습니다...' : '스캔 올리기');

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
      }, '다시 선택');

      actionContainerEl.appendChild(h('div', { class: 'upload-btn-row' }, submitBtn, resetBtn));
    }
  }

  async function doUpload() {
    if (!currentValidation || !currentValidation.valid || isUploading) {
      return;
    }
    if (!patient || !patient.patient_id) {
      serverError = new ApiError(0, '선택된 환자가 없습니다.');
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
      h('h4', { class: 'upload-table-title' }, 'Universal ↔ FDI 치아 번호 대응표'),
      h('span', { class: 'upload-table-note' }, 'cuAlign 파일명: Universal 번호(2.stl~15.stl) · 화면 차트: FDI 번호')
    );

    const table = h('table', { class: 'upload-table' },
      h('thead', null,
        h('tr', null,
          h('th', { style: { width: '80px' } }, 'Universal'),
          h('th', { style: { width: '70px' } }, 'FDI'),
          h('th', null, '치아 명칭 (상악)'),
          h('th', { style: { width: '100px' } }, '권장 파일명'),
          h('th', { style: { width: '90px' } }, '선택 상태')
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
        ? h('span', { class: 'badge badge-ready' }, '선택됨')
        : isOptional
        ? h('span', { class: 'badge badge-needs-plan' }, '선택(사랑니)')
        : h('span', { class: 'badge' }, '미포함');

      const tr = h('tr', { class: isSelected ? 'upload-tr-selected' : '' },
        h('td', { class: 'upload-cell-mono font-bold' }, String(u)),
        h('td', { class: 'upload-cell-mono upload-cell-fdi' }, String(fdi)),
        h('td', null, TOOTH_NAMES[u] || `상악 치아 ${u}`),
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
      h('td', null, '상악 잇몸 메시 (선택 사항)'),
      h('td', { class: 'upload-cell-mono' }, 'gingiva.stl'),
      h('td', null, isGumSelected ? h('span', { class: 'badge badge-ready' }, '선택됨') : h('span', { class: 'badge' }, '선택'))
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
