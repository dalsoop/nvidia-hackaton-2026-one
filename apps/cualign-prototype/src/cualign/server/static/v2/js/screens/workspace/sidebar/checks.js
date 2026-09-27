// Checks & Rule validation results for workspace right sidebar (J8 contract)

import { clear, h } from '../../../ui/dom.js';
import { T } from '../../../domain/vocab.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';
import { planStageIndex, selectViewingPlan, violationCount } from './plan-state.js';
import { groupViolations } from './violations.js';

export { groupViolations, VIOLATION_LABELS } from './violations.js';

/**
 * Render the checks / rules panel.
 *
 * @param {HTMLElement} container - Target container
 * @param {Object} ctx - App context
 */
export function renderChecks(container, ctx) {
  clear(container);

  const state = ctx.store.get();
  const currentPlan = selectViewingPlan(state);
  const currentViolationCount = violationCount(currentPlan);

  const panelRoot = h('div', { class: 'sidebar-checks-panel' });

  // Header
  const headerEl = h('div', { class: 'sidebar-panel-header' }, [
    h('h3', { class: 'sidebar-panel-title' }, SIDEBAR_VOCAB.rules.title),
    h('span', {
      class: `sidebar-status-pill ${!currentPlan ? 'neutral' : (currentViolationCount ? 'danger' : 'success')}`
    }, !currentPlan ? SIDEBAR_VOCAB.rules.noPlanStatus : (currentViolationCount ? T.violations(currentViolationCount) : T.workspace.passed))
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

  const violations = Array.isArray(currentPlan.violations) ? currentPlan.violations : [];
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

  const currentStage = planStageIndex(state);

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
            ctx.store.set({ stageIndex: pair.stages[0] });
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
                ctx.store.set({ stageIndex: st });
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
            ctx.store.set({ stageIndex: tEntry.stages[0] });
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
                ctx.store.set({ stageIndex: st });
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
                  ctx.store.set({ stageIndex: st });
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
