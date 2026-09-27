// Teeth numbering domain utilities: Universal (1..16) and FDI (11..28) for maxillary arch

export const UPPER_UNIVERSAL = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
]);

const UNIVERSAL_TO_FDI_MAP = Object.freeze({
  1: 18,
  2: 17,
  3: 16,
  4: 15,
  5: 14,
  6: 13,
  7: 12,
  8: 11,
  9: 21,
  10: 22,
  11: 23,
  12: 24,
  13: 25,
  14: 26,
  15: 27,
  16: 28
});

const FDI_TO_UNIVERSAL_MAP = Object.freeze({
  18: 1,
  17: 2,
  16: 3,
  15: 4,
  14: 5,
  13: 6,
  12: 7,
  11: 8,
  21: 9,
  22: 10,
  23: 11,
  24: 12,
  25: 13,
  26: 14,
  27: 15,
  28: 16
});

function parseToothNumber(val) {
  if (typeof val === 'number') {
    return Number.isInteger(val) ? val : null;
  }
  if (typeof val === 'string') {
    const cleaned = val.replace(/\.stl$/i, '').trim();
    const num = Number(cleaned);
    return Number.isInteger(num) && cleaned !== '' ? num : null;
  }
  return null;
}

export function universalToFdi(n) {
  const parsed = parseToothNumber(n);
  if (parsed === null) {
    return null;
  }
  return UNIVERSAL_TO_FDI_MAP[parsed] ?? null;
}

export function fdiToUniversal(n) {
  const parsed = parseToothNumber(n);
  if (parsed === null) {
    return null;
  }
  return FDI_TO_UNIVERSAL_MAP[parsed] ?? null;
}
