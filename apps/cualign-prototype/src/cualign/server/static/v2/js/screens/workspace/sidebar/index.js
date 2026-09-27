// Workspace right sidebar orchestrator (J8 contract)

import { clear, h } from '../../../ui/dom.js';
import { T } from '../../../domain/vocab.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';
import { renderStaging, getFdiColumnsForPlan } from './staging.js';
import { renderChecks, groupViolations } from './checks.js';
import { renderConditions, calculateConditionDiff } from './conditions.js';
import { planId, planStageIndex, selectViewingPlan } from './plan-state.js';

export { groupViolations } from './checks.js';
export { calculateConditionDiff } from './conditions.js';
export { getFdiColumnsForPlan } from './staging.js';
export { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';

const TABS = Object.freeze([
  {
    id: 'stages',
    label: SIDEBAR_VOCAB.tabs.stages,
    icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' // Staging table icon
  },
  {
    id: 'rules',
    label: SIDEBAR_VOCAB.tabs.rules,
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' // Checklist / rules icon
  },
  {
    id: 'conditions',
    label: SIDEBAR_VOCAB.tabs.conditions,
    icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' // Sliders / conditions icon
  }
]);

/**
 * Mount the workspace right sidebar with tab rail and panel content.
 *
 * @param {HTMLElement} el - Sidebar container element
 * @param {Object} ctx - App context { store, api, navigate }
 * @returns {Function} unmount cleanup function
 */
export function mountSidebar(el, ctx) {
  clear(el);

  let isMounted = true;
  let unsubscribe = null;
  let renderedTab = null;
  let renderedPlan = null;
  let renderedStage = null;

  // Root container for sidebar
  const sidebarContainer = h('div', { class: 'sidebar-root' });
  const contentArea = h('div', { class: 'sidebar-content-area' });

  // Check if an external tab rail exists in parent hierarchy (e.g. from workspace screen)
  const externalTabRail = el.parentElement?.querySelector('.workspace-panel-tabrail');

  // Place content area, then internal tab rail on the right if external tab rail does not exist
  sidebarContainer.appendChild(contentArea);

  let internalTabRail = null;
  if (!externalTabRail) {
    internalTabRail = h('nav', { class: 'sidebar-tab-rail' });
    sidebarContainer.appendChild(internalTabRail);
  }

  el.appendChild(sidebarContainer);

  function syncTabRail(activeTab) {
    const targetRails = [externalTabRail, internalTabRail].filter(Boolean);

    for (const rail of targetRails) {
      clear(rail);

      for (const tab of TABS) {
        const isActive = activeTab === tab.id || (tab.id === 'rules' && activeTab === 'checks');
        const btn = h('button', {
          type: 'button',
          class: `workspace-tabrail-btn ${isActive ? 'active' : ''}`,
          title: tab.label,
          onClick: () => {
            ctx.store.set({ sidebarTab: tab.id });
          }
        }, [
          createSvg(20, 20, tab.icon),
          h('span', { class: 'workspace-tabrail-label' }, tab.label)
        ]);

        rail.appendChild(btn);
      }
    }
  }

  function renderActivePanel() {
    if (!isMounted) return;

    const state = ctx.store.get();
    let currentTab = state.sidebarTab || 'stages';
    if (currentTab === 'checks') currentTab = 'rules';
    renderedTab = currentTab;
    renderedPlan = selectViewingPlan(state);
    renderedStage = planStageIndex(state);

    syncTabRail(currentTab);

    switch (currentTab) {
      case 'stages':
        renderStaging(contentArea, ctx);
        break;
      case 'rules':
        renderChecks(contentArea, ctx);
        break;
      case 'conditions':
        renderConditions(contentArea, ctx);
        break;
      default:
        renderStaging(contentArea, ctx);
        break;
    }
  }

  unsubscribe = ctx.store.subscribe(() => {
    const state = ctx.store.get();
    const nextTab = state.sidebarTab === 'checks' ? 'rules' : (state.sidebarTab || 'stages');
    const nextPlan = selectViewingPlan(state);
    const planChanged = nextPlan !== renderedPlan || planId(nextPlan) !== planId(renderedPlan);
    const stageChanged = planStageIndex(state) !== renderedStage;
    const needsStageRefresh = nextTab !== 'conditions' && stageChanged;

    if (nextTab !== renderedTab || planChanged || needsStageRefresh) {
      renderActivePanel();
    }
  });

  // Initial render
  renderActivePanel();

  return () => {
    isMounted = false;
    if (typeof unsubscribe === 'function') {
      unsubscribe();
      unsubscribe = null;
    }
    clear(el);
  };
}

function createSvg(width, height, pathD) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  return svg;
}
