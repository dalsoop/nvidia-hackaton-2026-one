// Pure calculations for 3D viewer (pose synthesis, violations, slider ticks, IPR)
// No Three.js dependency — fully testable in node

/**
 * Tooth pose calculation with pivot rotation:
 * Crown turns about its vertical axis through centroid c:
 * v' = R(v - c) + c + d => position = d + c - R c
 *
 * @param {number[]} translation [dx, dy, dz]
 * @param {number[]} pivot [cx, cy, cz]
 * @param {number} rotationDeg rotation angle around z-axis in degrees
 * @returns {{ position: [number, number, number], rotation: [number, number, number], rotationDeg: number }}
 */
export function calculateToothPosition(translation = [0, 0, 0], pivot = [0, 0, 0], rotationDeg = 0) {
  const d = translation ?? [0, 0, 0];
  const c = pivot ?? [0, 0, 0];
  const deg = rotationDeg ?? 0;
  const a = (deg * Math.PI) / 180;

  const cosA = Math.cos(a);
  const sinA = Math.sin(a);

  // R * c for z-axis rotation
  const rcX = cosA * c[0] - sinA * c[1];
  const rcY = sinA * c[0] + cosA * c[1];

  const posX = d[0] + c[0] - rcX;
  const posY = d[1] + c[1] - rcY;
  const posZ = d[2]; // c[2] - c[2] cancels out

  return {
    position: [posX, posY, posZ],
    rotation: [0, 0, a],
    rotationDeg: deg
  };
}

/**
 * Filter violations for a specific stage and index by tooth ID.
 *
 * @param {Array<{ stage?: number, type: string, teeth?: Array<number|string>, overlap_mm3?: number }>} violations
 * @param {number} stage
 * @returns {{ byTooth: Record<string, Set<string>>, list: Array<any>, collisionCount: number, moveLimitCount: number }}
 */
export function getViolationsAtStage(violations = [], stage = 0) {
  const byTooth = {};
  const list = [];
  let collisionCount = 0;
  let moveLimitCount = 0;

  for (const v of violations || []) {
    if (v.stage !== stage) continue;
    list.push(v);

    if (v.type === 'collision') collisionCount++;
    if (v.type === 'move_limit') moveLimitCount++;

    if (Array.isArray(v.teeth)) {
      for (const t of v.teeth) {
        const id = String(t);
        if (!byTooth[id]) byTooth[id] = new Set();
        byTooth[id].add(v.type);
      }
    }
  }

  return { byTooth, list, collisionCount, moveLimitCount };
}

/**
 * Group violations by stage for slider tick marks.
 *
 * @param {Array<{ stage?: number, type: string, teeth?: any[] }>} violations
 * @returns {Record<number, { collision: number, move_limit: number, total: number }>}
 */
export function getStageViolationsSummary(violations = []) {
  const summary = {};

  for (const v of violations || []) {
    if (v.stage == null || !['collision', 'move_limit'].includes(v.type)) continue;
    const stage = Number(v.stage);
    if (!summary[stage]) {
      summary[stage] = { collision: 0, move_limit: 0, total: 0 };
    }
    summary[stage][v.type] = (summary[stage][v.type] || 0) + 1;
    summary[stage].total += 1;
  }

  return summary;
}

/**
 * Calculate slider position percentage for a stage.
 *
 * @param {number} stage
 * @param {number} totalStages
 * @returns {number} 0 to 100 percentage
 */
export function calculateTickPosition(stage = 0, totalStages = 0) {
  if (!totalStages || totalStages <= 0) return 0;
  const clamped = Math.max(0, Math.min(totalStages, stage));
  return (clamped / totalStages) * 100;
}

/**
 * Calculate max cumulative movement across all teeth at final stage.
 *
 * @param {Array<Record<string, number[]>>} stages
 * @returns {number}
 */
export function calculateMaxMovement(stages = []) {
  if (!stages || stages.length === 0) return 1e-6;
  const lastStage = stages[stages.length - 1] || {};
  const moves = Object.values(lastStage).map((d) => {
    if (!Array.isArray(d)) return 0;
    return Math.hypot(d[0] || 0, d[1] || 0, d[2] || 0);
  });
  return Math.max(1e-6, ...moves);
}

