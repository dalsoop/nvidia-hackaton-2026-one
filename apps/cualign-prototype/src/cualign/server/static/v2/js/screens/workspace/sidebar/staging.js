// Staging chart and panel for workspace right sidebar (S1 contract)

import { clear, h } from '../../../ui/dom.js';
import { fdiToUniversal, universalToFdi } from '../../../domain/teeth.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';
import { buildStagingModel, STANDARD_FDI_TEETH } from '../../../domain/staging-model.js';
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

  // Resolve the plan title from its list position or plan ID prefix.
  const plans = state.plans || [];
  const planIdx = plans.findIndex(p => planId(p) === planId(currentPlan));
  const planTitle = planIdx !== -1
    ? SIDEBAR_VOCAB.staging.planLabel(planIdx + 1)
    : (currentPlan.plan_id
      ? SIDEBAR_VOCAB.staging.planLabel(currentPlan.plan_id.slice(0, 8))
      : SIDEBAR_VOCAB.staging.defaultPlanLabel);

  // 1. Summary card and movement history line
  const summarySec = h('div', { class: 'staging-summary-sec' });
  const summaryRow = h('div', { class: 'staging-summary-row' });

  summaryRow.appendChild(h('b', null, planTitle));

  if (model.summary?.strategy) {
    summaryRow.appendChild(h('span', null, [
      `${SIDEBAR_VOCAB.staging.summaryLabels.strategy} `,
      h('b', null, model.summary.strategy)
    ]));
  }

  summaryRow.appendChild(h('span', null, [
    `${SIDEBAR_VOCAB.staging.summaryLabels.total} `,
    h('b', null, model.summary?.totalStagesText || SIDEBAR_VOCAB.staging.summaryLabels.stagesCount(model.nStages))
  ]));

  if (model.summary?.maxMovePerStageText) {
    summaryRow.appendChild(h('span', null, [
      `${SIDEBAR_VOCAB.staging.summaryLabels.perStage} `,
      h('b', null, model.summary.maxMovePerStageText)
    ]));
  }

  if (model.summary?.crowdingSecuredText) {
    summaryRow.appendChild(h('span', null, [
      `${SIDEBAR_VOCAB.staging.summaryLabels.crowding} `,
      h('b', null, `${model.summary.crowdingMm} mm`),
      ` → ${SIDEBAR_VOCAB.staging.summaryLabels.secured} `,
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

  // B. Stage rows (0..nStages). One element per stage owns its grid line, label, current-stage
  // highlight and click area. Rows are laid out in flow and centred on the model's stage y
  // (topOffset + s * rowHeight), so they cannot drift from the bars, dots and rings drawn below.
  chartCanvas.style.setProperty('--staging-row-h', `${rowHeight}px`);
  chartCanvas.style.setProperty('--staging-rows-top', `${topOffset - rowHeight / 2}px`);
  const rowsEl = h('div', { class: 'staging-rows' });
  for (let s = 0; s <= nStages; s++) {
    const isCurrent = s === currentStage;
    const row = h('div', {
      class: isCurrent ? 'staging-row is-current' : 'staging-row',
      title: isCurrent ? SIDEBAR_VOCAB.staging.currentStageTitle(s) : null,
      onClick: () => {
        ctx.store.set({ stageIndex: s });
      }
    }, h('span', { class: 'staging-row-label' }, String(s)));
    rowsEl.appendChild(row);
  }
  chartCanvas.appendChild(rowsEl);

  // F. Vertical Movement Bars
  for (const bar of model.bars) {
    const barEl = h('div', {
      class: `staging-bar move-${bar.moveTypeKey || 'complex'}`,
      style: `left: ${bar.x}px; top: ${bar.y}px; width: ${bar.width}px; height: ${bar.height}px`,
      title: SIDEBAR_VOCAB.staging.movementBarTitle(bar)
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
      title: SIDEBAR_VOCAB.staging.collisionLinkTitle(link.pair, link.stage)
    });
    chartCanvas.appendChild(linkEl);
  }

  // I. Collision Rings (Red ring on collision teeth)
  for (const ring of model.rings) {
    const ringEl = h('div', {
      class: 'staging-ring',
      style: `left: ${ring.x}px; top: ${ring.y}px; width: ${ring.size}px; height: ${ring.size}px`,
      title: SIDEBAR_VOCAB.staging.collisionRingTitle(ring.fdi, ring.stage)
    });
    chartCanvas.appendChild(ringEl);
  }

  chartBody.appendChild(chartCanvas);

  // 3. Legend at Bottom
  const legend = h('div', { class: 'staging-legend' }, [
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-swatch move-complex' }),
      SIDEBAR_VOCAB.staging.legendComplex
    ]),
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-swatch move-buccolingual' }),
      SIDEBAR_VOCAB.staging.legendBuccolingual
    ]),
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-swatch move-extrusion' }),
      SIDEBAR_VOCAB.staging.legendExtrusion
    ]),
    h('span', { class: 'staging-legend-item' }, [
      h('span', { class: 'staging-legend-swatch move-rotation' }),
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
