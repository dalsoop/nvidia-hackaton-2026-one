// Checks & Rule validation results for workspace right sidebar (J8 contract)

import { clear, h } from '../../../ui/dom.js';
import { universalToFdi } from '../../../domain/teeth.js';
import { T } from '../../../domain/vocab.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';
import { preferredPlan } from '../../../domain/status.js';

export const VIOLATION_LABELS = SIDEBAR_VOCAB.rules.violations;

/**
 * Group violations by violation type and tooth pairs / teeth.
 *
 * @param {Array} violations - Array of violation objects
 * @returns {Array} Array of violation group objects with .byType and .total properties
 */
export function groupViolations(violations = []) {
  if (!Array.isArray(violations)) {
    const empty = [];
    empty.byType = {};
    empty.total = 0;
    return empty;
  }

  const typeMap = new Map();

  for (const v of violations) {
    if (!v || typeof v !== 'object') continue;
    const type = v.type || 'unknown';

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
    group.count++;
    group.items.push(v);

    const teeth = Array.isArray(v.teeth)
      ? v.teeth.map(Number).filter(n => Number.isInteger(n))
      : [];

    if (teeth.length >= 2) {
      // Tooth pair grouping (e.g. collision between 2 teeth)
      const sortedTeeth = [...teeth].sort((a, b) => a - b);
      const pairKey = sortedTeeth.join('-');
      let pairEntry = group.pairs.find(p => p.pairKey === pairKey);

      if (!pairEntry) {
        pairEntry = {
          pairKey,
          teeth: sortedTeeth,
          fdiTeeth: sortedTeeth.map(t => universalToFdi(t)).filter(n => n !== null),
          count: 0,
          stages: [],
          maxOverlap: 0,
          items: []
        };
        group.pairs.push(pairEntry);
      }

      pairEntry.count++;
      pairEntry.items.push(v);

      if (v.stage != null) {
        const stageNum = Number(v.stage);
        if (Number.isInteger(stageNum) && !pairEntry.stages.includes(stageNum)) {
          pairEntry.stages.push(stageNum);
          pairEntry.stages.sort((a, b) => a - b);
        }
      }

      if (v.overlap_mm3 != null && Number(v.overlap_mm3) > pairEntry.maxOverlap) {
        pairEntry.maxOverlap = Number(v.overlap_mm3);
      }
    } else if (teeth.length === 1) {
      // Single tooth grouping (e.g. move_limit, rotation_limit, locked_tooth)
      const t = teeth[0];
      let toothEntry = group.byTooth.find(item => item.tooth === t);

      if (!toothEntry) {
        toothEntry = {
          tooth: t,
          fdiTooth: universalToFdi(t),
          count: 0,
          stages: [],
          items: []
        };
        group.byTooth.push(toothEntry);
      }

      toothEntry.count++;
      toothEntry.items.push(v);

      if (v.stage != null) {
        const stageNum = Number(v.stage);
        if (Number.isInteger(stageNum) && !toothEntry.stages.includes(stageNum)) {
          toothEntry.stages.push(stageNum);
          toothEntry.stages.sort((a, b) => a - b);
        }
      }
    } else {
      // General / plan-level violations (space_deficit, stage_cap, etc.)
      group.general.push(v);
    }
  }

  const result = Array.from(typeMap.values());
  result.byType = {};
  for (const g of result) {
    result.byType[g.type] = g;
  }
  result.total = violations.length;

  return result;
}

/**
 * Render the checks / rules panel.
 *
 * @param {HTMLElement} container - Target container
 * @param {Object} ctx - App context
 */
