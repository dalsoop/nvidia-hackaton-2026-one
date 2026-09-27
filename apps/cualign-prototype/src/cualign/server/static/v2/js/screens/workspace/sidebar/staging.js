// Staging chart and panel for workspace right sidebar (S1 contract)

import { clear, h } from '../../../ui/dom.js';
import { fdiToUniversal, universalToFdi } from '../../../domain/teeth.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';
import { buildStagingModel, STANDARD_FDI_TEETH, MOVE_TYPE_HEX } from '../../../domain/staging-model.js';
import { planStageIndex, selectViewingPlan, planId } from './plan-state.js';

export const STRATEGY_KO = SIDEBAR_VOCAB.staging.strategies;

/**
 * Return FDI columns present in plan or standard FDI arch teeth.
 */
export function getFdiColumnsForPlan(plan = null) {
  if (!plan || !plan.stages || !plan.stages[0]) {
    return [...STANDARD_FDI_TEETH];
  }

  const presentUniversal = new Set();
  for (const st of plan.stages) {
    if (st && typeof st === 'object') {
      for (const k of Object.keys(st)) {
        const u = Number(k);
        if (Number.isInteger(u)) {
          presentUniversal.add(u);
        }
      }
    }
  }

  const presentFdi = [...presentUniversal].map(u => universalToFdi(u)).filter(n => n !== null);
  if (presentFdi.length === 0) {
    return [...STANDARD_FDI_TEETH];
  }

  return presentFdi.sort((a, b) => {
    const qA = Math.floor(a / 10);
    const qB = Math.floor(b / 10);
    if (qA !== qB) return qA - qB;
    if (qA === 1) return b - a; // 18 down to 11
    return a - b; // 21 up to 28
  });
}

/**
 * Legacy helper for tooth movement info (backward compatibility).
 */
export function getToothMovementInfo(plan, stageIdx, uTooth) {
  if (!plan || stageIdx <= 0) {
    return { kind: 'idle', linearMm: 0, rotDeg: 0 };
  }

  const uStr = String(uTooth);
  const lockedTeeth = plan.constraints?.lock || [];
  if (lockedTeeth.includes(uTooth) || lockedTeeth.includes(uStr)) {
    return { kind: 'locked', linearMm: 0, rotDeg: 0 };
  }

  const removedTeeth = plan.target?.removed || [];
  if (removedTeeth.includes(uTooth) || removedTeeth.includes(uStr)) {
    return { kind: 'extracted', linearMm: 0, rotDeg: 0 };
  }

  const currentDisp = plan.stages?.[stageIdx - 1]?.[uTooth] || plan.stages?.[stageIdx - 1]?.[uStr] || [0, 0, 0];
  const prevDisp = stageIdx > 1
    ? (plan.stages?.[stageIdx - 2]?.[uTooth] || plan.stages?.[stageIdx - 2]?.[uStr] || [0, 0, 0])
    : [0, 0, 0];

  const dx = currentDisp[0] - prevDisp[0];
  const dy = currentDisp[1] - prevDisp[1];
  const dz = currentDisp[2] - prevDisp[2];
  const linearMm = Math.hypot(dx, dy, dz);

  const curRot = plan.rotations?.[stageIdx - 1]?.[uTooth] ?? plan.rotations?.[stageIdx - 1]?.[uStr] ?? 0;
  const prevRot = stageIdx > 1
    ? (plan.rotations?.[stageIdx - 2]?.[uTooth] ?? plan.rotations?.[stageIdx - 2]?.[uStr] ?? 0)
    : 0;
  const rotDeg = Math.abs(curRot - prevRot);

  if (rotDeg >= 0.5) {
    return { kind: 'rot', linearMm, rotDeg };
  }
  if (Math.abs(dz) >= 0.08) {
    return { kind: 'vert', linearMm, rotDeg };
  }
  if (linearMm >= 0.02) {
    return { kind: 'trans', linearMm, rotDeg };
  }

  return { kind: 'idle', linearMm, rotDeg };
}

/**
 * Check if tooth has collision in a stage.
 */
