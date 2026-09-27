import { universalToFdi } from '../../../domain/teeth.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';

export const VIOLATION_LABELS = SIDEBAR_VOCAB.rules.violations;

function recordStage(entry, value) {
  const stage = Number(value);
  if (Number.isInteger(stage) && !entry.stages.includes(stage)) {
    entry.stages.push(stage);
    entry.stages.sort((a, b) => a - b);
  }
}

export function groupViolations(violations = []) {
  if (!Array.isArray(violations)) {
    const empty = [];
    empty.byType = {};
    empty.total = 0;
    return empty;
  }

  const typeMap = new Map();
  for (const violation of violations) {
    if (!violation || typeof violation !== 'object') continue;
    const type = violation.type || 'unknown';
    if (!typeMap.has(type)) {
      typeMap.set(type, {
        type,
        label: VIOLATION_LABELS[type] || type,
        count: 0,
        pairs: [],
        byTooth: [],
        general: [],
        items: []
      });
    }
    const group = typeMap.get(type);
    group.count += 1;
    group.items.push(violation);
    const teeth = Array.isArray(violation.teeth)
      ? violation.teeth.map(Number).filter(Number.isInteger)
      : [];

    if (teeth.length >= 2) {
      const sortedTeeth = [...teeth].sort((a, b) => a - b);
      const pairKey = sortedTeeth.join('-');
      let entry = group.pairs.find((pair) => pair.pairKey === pairKey);
      if (!entry) {
        entry = {
          pairKey,
          teeth: sortedTeeth,
          fdiTeeth: sortedTeeth.map(universalToFdi).filter((tooth) => tooth !== null),
          count: 0,
          stages: [],
          maxOverlap: 0,
          items: []
        };
        group.pairs.push(entry);
      }
      entry.count += 1;
      entry.items.push(violation);
      if (violation.stage != null) recordStage(entry, violation.stage);
      entry.maxOverlap = Math.max(entry.maxOverlap, Number(violation.overlap_mm3) || 0);
    } else if (teeth.length === 1) {
      const tooth = teeth[0];
      let entry = group.byTooth.find((item) => item.tooth === tooth);
      if (!entry) {
        entry = { tooth, fdiTooth: universalToFdi(tooth), count: 0, stages: [], items: [] };
        group.byTooth.push(entry);
      }
      entry.count += 1;
      entry.items.push(violation);
      if (violation.stage != null) recordStage(entry, violation.stage);
    } else {
      group.general.push(violation);
    }
  }

  const result = [...typeMap.values()];
  result.byType = Object.fromEntries(result.map((group) => [group.type, group]));
  result.total = violations.length;
  return result;
}
