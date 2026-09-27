// Pure domain model for staging table and tooth movement analysis (S1 contract)

import { universalToFdi, fdiToUniversal } from './teeth.js';
import { SIDEBAR_VOCAB } from './vocab/sidebar.js';

export const STANDARD_FDI_TEETH = Object.freeze([
  17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27
]);

export const MOVE_TYPE_COLORS = Object.freeze({
  complex: 'var(--color-move-complex, #8a93a6)',
  buccolingual: 'var(--color-move-buccolingual, #3ec5f0)',
  extrusion: 'var(--color-move-extrusion, #b58bff)',
  rotation: 'var(--color-move-rotation, #f06fb0)',
  parallel: 'var(--color-move-parallel, #76b900)'
});

export const MOVE_TYPE_HEX = Object.freeze({
  complex: '#8a93a6',
  buccolingual: '#3ec5f0',
  extrusion: '#b58bff',
  rotation: '#f06fb0',
  parallel: '#76b900'
});

/**
 * Determine tooth movement classification.
 *
 * @param {number} fdi - FDI tooth number
 * @param {number} dx - Final displacement X in mm
 * @param {number} dy - Final displacement Y in mm
 * @param {number} dz - Final displacement Z in mm
 * @param {number} rotDeg - Final rotation in degrees
 * @returns {{ moveType: string, moveTypeKey: string }}
 */
export function classifyToothMove(fdi, dx, dy, dz, rotDeg) {
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const absDz = Math.abs(dz);
  const absRot = Math.abs(rotDeg);
  const totalLinear = Math.hypot(dx, dy, dz);

  if (totalLinear < 0.01 && absRot < 0.1) {
    return { moveType: null, moveTypeKey: null };
  }

  // Molars (17, 16, 26, 27) act as anchor/complex movement base
  const isMolar = [17, 16, 26, 27].includes(fdi);
  if (isMolar) {
    return { moveType: '복합', moveTypeKey: 'complex' };
  }

  // Significant rotation (dominant)
  if (absRot >= 5.0 && absRot > totalLinear * 3) {
    return { moveType: '회전', moveTypeKey: 'rotation' };
  }

  // Buccolingual displacement (check if dominant over vertical)
  const isAnterior = [11, 12, 21, 22].includes(fdi);
  const blMove = isAnterior ? absDy : absDx;

  // Significant extrusion/intrusion (vertical z displacement dominant)
  if (absDz >= 0.8 && absDz > blMove) {
    return { moveType: '정출함입', moveTypeKey: 'extrusion' };
  }

  if (blMove >= 0.1) {
    return { moveType: '협설', moveTypeKey: 'buccolingual' };
  }

  if (absRot >= 3.0) {
    return { moveType: '회전', moveTypeKey: 'rotation' };
  }

  if (absDz >= 0.4) {
    return { moveType: '정출함입', moveTypeKey: 'extrusion' };
  }

  // Parallel / simple translation
  return { moveType: '평행', moveTypeKey: 'parallel' };
}

/**
 * Build pure staging model from server plan json.
 *
 * @param {Object} planJson - Server plan object
 * @returns {Object} Staging model containing teeth, collisions, summary, moveHistoryText, and render geometry
 */