export function hasToothCollision(plan, stageIdx, uTooth) {
  if (!plan || !Array.isArray(plan.violations) || stageIdx <= 0) {
    return false;
  }
  const uStr = String(uTooth);
  return plan.violations.some(v =>
    Number(v.stage) === stageIdx &&
    v.type === 'collision' &&
    Array.isArray(v.teeth) &&
    (v.teeth.includes(uTooth) || v.teeth.includes(uStr))
  );
}

/**
 * Render the design canvas staging chart panel.
 *
 * @param {HTMLElement} container - Target container
 * @param {Object} ctx - App context
 */
export function renderStaging(container, ctx) {
  clear(container);

  const state = ctx.store.get();
  const currentPlan = selectViewingPlan(state);

  const panelRoot = h('div', { class: 'sidebar-staging-panel' });

  if (!currentPlan || !currentPlan.stages || currentPlan.stages.length === 0) {
    const emptyNotice = h('div', { class: 'sidebar-empty-state' }, [
      h('p', null, SIDEBAR_VOCAB.staging.noPlan)
    ]);
    panelRoot.appendChild(emptyNotice);
    container.appendChild(panelRoot);
    return;
  }

  const model = buildStagingModel(currentPlan);
  const currentStage = Math.max(0, Math.min(model.nStages, planStageIndex(state)));

  // Resolve plan title (e.g. "계획 3" or plan_id prefix)
  const plans = state.plans || [];
  const planIdx = plans.findIndex(p => planId(p) === planId(currentPlan));
  const planTitle = planIdx !== -1 ? `계획 ${planIdx + 1}` : (currentPlan.plan_id ? `계획 ${currentPlan.plan_id.slice(0, 8)}` : '계획');

  // 1. Summary Card (요약 줄 + 이동 내역 한 줄)
  const summarySec = h('div', { class: 'staging-summary-sec' });
  const summaryRow = h('div', { class: 'staging-summary-row' });

  summaryRow.appendChild(h('b', null, planTitle));

  if (model.summary?.strategy) {
    summaryRow.appendChild(h('span', null, [
      '전략 ',
      h('b', null, model.summary.strategy)
    ]));
  }

  summaryRow.appendChild(h('span', null, [
    '총 ',
    h('b', null, model.summary?.totalStagesText || `${model.nStages}장`)
  ]));

  if (model.summary?.maxMovePerStageText) {
    summaryRow.appendChild(h('span', null, [
      '장당 ',
      h('b', null, model.summary.maxMovePerStageText)
    ]));
  }

  if (model.summary?.crowdingSecuredText) {
    summaryRow.appendChild(h('span', null, [
      '총생 ',
      h('b', null, `${model.summary.crowdingMm} mm`),
      ' → 확보 ',
      h('b', null, `${model.summary.securedMm} mm`)
    ]));
  }

  summarySec.appendChild(summaryRow);

  if (model.moveHistoryText) {
    const historyRow = h('div', { class: 'staging-history-row' }, model.moveHistoryText);
    summarySec.appendChild(historyRow);
  }

  panelRoot.appendChild(summarySec);

  // 2. Chart Body
  const chartBody = h('div', { class: 'staging-chart-body' });
  const chartCanvas = h('div', { class: 'staging-chart-canvas' });

  const { rowHeight, topOffset, leftOffset, colWidth, nStages, colLabels } = model;

  // A. FDI Column Labels
  colLabels.forEach((fdi, idx) => {
    const colLeft = leftOffset + idx * colWidth;
    const labelEl = h('div', {
      class: 'staging-col-label',
      style: `left: ${colLeft}px`,
      title: SIDEBAR_VOCAB.staging.toothFdiTitle(fdi)
    }, String(fdi));
    chartCanvas.appendChild(labelEl);
  });

  // B. Horizontal Grid Lines (0..nStages)
  for (let s = 0; s <= nStages; s++) {
    const lineY = topOffset + s * rowHeight;
    const gridLine = h('div', {
      class: 'staging-grid-line',
      style: `top: ${lineY}px`
    });
    chartCanvas.appendChild(gridLine);
  }

  // C. Current Stage Highlight Band & Line
  const currentBandTop = topOffset + currentStage * rowHeight - rowHeight / 2;
  const currentBand = h('div', {
    class: 'staging-current-band',
    style: `top: ${currentBandTop}px; height: ${rowHeight}px`
  });
  chartCanvas.appendChild(currentBand);

  const currentLineTop = topOffset + currentStage * rowHeight - 1;
  const currentLine = h('div', {
    class: 'staging-current-line',
    style: `top: ${currentLineTop}px`
  });
  chartCanvas.appendChild(currentLine);

  // D. Stage Row Labels (0..nStages) and Interactive Click Areas
  for (let s = 0; s <= nStages; s++) {
    const labelTop = topOffset + s * rowHeight - 7;
    const isCurrent = s === currentStage;

    if (!isCurrent) {
      const rowLabel = h('div', {
        class: 'staging-row-label',
        style: `top: ${labelTop}px`,
        onClick: () => {
          ctx.store.set({ stageIndex: s });
        }
      }, String(s));
      chartCanvas.appendChild(rowLabel);
    }

    // Interactive hit box for clicking row to change stage
    const rowHitTop = topOffset + s * rowHeight - rowHeight / 2;
    const rowHit = h('div', {
      class: 'staging-interactive-row',
      style: `top: ${rowHitTop}px; height: ${rowHeight}px`,
      onClick: () => {
        ctx.store.set({ stageIndex: s });
      }
    });
    chartCanvas.appendChild(rowHit);
  }

  // E. Current Stage Green Badge
  const currentBadgeTop = topOffset + currentStage * rowHeight - 7.5;
  const currentBadge = h('div', {
    class: 'staging-current-badge',
    style: `top: ${currentBadgeTop}px`,
    title: `현재 ${currentStage}단계`,
    onClick: () => {
      ctx.store.set({ stageIndex: currentStage });
    }
  }, String(currentStage));
  chartCanvas.appendChild(currentBadge);

  // F. Vertical Movement Bars
  for (const bar of model.bars) {
    const barEl = h('div', {
      class: 'staging-bar',
      style: `left: ${bar.x}px; top: ${bar.y}px; width: ${bar.width}px; height: ${bar.height}px; background: ${bar.color}`,
      title: `${bar.fdi}번 치아 (${bar.moveType}): ${bar.startStage}–${bar.endStage}단계`
    });
    chartCanvas.appendChild(barEl);
  }

  // G. Terminal Dots
  for (const dot of model.dots) {
    const dotEl = h('div', {
      class: 'staging-dot',
      style: `left: ${dot.x}px; top: ${dot.y}px; width: ${dot.size}px; height: ${dot.size}px`
    });
    chartCanvas.appendChild(dotEl);
  }

  // H. Collision Links (Red line connecting adjacent teeth)
  for (const link of model.links) {
    const linkEl = h('div', {
      class: 'staging-link',
      style: `left: ${link.x}px; top: ${link.y}px; width: ${link.width}px; height: ${link.height}px`,
      title: `${link.pair.join('·')} 치아 충돌 (${link.stage}단계)`
    });
    chartCanvas.appendChild(linkEl);
  }

  // I. Collision Rings (Red ring on collision teeth)
  for (const ring of model.rings) {
    const ringEl = h('div', {
      class: 'staging-ring',
      style: `left: ${ring.x}px; top: ${ring.y}px; width: ${ring.size}px; height: ${ring.size}px`,
      title: `${ring.fdi}번 충돌 (${ring.stage}단계)`
    });
    chartCanvas.appendChild(ringEl);
  }

  chartBody.appendChild(chartCanvas);

  // 3. Legend at Bottom
  const legend = h('div', { class: 'staging-legend' }, [
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-swatch', style: `background: ${MOVE_TYPE_HEX.complex}` }),
      SIDEBAR_VOCAB.staging.legendComplex
    ]),
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-swatch', style: `background: ${MOVE_TYPE_HEX.buccolingual}` }),
      SIDEBAR_VOCAB.staging.legendBuccolingual
    ]),
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-swatch', style: `background: ${MOVE_TYPE_HEX.extrusion}` }),
      SIDEBAR_VOCAB.staging.legendExtrusion
    ]),
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-swatch', style: `background: ${MOVE_TYPE_HEX.rotation}` }),
      SIDEBAR_VOCAB.staging.legendRot
    ]),
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-collision' }),
      SIDEBAR_VOCAB.staging.legendCollision
    ])
  ]);

  chartBody.appendChild(legend);
  panelRoot.appendChild(chartBody);

  container.appendChild(panelRoot);
}
