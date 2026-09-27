// Staging table for workspace right sidebar (J8 contract)

import { clear, h } from '../../../ui/dom.js';
import { fdiToUniversal, universalToFdi } from '../../../domain/teeth.js';
import { T } from '../../../domain/vocab.js';
import { preferredPlan } from '../../../domain/status.js';

export const STRATEGY_KO = Object.freeze({
  expansion: '확장',
  ipr: 'IPR',
  extraction: '발치',
  expansion_ipr: '확장 · IPR'
});

/**
 * Returns FDI tooth numbers for the staging table columns in standard dental order:
 * Quadrant 1 (18 down to 11) followed by Quadrant 2 (21 up to 28).
 *
 * @param {Object} [plan] - Viewing plan
 * @returns {Array<number>} Array of FDI tooth numbers
 */
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

/**
 * Determines tooth movement type at a given stage.
 *
 * @param {Object} plan - Plan object
 * @param {number} stageIdx - Stage index (1..N)
 * @param {number} uTooth - Universal tooth number (1..16)
 * @returns {Object} { kind: 'locked'|'extracted'|'rot'|'vert'|'trans'|'idle', linearMm, rotDeg }
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
 * Checks if tooth is involved in a collision at a given stage.
 *
 * @param {Object} plan - Plan object
 * @param {number} stageIdx - Stage index (1..N)
 * @param {number} uTooth - Universal tooth number
 * @returns {boolean}
 */
export function hasToothCollision(plan, stageIdx, uTooth) {
  if (!plan || !Array.isArray(plan.violations) || stageIdx <= 0) {
    return false;
  }
  const uStr = String(uTooth);
  return plan.violations.some(v =>
    v.stage === stageIdx &&
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
  clear(container);

  const state = ctx.store.get();
  const plans = state.plans || [];
  const currentPlan = (state.viewingPlanId && plans.find(p => (p.plan_id || p.id) === state.viewingPlanId))
    || preferredPlan(plans)
    || plans[0]
    || null;

  const panelRoot = h('div', { class: 'sidebar-staging-panel' });

  // 1. Plan summary bar ("계획 요약 줄")
  const summaryBar = renderPlanSummaryBar(currentPlan);
  panelRoot.appendChild(summaryBar);

  if (!currentPlan || !currentPlan.stages || currentPlan.stages.length === 0) {
    const emptyNotice = h('div', { class: 'sidebar-empty-state' }, [
      h('p', null, '표시할 단계 계획이 없습니다.')
    ]);
    panelRoot.appendChild(emptyNotice);
    container.appendChild(panelRoot);
    return;
  }

  // 2. Staging Table (FDI columns x Stage rows)
  const fdiColumns = getFdiColumnsForPlan(currentPlan);
  const nStages = currentPlan.stages.length;
  const currentStage = typeof state.stage === 'number' ? state.stage : 0;

  const tableWrap = h('div', { class: 'staging-table-wrap' });
  const tableEl = h('table', { class: 'staging-table' });

  // Table Header (FDI teeth)
  const theadEl = h('thead', null, [
    h('tr', null, [
      h('th', { class: 'staging-th-stage' }, '단계'),
      ...fdiColumns.map(fdi => h('th', {
        class: 'staging-th-tooth',
        title: `치아 FDI ${fdi}`
      }, String(fdi)))
    ])
  ]);
  tableEl.appendChild(theadEl);

  // Table Body
  const tbodyEl = h('tbody', null);

  // Stage rows: 0 (Initial) through nStages
  for (let s = 0; s <= nStages; s++) {
    const isCurrent = s === currentStage;
    const stageLabel = s === 0 ? '0 (초기)' : `${s}`;

    const trEl = h('tr', {
      class: `staging-row ${isCurrent ? 'current-stage' : ''}`,
      dataset: { stage: s },
      onClick: () => {
        ctx.store.set({ stage: s });
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
        cellContent.push(h('span', { class: 'cell-locked-icon', title: '고정 치아' }, '🔒'));
      } else if (move.kind === 'extracted') {
        cellContent.push(h('span', { class: 'cell-extracted-mark', title: '발치 치아' }, '✕'));
      } else {
        const moveCls = `cell-move-${move.kind}`;
        const titleText = move.rotDeg > 0.1
          ? `회전 ${move.rotDeg.toFixed(1)}°`
          : `이동 ${(move.linearMm * 10).toFixed(1)}mm/10`;
        cellContent.push(h('span', { class: `cell-dot ${moveCls}`, title: titleText }));
      }

      // Collision ring indicator ("충돌 고리")
      if (isCollision) {
        cellContent.push(h('span', {
          class: 'collision-ring',
          title: `단계 ${s} 치아 FDI ${fdi} 충돌 발생`
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
      h('span', null, '이동/확장')
    ]),
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'cell-dot cell-move-rot' }),
      h('span', null, '회전')
    ]),
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'cell-dot cell-move-vert' }),
      h('span', null, '수직')
    ]),
    h('div', { class: 'legend-item' }, [
      h('span', { class: 'collision-ring legend-ring' }),
      h('span', null, '충돌 고리')
    ])
  ]);
  panelRoot.appendChild(legendEl);

  container.appendChild(panelRoot);
}

/**
 * Render the top summary row of the plan.
 */
function renderPlanSummaryBar(plan) {
  const barEl = h('div', { class: 'staging-summary-bar' });

  if (!plan) {
    barEl.appendChild(h('span', { class: 'summary-label' }, '계획 없음'));
    return barEl;
  }

  const stratName = STRATEGY_KO[plan.strategy] || plan.strategy || '계획';
  const nStages = plan.stages?.length ?? plan.info?.n_stages ?? 0;
  const months = plan.info?.months != null ? plan.info.months : (nStages ? (nStages / 1.5).toFixed(1) : 0);
  const violationsCount = plan.violations?.length || 0;

  barEl.appendChild(h('span', { class: 'summary-pill summary-pill-strategy' }, stratName));
  barEl.appendChild(h('span', { class: 'summary-pill' }, T.stagesCount(nStages)));
  barEl.appendChild(h('span', { class: 'summary-pill' }, T.monthsCount(months)));

  const violPill = h('span', {
    class: `summary-pill ${violationsCount > 0 ? 'summary-pill-danger' : 'summary-pill-success'}`
  }, violationsCount > 0 ? T.violations(violationsCount) : T.workspace.passed);
  barEl.appendChild(violPill);

  return barEl;
}