export function buildStagingModel(planJson = null) {
  const colLabels = [...STANDARD_FDI_TEETH];

  if (!planJson || typeof planJson !== 'object') {
    return {
      colLabels,
      rowLabels: [0],
      nStages: 0,
      teeth: {},
      collisions: [],
      summary: null,
      moveHistoryText: '',
      bars: [],
      dots: [],
      links: [],
      rings: []
    };
  }

  const stages = Array.isArray(planJson.stages) ? planJson.stages : [];
  const rotations = Array.isArray(planJson.rotations) ? planJson.rotations : [];
  const violations = Array.isArray(planJson.violations) ? planJson.violations : [];
  const info = planJson.info && typeof planJson.info === 'object' ? planJson.info : {};

  const nStages = stages.length > 0 ? stages.length : (info.n_stages ?? 0);
  const rowLabels = Array.from({ length: nStages + 1 }, (_, i) => i);

  // 1. Tooth Movement Analysis
  const teeth = {};
  const moveDetails = [];
  let maxArchExpansion = 0;

  for (const fdi of colLabels) {
    const u = fdiToUniversal(fdi);
    if (u === null) continue;

    const uKey = String(u);

    // Extract per-stage displacements and rotations
    let startStage = null;
    let endStage = null;

    for (let s = 1; s <= nStages; s++) {
      const curDisp = stages[s - 1]?.[uKey] || stages[s - 1]?.[u] || [0, 0, 0];
      const prevDisp = s > 1 ? (stages[s - 2]?.[uKey] || stages[s - 2]?.[u] || [0, 0, 0]) : [0, 0, 0];
      const stepMm = Math.hypot(curDisp[0] - prevDisp[0], curDisp[1] - prevDisp[1], curDisp[2] - prevDisp[2]);

      const curRot = rotations[s - 1]?.[uKey] ?? rotations[s - 1]?.[u] ?? 0;
      const prevRot = s > 1 ? (rotations[s - 2]?.[uKey] ?? rotations[s - 2]?.[u] ?? 0) : 0;
      const stepRot = Math.abs(curRot - prevRot);

      if (stepMm > 0.005 || stepRot > 0.05) {
        if (startStage === null) {
          startStage = s;
        }
        endStage = s;
      }
    }

    // Final displacement and rotation
    const lastDisp = nStages > 0 ? (stages[nStages - 1]?.[uKey] || stages[nStages - 1]?.[u] || [0, 0, 0]) : [0, 0, 0];
    const dx = Number(lastDisp[0] ?? 0);
    const dy = Number(lastDisp[1] ?? 0);
    const dz = Number(lastDisp[2] ?? 0);
    const totalMoveMm = Math.hypot(dx, dy, dz);

    const rotDeg = nStages > 0 ? Number(rotations[nStages - 1]?.[uKey] ?? rotations[nStages - 1]?.[u] ?? 0) : 0;

    const { moveType, moveTypeKey } = classifyToothMove(fdi, dx, dy, dz, rotDeg);

    // Check molar arch expansion on X axis
    if ([16, 17, 26, 27].includes(fdi)) {
      if (Math.abs(dx) > maxArchExpansion) {
        maxArchExpansion = Math.abs(dx);
      }
    }

    // Collect notable movement features for history line
    if (Math.abs(rotDeg) >= 2.0) {
      const sign = rotDeg < 0 ? '−' : '+';
      moveDetails.push({
        fdi,
        text: `${fdi} 회전 ${sign}${Math.abs(rotDeg).toFixed(1)}°`
      });
    } else if (Math.abs(dz) >= 0.8) {
      const sign = dz < 0 ? '−' : '+';
      moveDetails.push({
        fdi,
        text: `${fdi} 수직 ${sign}${Math.abs(dz).toFixed(1)}mm`
      });
    }

    teeth[fdi] = {
      fdi,
      universal: u,
      startStage,
      endStage,
      moveType,
      moveTypeKey,
      totalMoveMm: Number(totalMoveMm.toFixed(3)),
      linearMm: Number(totalMoveMm.toFixed(3)),
      rotDeg: Number(rotDeg.toFixed(2)),
      dx: Number(dx.toFixed(4)),
      dy: Number(dy.toFixed(4)),
      dz: Number(dz.toFixed(4))
    };
  }

  // 2. Collision Analysis
  const collisionMap = new Map();
  for (const v of violations) {
    if (v.type === 'collision' && Array.isArray(v.teeth) && v.teeth.length >= 2) {
      const fdi1 = universalToFdi(v.teeth[0]);
      const fdi2 = universalToFdi(v.teeth[1]);
      if (fdi1 !== null && fdi2 !== null) {
        const sortedPair = [Math.min(fdi1, fdi2), Math.max(fdi1, fdi2)];
        const pairKey = sortedPair.join('-');

        if (!collisionMap.has(pairKey)) {
          collisionMap.set(pairKey, {
            teeth: sortedPair,
            stages: new Set(),
            maxOverlap: 0,
            baseline: v.baseline ?? 0.23
          });
        }

        const entry = collisionMap.get(pairKey);
        if (v.stage != null) {
          entry.stages.add(Number(v.stage));
        }
        if (v.overlap_mm3 != null && v.overlap_mm3 > entry.maxOverlap) {
          entry.maxOverlap = v.overlap_mm3;
        }
      }
    }
  }

  const collisions = Array.from(collisionMap.values()).map(c => ({
    teeth: c.teeth,
    stages: Array.from(c.stages).sort((a, b) => a - b),
    overlapMm3: c.maxOverlap,
    baseline: c.baseline
  }));

  // 3. Summary (Only include fields that exist on server)
  const strategyRaw = planJson.strategy || '';
  const strategyKo = SIDEBAR_VOCAB.staging.strategies[strategyRaw] || strategyRaw || '전략';

  const maxMovePerStageMm = info.per_stage_mm != null ? Number(info.per_stage_mm) : null;
  const maxMovePerStageText = maxMovePerStageMm != null ? `${maxMovePerStageMm} mm` : null;

  const crowdingMm = info.crowding_mm != null ? Number(info.crowding_mm) : (planJson.crowding_mm != null ? Number(planJson.crowding_mm) : null);
  const securedMm = info.secured_mm != null ? Number(info.secured_mm) : null;
  const crowdingSecuredText = (crowdingMm != null && securedMm != null)
    ? `총생 ${crowdingMm} mm → 확보 ${securedMm} mm`
    : null;

  const summary = {
    strategy: strategyKo,
    totalStages: nStages,
    totalStagesText: `${nStages}장`,
    maxMovePerStageMm,
    maxMovePerStageText,
    crowdingMm,
    securedMm,
    crowdingSecuredText
  };

  // 4. Move History Line (이동 내역 한 줄)
  const historyParts = [];
  if (maxArchExpansion >= 0.3) {
    historyParts.push(`악궁 편측 ${maxArchExpansion.toFixed(1)}mm 확장`);
  }
  for (const item of moveDetails) {
    historyParts.push(item.text);
  }
  const moveHistoryText = historyParts.join(' · ');

  // 5. Geometry calculation for 400px sidebar without vertical scroll up to 18 stages
  const leftOffset = 30;
  const colWidth = 24;
  const topOffset = 52.5;

  // Row height adaptively calculated: 25px for 18 stages fits neatly in ~450px
  let rowHeight = 25;
  if (nStages > 18) {
    rowHeight = Math.max(16, Math.floor(450 / nStages));
  } else if (nStages > 0 && nStages < 10) {
    rowHeight = Math.min(36, Math.max(25, Math.floor(400 / nStages)));
  }

  const bars = [];
  const dots = [];

  colLabels.forEach((fdi, colIdx) => {
    const t = teeth[fdi];
    if (!t) return;

    const sStart = t.startStage ?? 1;
    const sEnd = t.endStage ?? nStages;

    if (t.moveTypeKey && sEnd >= sStart && nStages > 0) {
      const barX = leftOffset + colIdx * colWidth + 10;
      const barY = topOffset + sStart * rowHeight;
      const barH = Math.max(2, (sEnd - sStart) * rowHeight);

      bars.push({
        fdi,
        startStage: sStart,
        endStage: sEnd,
        moveType: t.moveType,
        moveTypeKey: t.moveTypeKey,
        color: MOVE_TYPE_HEX[t.moveTypeKey] || '#8a93a6',
        x: barX,
        y: barY,
        width: 4,
        height: barH
      });

      // Start and end dots
      dots.push({
        fdi,
        stage: sStart,
        x: leftOffset + colIdx * colWidth + 8,
        y: topOffset + sStart * rowHeight - 4,
        size: 8
      });

      dots.push({
        fdi,
        stage: sEnd,
        x: leftOffset + colIdx * colWidth + 8,
        y: topOffset + sEnd * rowHeight - 4,
        size: 8
      });
    }
  });

  // Collision links and rings
  const links = [];
  const rings = [];

  for (const c of collisions) {
    const [fdiA, fdiB] = c.teeth;
    const idxA = colLabels.indexOf(fdiA);
    const idxB = colLabels.indexOf(fdiB);

    if (idxA !== -1 && idxB !== -1) {
      const minCol = Math.min(idxA, idxB);
      const isNeighbor = Math.abs(idxA - idxB) === 1;

      for (const st of c.stages) {
        if (st <= nStages) {
          const stageY = topOffset + st * rowHeight;

          if (isNeighbor) {
            links.push({
              pair: [fdiA, fdiB],
              stage: st,
              x: leftOffset + minCol * colWidth + 18,
              y: stageY - 1.25,
              width: 24,
              height: 2.5
            });
          }

          rings.push({
            fdi: fdiA,
            stage: st,
            x: leftOffset + idxA * colWidth + 13,
            y: stageY - 5,
            size: 10
          });

          rings.push({
            fdi: fdiB,
            stage: st,
            x: leftOffset + idxB * colWidth + 13,
            y: stageY - 5,
            size: 10
          });
        }
      }
    }
  }

  return {
    colLabels,
    rowLabels,
    nStages,
    teeth,
    collisions,
    summary,
    moveHistoryText,
    rowHeight,
    topOffset,
    leftOffset,
    colWidth,
    bars,
    dots,
    links,
    rings
  };
}