/**
 * Calculate movement heat ratio (0 to 0.75).
 *
 * @param {number} displacement
 * @param {number} maxDisplacement
 * @returns {number}
 */
export function calculateMovementHeat(displacement = 0, maxDisplacement = 1e-6) {
  if (maxDisplacement <= 0) return 0;
  return Math.min(1, displacement / maxDisplacement) * 0.75;
}

/**
 * Calculate IPR contact values along the arch order.
 *
 * @param {string[]} archOrder
 * @param {{ ipr_mm_per_surface?: number, ipr_exclude?: Array<string|number>, removed?: Array<string|number> }} target
 * @returns {Array<{ a: string, b: string, mm: number }>}
 */
export function calculateIprContacts(archOrder = [], target = {}) {
  const per = target?.ipr_mm_per_surface ?? 0;
  if (!per) return [];

  const excl = new Set((target?.ipr_exclude ?? []).map(String));
  const removed = new Set((target?.removed ?? []).map(String));
  const order = (archOrder || []).filter((id) => !removed.has(String(id)));

  const contacts = [];
  for (let k = 0; k + 1 < order.length; k++) {
    const a = String(order[k]);
    const b = String(order[k + 1]);
    const mm = per * 0.5 * ((excl.has(a) ? 0 : 1) + (excl.has(b) ? 0 : 1));
    if (mm > 0) {
      contacts.push({ a, b, mm: Number(mm.toFixed(2)) });
    }
  }

  return contacts;
}

/**
 * Pure calculation of camera position and up vector for a specified view.
 *
 * @param {object} params
 * @param {string} params.kind 'occlusal' | 'frontal' | 'back' | 'left' | 'right' | 'base'
 * @param {[number, number, number]} params.center
 * @param {[number, number, number]} params.size
 * @param {number} [params.fov=35]
 * @returns {{ position: [number, number, number], up: [number, number, number], target: [number, number, number] }}
 */
export function calculateViewCamera({ kind = 'occlusal', center = [0, 0, 0], size = [1, 1, 1], fov = 35 }) {
  const maxDim = Math.max(size[0], size[1], size[2], 1);
  const dist = (maxDim / (2 * Math.tan((fov * Math.PI) / 360))) * 1.25;
  const [cx, cy, cz] = center;
  const szZ = size[2];

  let position = [cx, cy, cz + dist];
  let up = [0, 1, 0];

  switch (kind) {
    case 'frontal':
      // look from anterior (+y); crowns hang down
      up = [0, 0, -1];
      position = [cx, cy + dist, cz - szZ * 0.3];
      break;
    case 'back':
      // look from palate side (-y)
      up = [0, 0, -1];
      position = [cx, cy - dist, cz - szZ * 0.3];
      break;
    case 'left':
      // patient's left (+x)
      up = [0, 0, -1];
      position = [cx + dist, cy, cz - szZ * 0.3];
      break;
    case 'right':
      // patient's right (-x)
      up = [0, 0, -1];
      position = [cx - dist, cy, cz - szZ * 0.3];
      break;
    case 'base':
      // from above base
      up = [0, 1, 0];
      position = [cx, cy, cz - dist];
      break;
    case 'occlusal':
    default:
      // looking down -z
      up = [0, 1, 0];
      position = [cx, cy, cz + dist];
      break;
  }

  return {
    position,
    up,
    target: [cx, cy, cz]
  };
}

/**
 * Convert normalized device coordinates (NDC [-1..1]) to screen pixel coordinates.
 *
 * @param {number} ndcX
 * @param {number} ndcY
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number }}
 */
export function projectNormalizedToScreen(ndcX = 0, ndcY = 0, width = 0, height = 0) {
  const x = (ndcX * 0.5 + 0.5) * width;
  const y = (-(ndcY * 0.5) + 0.5) * height;
  return { x, y };
}

