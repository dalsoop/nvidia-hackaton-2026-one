// Staging table for workspace right sidebar (J8 contract)

import { clear, h } from '../../../ui/dom.js';
import { fdiToUniversal, universalToFdi } from '../../../domain/teeth.js';
import { T } from '../../../domain/vocab.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';
import { planStageIndex, selectViewingPlan, violationCount } from './plan-state.js';

export const STRATEGY_KO = SIDEBAR_VOCAB.staging.strategies;

export function getFdiColumnsForPlan(plan = null) {
  const standardFdi = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27];

  if (!plan || !plan.stages || !plan.stages[0]) {
    return standardFdi;
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
    return standardFdi;
  }

  // Dental order sorting:
  // Q1 (18..11 descending) -> Q2 (21..28 ascending)
  return presentFdi.sort((a, b) => {
    const qA = Math.floor(a / 10);
    const qB = Math.floor(b / 10);
    if (qA !== qB) return qA - qB;
    if (qA === 1) return b - a; // 18 down to 11
    return a - b; // 21 up to 28
  });
}

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
 * Render the staging table panel.
 *
 * @param {HTMLElement} container - Target container
 * @param {Object} ctx - App context
 */
export function renderStaging(container, ctx) {
  // Save previous scroll positions if table already rendered
  const prevWrap = container.querySelector('.staging-table-wrap');
  const prevScrollTop = prevWrap ? prevWrap.scrollTop : null;
  const prevScrollLeft = prevWrap ? prevWrap.scrollLeft : null;

  clear(container);

  const state = ctx.store.get();
  const currentPlan = selectViewingPlan(state);

  const panelRoot = h('div', { class: 'sidebar-staging-panel' });

  // 1. Plan summary bar
  const summaryBar = renderPlanSummaryBar(currentPlan);
  panelRoot.appendChild(summaryBar);

  if (!currentPlan || !currentPlan.stages || currentPlan.stages.length === 0) {
    const emptyNotice = h('div', { class: 'sidebar-empty-state' }, [
      h('p', null, SIDEBAR_VOCAB.staging.noPlan)
    ]);
    panelRoot.appendChild(emptyNotice);
    container.appendChild(panelRoot);
    return;
  }

  // 2. Staging Table (FDI columns x Stage rows)
  const fdiColumns = getFdiColumnsForPlan(currentPlan);
  const nStages = currentPlan.stages.length;
  const currentStage = planStageIndex(state);

  const tableWrap = h('div', { class: 'staging-table-wrap' });
  const tableEl = h('table', { class: 'staging-table' });

  // Table Header (FDI teeth)
  const theadEl = h('thead', null, [
    h('tr', null, [
      h('th', { class: 'staging-th-stage' }, SIDEBAR_VOCAB.staging.stageCol),
      ...fdiColumns.map(fdi => h('th', {
        class: 'staging-th-tooth',
        title: SIDEBAR_VOCAB.staging.toothFdiTitle(fdi)
      }, String(fdi)))
    ])
  ]);
  tableEl.appendChild(theadEl);

  // Table Body
  const tbodyEl = h('tbody', null);

  // Stage rows: 0 (Initial) through nStages
  for (let s = 0; s <= nStages; s++) {
    const isCurrent = s === currentStage;
    const stageLabel = s === 0 ? SIDEBAR_VOCAB.staging.initialStage : `${s}`;

    const trEl = h('tr', {
      class: `staging-row ${isCurrent ? 'current-stage' : ''}`,
      dataset: { stage: s },
      onClick: () => {
        ctx.store.set({ stageIndex: s });
      }
    }, [
      h('td', { class: 'staging-td-stage' }, stageLabel)
    ]);

    for (const fdi of fdiColumns) {
      const u = fdiToUniversal(fdi);
      if (u === null) {
        trEl.appendChild(h('td', { class: 'staging-cell staging-cell-empty' }, '—'));
        continue;
      }

      if (s === 0) {
        trEl.appendChild(h('td', { class: 'staging-cell staging-cell-initial' }, [
          h('span', { class: 'cell-dot cell-idle' })
        ]));
        continue;
      }

      const move = getToothMovementInfo(currentPlan, s, u);
      const isCollision = hasToothCollision(currentPlan, s, u);

      const cellContent = [];

      // Movement indicator
      if (move.kind === 'locked') {
        cellContent.push(h('span', { class: 'cell-locked-icon', title: SIDEBAR_VOCAB.staging.lockedTitle }, '🔒'));
      } else if (move.kind === 'extracted') {
        cellContent.push(h('span', { class: 'cell-extracted-mark', title: SIDEBAR_VOCAB.staging.extractedTitle }, '✕'));
      } else {
        const moveCls = `cell-move-${move.kind}`;
        const titleText = move.rotDeg > 0.1
          ? SIDEBAR_VOCAB.staging.rotTitle(move.rotDeg)
          : SIDEBAR_VOCAB.staging.transTitle(move.linearMm);
        cellContent.push(h('span', { class: `cell-dot ${moveCls}`, title: titleText }));
      }

      // Collision ring indicator
      if (isCollision) {
        cellContent.push(h('span', {
          class: 'collision-ring',
          title: SIDEBAR_VOCAB.staging.collisionTitle(s, fdi)
        }));
      }

      const tdEl = h('td', {
        class: `staging-cell ${isCollision ? 'has-collision' : ''} ${move.kind !== 'idle' ? 'is-active-move' : ''}`
      }, cellContent);

      trEl.appendChild(tdEl);
    }

    tbodyEl.appendChild(trEl);
  }

  tableEl.appendChild(tbodyEl);
  tableWrap.appendChild(tableEl);
  panelRoot.appendChild(tableWrap);

  // Table legend at bottom
  const legendEl = h('div', { class: 'staging-legend' }, [
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'cell-dot cell-move-trans' }),
      h('span', null, SIDEBAR_VOCAB.staging.legendTrans)
    ]),
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'cell-dot cell-move-rot' }),
      h('span', null, SIDEBAR_VOCAB.staging.legendRot)
    ]),
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'cell-dot cell-move-vert' }),
      h('span', null, SIDEBAR_VOCAB.staging.legendVert)
    ]),
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'collision-ring legend-ring' }),
      h('span', null, SIDEBAR_VOCAB.staging.legendCollision)
    ]),
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'cell-locked-icon' }, '🔒'),
      h('span', null, SIDEBAR_VOCAB.staging.legendLocked)
    ]),
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'cell-extracted-mark' }, '✕'),
      h('span', null, SIDEBAR_VOCAB.staging.legendExtracted)
    ])
  ]);
  panelRoot.appendChild(legendEl);

  container.appendChild(panelRoot);

  // Restore scroll position
  if (prevScrollTop != null && prevWrap) {
    const newWrap = container.querySelector('.staging-table-wrap');
    if (newWrap) {
      newWrap.scrollTop = prevScrollTop;
      newWrap.scrollLeft = prevScrollLeft;
    }
  }
}

