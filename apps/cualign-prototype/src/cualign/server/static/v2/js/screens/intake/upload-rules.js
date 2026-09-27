// Pure scan file rules for the upload block: file name parsing, client-side
// validation that mirrors the server limits, and byte formatting.

import { TOOTH_NAMES, UPLOAD_MESSAGES } from '../../domain/vocab/intake.js';

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
