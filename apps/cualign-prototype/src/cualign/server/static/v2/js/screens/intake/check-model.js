// Pure state derivation and formatting for the scan input check screen.

import { universalToFdi } from '../../domain/teeth.js';
import { parsePatientCaseId } from '../../domain/status.js';
import { CHECK_VOCAB } from '../../domain/vocab/check.js';

/**
 * Pure function: derives screen and UI state from caseCheck API payload.
 *
 * @param {object|null} check
 * @returns {object}
 */
export function deriveCheckState(check) {
  if (!check || typeof check !== 'object') {
    return {
      caseId: '',
      revision: 1,
      confirmed: false,
      confirmedAt: null,
      isSupported: false,
      ready: false,
      unsupportedReasons: [],
      isReversed: false,
      hasOrientationNotice: false,
      orientationNote: '',
      orientation: {},
      teeth: [],
      fdiTeeth: [],
      missing: [],
      fdiMissing: [],
      outside: [],
      fdiOutside: [],
      crowding_mm: 0,
      scannedGingiva: false,
      widths: [],
      rotations: [],
      verticals: [],
      primaryAction: {
        label: CHECK_VOCAB.btnUnsupported,
        disabled: true,
        type: 'unsupported'
      },
      showDelete: true
    };
  }

  let unsupportedReasons = [];
  if (Array.isArray(check.unsupported)) {
    unsupportedReasons = check.unsupported.filter(Boolean);
  } else if (typeof check.unsupported === 'string' && check.unsupported.trim()) {
    unsupportedReasons = [check.unsupported.trim()];
  }

  const isSupported = unsupportedReasons.length === 0 && check.ready !== false;
  if (!isSupported && unsupportedReasons.length === 0) {
    unsupportedReasons = [CHECK_VOCAB.unsupportedDefaultReason];
  }
  const ready = Boolean(check.ready !== false && isSupported);

  const orientation = check.orientation || {};
  const isReversed = orientation.side === 'reversed';
  const hasOrientationNotice = orientation.basis === 'none';
  const orientationNote = orientation.note || '';

  const teeth = Array.isArray(check.teeth) ? check.teeth : [];
  const fdiTeeth = teeth
    .map((u) => ({ universal: u, fdi: universalToFdi(u) }))
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const missing = Array.isArray(check.missing) ? check.missing : [];
  const fdiMissing = missing
    .map((u) => ({ universal: u, fdi: universalToFdi(u) }))
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const outside = Array.isArray(check.outside) ? check.outside : [];
  const fdiOutside = outside
    .map((u) => ({ universal: u, fdi: universalToFdi(u) }))
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const rawWidths = check.widths_mm || {};
  const widths = Object.entries(rawWidths)
    .map(([uStr, w]) => {
      const u = Number(uStr);
      return {
        universal: u,
        fdi: universalToFdi(u),
        width_mm: typeof w === 'number' ? w : Number(w)
      };
    })
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const rawRot = check.rotation_deg || {};
  const rotations = Object.entries(rawRot)
    .map(([uStr, deg]) => {
      const u = Number(uStr);
      return {
        universal: u,
        fdi: universalToFdi(u),
        deg: typeof deg === 'number' ? deg : Number(deg)
      };
    })
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const rawVert = check.vertical_mm || {};
  const verticals = Object.entries(rawVert)
    .map(([uStr, mm]) => {
      const u = Number(uStr);
      return {
        universal: u,
        fdi: universalToFdi(u),
        mm: typeof mm === 'number' ? mm : Number(mm)
      };
    })
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const primaryAction = isSupported
    ? { label: CHECK_VOCAB.btnStartPlan, disabled: false, type: 'confirm' }
    : { label: CHECK_VOCAB.btnUnsupported, disabled: true, type: 'unsupported' };

  return {
    caseId: check.case_id || '',
    revision: check.revision ?? 1,
    confirmed: Boolean(check.confirmed),
    confirmedAt: check.confirmed_at || null,
    isSupported,
    ready,
    unsupportedReasons,
    isReversed,
    hasOrientationNotice,
    orientationNote,
    orientation,
    teeth,
    fdiTeeth,
    missing,
    fdiMissing,
    outside,
    fdiOutside,
    crowding_mm: typeof check.crowding_mm === 'number' ? check.crowding_mm : 0,
    scannedGingiva: Boolean(check.scanned_gingiva),
    widths,
    rotations,
    verticals,
    primaryAction,
    showDelete: !isSupported
  };
}

export function parsePatientAndScanId(caseId) {
  return parsePatientCaseId(caseId) || { pid: '', sid: '' };
}

export function formatBasis(basis) {
  return CHECK_VOCAB.bases[basis] || basis || CHECK_VOCAB.unspecified;
}

export function formatRotationSummary(rotations) {
  if (!Array.isArray(rotations) || rotations.length === 0) {
    return CHECK_VOCAB.noRotationNeeded;
  }
  return rotations
    .map((r) => `${CHECK_VOCAB.toothNumber(r.fdi)} ${r.deg > 0 ? '+' : ''}${r.deg}°`)
    .join(', ');
}

export function formatVerticalSummary(verticals) {
  if (!Array.isArray(verticals) || verticals.length === 0) {
    return CHECK_VOCAB.noVerticalNeeded;
  }
  return verticals
    .map((v) => `${CHECK_VOCAB.toothNumber(v.fdi)} ${v.mm > 0 ? CHECK_VOCAB.occlusalSide : CHECK_VOCAB.gingivalSide} ${Math.abs(v.mm)}mm`)
    .join(', ');
}

export function formatOrientationSummary(orientation) {
  if (!orientation || typeof orientation !== 'object') {
    return CHECK_VOCAB.unspecified;
  }
  const basis = formatBasis(orientation.basis);
  const rot = orientation.rotation_deg ? CHECK_VOCAB.rotationSuffix(orientation.rotation_deg) : '';
  const renum = orientation.renumbered ? CHECK_VOCAB.renumberedSuffix : '';
  return `${basis}${rot}${renum}`;
}
