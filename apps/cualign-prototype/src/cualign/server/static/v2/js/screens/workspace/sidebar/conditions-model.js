import { fdiToUniversal } from '../../../domain/teeth.js';

export const DEFAULT_CONSTRAINTS = Object.freeze({
  allow_extraction: false,
  lock: [],
  ipr_exclude: [],
  ipr_limit_mm: 0.25,
  stage_cap: null,
  order: 'simultaneous'
});

export function normalizeToothList(teeth) {
  const rawItems = typeof teeth === 'string'
    ? teeth.split(/[, \s]+/).filter(Boolean)
    : (Array.isArray(teeth) ? teeth : []);
  const result = rawItems
    .map(Number)
    .filter(Number.isInteger)
    .map(fdiToUniversal)
    .filter((tooth) => tooth !== null && tooth >= 2 && tooth <= 15);
  return [...new Set(result)].sort((a, b) => a - b);
}

function normalizeConstraintTeeth(teeth) {
  if (typeof teeth === 'string') return normalizeToothList(teeth);
  if (!Array.isArray(teeth)) return [];
  return [...new Set(teeth.map(Number).filter((n) => Number.isInteger(n) && n >= 2 && n <= 15))]
    .sort((a, b) => a - b);
}

function areTeethEqual(a, b) {
  const normalizedA = normalizeConstraintTeeth(a);
  const normalizedB = normalizeConstraintTeeth(b);
  return normalizedA.length === normalizedB.length
    && normalizedA.every((value, index) => value === normalizedB[index]);
}

export function calculateConditionDiff(current = {}, base = null) {
  const diff = {};
  const original = base || DEFAULT_CONSTRAINTS;

  if (current.allow_extraction != null && Boolean(current.allow_extraction) !== Boolean(original.allow_extraction)) {
    diff.allow_extraction = Boolean(current.allow_extraction);
  }
  for (const key of ['lock', 'ipr_exclude']) {
    if (current[key] != null && !areTeethEqual(current[key], original[key])) {
      diff[key] = normalizeConstraintTeeth(current[key]);
    }
  }
  if (current.ipr_limit_mm != null && current.ipr_limit_mm !== '') {
    const value = Math.min(0.25, Math.max(0, Number(current.ipr_limit_mm)));
    const originalValue = original.ipr_limit_mm == null ? 0.25 : Number(original.ipr_limit_mm);
    if (Math.abs(value - originalValue) > 1e-6) diff.ipr_limit_mm = value;
  }
  if (current.clear_stage_cap === true) {
    if (original.stage_cap != null) diff.clear_stage_cap = true;
  } else if (current.stage_cap !== undefined) {
    const value = current.stage_cap === '' || current.stage_cap === null ? null : Number(current.stage_cap);
    const originalValue = original.stage_cap === '' || original.stage_cap === null ? null : Number(original.stage_cap);
    if (value !== originalValue) {
      if (value === null) diff.clear_stage_cap = true;
      else diff.stage_cap = value;
    }
  }
  if (current.order != null) {
    const value = String(current.order);
    if (value !== String(original.order || 'simultaneous')) diff.order = value;
  }
  return diff;
}