/**
 * Render the top summary row of the plan.
 */
function renderPlanSummaryBar(plan) {
  const barEl = h('div', { class: 'staging-summary-bar' });

  if (!plan) {
    barEl.appendChild(h('span', { class: 'summary-label' }, SIDEBAR_VOCAB.staging.noPlanSummary));
    return barEl;
  }

  const stratName = STRATEGY_KO[plan.strategy] || plan.strategy || SIDEBAR_VOCAB.staging.defaultPlanLabel;
  const nStages = plan.stages?.length ?? plan.info?.n_stages ?? 0;
  const months = plan.info?.months != null ? plan.info.months : (nStages ? (nStages / 1.5).toFixed(1) : 0);
  const violationsCount = violationCount(plan);

  barEl.appendChild(h('span', { class: 'summary-pill summary-pill-strategy' }, stratName));
  barEl.appendChild(h('span', { class: 'summary-pill' }, T.stagesCount(nStages)));
  barEl.appendChild(h('span', { class: 'summary-pill' }, T.monthsCount(months)));

  const violPill = h('span', {
    class: `summary-pill ${violationsCount > 0 ? 'summary-pill-danger' : 'summary-pill-success'}`
  }, violationsCount > 0 ? T.violations(violationsCount) : T.workspace.passed);
  barEl.appendChild(violPill);

  return barEl;
}