export function renderChecks(container, ctx) {
  clear(container);

  const state = ctx.store.get();
  const plans = state.plans || [];
  const currentPlan = (state.viewingPlanId && plans.find(p => (p.plan_id || p.id) === state.viewingPlanId))
    || state.viewingPlan
    || preferredPlan(plans)
    || plans[0]
    || null;

  const panelRoot = h('div', { class: 'sidebar-checks-panel' });

  // Header
  const headerEl = h('div', { class: 'sidebar-panel-header' }, [
    h('h3', { class: 'sidebar-panel-title' }, SIDEBAR_VOCAB.rules.title),
    h('span', {
      class: `sidebar-status-pill ${!currentPlan ? 'neutral' : (currentPlan.violations?.length ? 'danger' : 'success')}`
    }, !currentPlan ? SIDEBAR_VOCAB.rules.noPlanStatus : (currentPlan.violations?.length ? T.violations(currentPlan.violations.length) : T.workspace.passed))
  ]);
  panelRoot.appendChild(headerEl);

  if (!currentPlan) {
    const emptyNotice = h('div', { class: 'sidebar-empty-state' }, [
      h('p', null, SIDEBAR_VOCAB.rules.noPlan)
    ]);
    panelRoot.appendChild(emptyNotice);
    container.appendChild(panelRoot);
    return;
  }

  const violations = currentPlan.violations || [];
  const grouped = groupViolations(violations);

  if (grouped.length === 0) {
    // All checks passed
    const passCard = h('div', { class: 'checks-pass-card' }, [
      h('div', { class: 'checks-pass-icon' }, '✓'),
      h('h4', { class: 'checks-pass-title' }, SIDEBAR_VOCAB.rules.allPassedTitle),
      h('p', { class: 'checks-pass-desc' }, SIDEBAR_VOCAB.rules.allPassedDesc)
    ]);
    panelRoot.appendChild(passCard);
    container.appendChild(panelRoot);
    return;
  }

  const currentStage = Number(state.stage);

  // Violations list
  const listEl = h('div', { class: 'checks-group-list' });

  for (const group of grouped) {
    const groupCard = h('div', { class: 'checks-group-card' });

    const groupHeader = h('div', { class: 'checks-group-header' }, [
      h('div', { class: 'checks-group-name' }, [
        h('span', { class: 'checks-danger-dot' }),
        h('strong', null, group.label)
      ]),
      h('span', { class: 'checks-group-count' }, SIDEBAR_VOCAB.rules.groupCount(group.count))
    ]);
    groupCard.appendChild(groupHeader);

    const groupBody = h('div', { class: 'checks-group-body' });

    // 1. Tooth pairs (e.g. Collisions)
    if (group.pairs.length > 0) {
      for (const pair of group.pairs) {
        const fdiText = pair.fdiTeeth.length ? pair.fdiTeeth.join(' · ') : pair.teeth.join(' · ');
        const itemEl = h('div', { class: 'checks-item-row' });

        if (pair.stages.length > 0) {
          itemEl.classList.add('checks-item-clickable');
          itemEl.title = SIDEBAR_VOCAB.rules.stageJumpTitle(pair.stages[0]);
          itemEl.onclick = () => {
            ctx.store.set({ stage: pair.stages[0] });
          };
        }

        const infoEl = h('div', { class: 'checks-item-info' }, [
          h('span', { class: 'checks-tooth-badge' }, SIDEBAR_VOCAB.rules.toothFdiPairBadge(fdiText)),
          pair.maxOverlap > 0
            ? h('span', { class: 'checks-metric' }, SIDEBAR_VOCAB.rules.maxOverlap(pair.maxOverlap))
            : null
        ]);
        itemEl.appendChild(infoEl);

        // Stage jump buttons
        if (pair.stages.length > 0) {
          const stagesWrap = h('div', { class: 'checks-stages-wrap' }, [
            h('span', { class: 'checks-stages-label' }, SIDEBAR_VOCAB.rules.stageLabel),
            ...pair.stages.map(st => h('button', {
              type: 'button',
              class: `checks-stage-chip ${currentStage === st ? 'active' : ''}`,
              title: SIDEBAR_VOCAB.rules.stageJumpTitle(st),
              onClick: (e) => {
                e.stopPropagation();
                ctx.store.set({ stage: st });
              }
            }, SIDEBAR_VOCAB.rules.stageChip(st)))
          ]);
          itemEl.appendChild(stagesWrap);
        }

        groupBody.appendChild(itemEl);
      }
    }

    // 2. Single teeth (e.g. Move limit, rotation limit, locked tooth)
    if (group.byTooth.length > 0) {
      for (const tEntry of group.byTooth) {
        const fdiText = tEntry.fdiTooth ? SIDEBAR_VOCAB.rules.fdiToothText(tEntry.fdiTooth) : SIDEBAR_VOCAB.rules.universalToothText(tEntry.tooth);
        const itemEl = h('div', { class: 'checks-item-row' });

        if (tEntry.stages.length > 0) {
          itemEl.classList.add('checks-item-clickable');
          itemEl.title = SIDEBAR_VOCAB.rules.stageJumpTitle(tEntry.stages[0]);
          itemEl.onclick = () => {
            ctx.store.set({ stage: tEntry.stages[0] });
          };
        }

        const infoEl = h('div', { class: 'checks-item-info' }, [
          h('span', { class: 'checks-tooth-badge' }, SIDEBAR_VOCAB.rules.toothBadge(fdiText)),
          h('span', { class: 'checks-metric' }, SIDEBAR_VOCAB.rules.violationCountText(tEntry.count))
        ]);
        itemEl.appendChild(infoEl);

        if (tEntry.stages.length > 0) {
          const stagesWrap = h('div', { class: 'checks-stages-wrap' }, [
            h('span', { class: 'checks-stages-label' }, SIDEBAR_VOCAB.rules.stageLabel),
            ...tEntry.stages.map(st => h('button', {
              type: 'button',
              class: `checks-stage-chip ${currentStage === st ? 'active' : ''}`,
              title: SIDEBAR_VOCAB.rules.stageJumpTitle(st),
              onClick: (e) => {
                e.stopPropagation();
                ctx.store.set({ stage: st });
              }
            }, SIDEBAR_VOCAB.rules.stageChip(st)))
          ]);
          itemEl.appendChild(stagesWrap);
        }

        groupBody.appendChild(itemEl);
      }
    }

    // 3. General plan-level violations (space_deficit, stage_cap, etc.)
    if (group.general.length > 0) {
      for (const gItem of group.general) {
        let desc = SIDEBAR_VOCAB.rules.defaultViolationDesc;
        if (gItem.type === 'space_deficit') {
          desc = SIDEBAR_VOCAB.rules.spaceDeficitDesc(gItem.mm, gItem.limit);
        } else if (gItem.type === 'stage_cap') {
          desc = SIDEBAR_VOCAB.rules.stageCapDesc(gItem.n, gItem.limit);
        } else if (gItem.type === 'ipr_limit') {
          desc = SIDEBAR_VOCAB.rules.iprLimitDesc(gItem.mm, gItem.limit);
        } else if (gItem.type === 'extraction_forbidden') {
          desc = SIDEBAR_VOCAB.rules.extractionForbiddenDesc(gItem.teeth?.join(', '));
        }

        const itemEl = h('div', { class: 'checks-item-row checks-item-general' }, [
          h('span', { class: 'checks-general-desc' }, desc)
        ]);

        if (gItem.stage != null) {
          const st = Number(gItem.stage);
          if (Number.isInteger(st)) {
            const stagesWrap = h('div', { class: 'checks-stages-wrap' }, [
              h('button', {
                type: 'button',
                class: `checks-stage-chip ${currentStage === st ? 'active' : ''}`,
                title: SIDEBAR_VOCAB.rules.stageJumpTitle(st),
                onClick: (e) => {
                  e.stopPropagation();
                  ctx.store.set({ stage: st });
                }
              }, SIDEBAR_VOCAB.rules.stageChip(st))
            ]);
            itemEl.appendChild(stagesWrap);
          }
        }

        groupBody.appendChild(itemEl);
      }
    }

    groupCard.appendChild(groupBody);
    listEl.appendChild(groupCard);
  }

  panelRoot.appendChild(listEl);
  container.appendChild(panelRoot);
}
