// Workspace screen orchestrator (J6 contract)

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { createViewer } from '../../viewer/index.js';
import { createStageBar } from '../../viewer/stage-bar.js';
import { mountAgent } from '../../agent/panel.js';
import { mountSidebar } from './sidebar/index.js';
import { mountPlans, sortPlansByCreation } from './plans.js';
import { calculateRailStage } from './plan-card.js';
import { preferredPlan } from '../../domain/status.js';

/**
 * Mount the workspace screen.
 *
 * @param {HTMLElement} root - Screen container
 * @param {Object} params - Route params (e.g. { caseId })
 * @param {Object} ctx - App context { store, api, navigate }
 * @returns {Function} unmount cleanup function
 */
export function mount(root, params, ctx) {
  clear(root);

  let isMounted = true;
  let activeViewer = null;
  let activeStageBar = null;
  let agentCleanup = null;
  let sidebarCleanup = null;
  let plansCleanup = null;
  let unsubscribeStore = null;

  const caseId = params.caseId || ctx.store.get().caseId;

  if (!caseId) {
    const emptyNotice = h('div', { class: 'screen-workspace-empty' }, [
      h('h2', null, '케이스가 선택되지 않았습니다.'),
      h('p', null, '케이스 목록에서 계획할 케이스를 먼저 선택해주세요.'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        onClick: () => ctx.navigate('#/cases')
      }, '케이스 목록으로 가기')
    ]);
    root.appendChild(emptyNotice);
    return () => clear(root);
  }

  // Loading state
  const loadingEl = h('div', { class: 'screen-workspace-loading' }, [
    h('div', { class: 'workspace-spinner' }),
    h('div', { class: 'workspace-loading-text' }, `${caseId} 케이스를 여는 중...`)
  ]);
  root.appendChild(loadingEl);

  async function loadWorkspace() {
    clear(root);

    let activateData = null;
    let activateError = null;

    try {
      activateData = await ctx.api.activateCase(caseId);
    } catch (err) {
      activateError = err;
    }

    let plans = [];
    if (!activateError) {
      try {
        const plansRes = await ctx.api.listPlans(caseId);
        plans = plansRes?.plans || [];
      } catch (err) {
        activateError = err;
      }
    }

    if (!isMounted) return;

    // Failure case or 0 plans: Render PlanStart failure screen
    if (activateError || plans.length === 0) {
      renderPlanStart(activateError?.message || '이 케이스에 생성된 계획이 없습니다.');
      return;
    }

    // Success case: Render full workspace grid (64 · 380 · 1fr · 400 · 56)
    renderWorkspaceLayout(plans);
  }

  function renderPlanStart(errorMessage) {
    clear(root);

    const planStartContainer = h('div', { class: 'screen-workspace-plan-start' });
    const card = h('div', { class: 'plan-start-card' });

    const iconEl = h('div', { class: 'plan-start-icon' }, [
      h('span', { class: 'plan-start-badge-warn' }, '!')
    ]);

    const titleEl = h('h2', { class: 'plan-start-title' }, '계획 생성 필요');
    const descEl = h('p', { class: 'plan-start-desc' },
      '케이스 초기 계획을 생성하지 못했거나 저장된 계획이 없습니다.'
    );

    const errorBox = h('div', { class: 'plan-start-error-box' }, [
      h('span', { class: 'plan-start-error-label' }, '오류 원인:'),
      h('span', { class: 'plan-start-error-msg' }, errorMessage)
    ]);

    const retryBtn = h('button', {
      type: 'button',
      class: 'btn btn-primary plan-start-recalc-btn',
      onClick: async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = '계산 중...';
        try {
          await ctx.api.rulePlan({ case_id: caseId });
          await loadWorkspace();
        } catch (err) {
          retryBtn.disabled = false;
          retryBtn.textContent = '이 조건으로 다시 계산';
          const msgEl = card.querySelector('.plan-start-error-msg');
          if (msgEl) {
            msgEl.textContent = `계산 실패: ${err.message || T.errors.requestFailed}`;
          }
        }
      }
    }, '이 조건으로 다시 계산');

    card.appendChild(iconEl);
    card.appendChild(titleEl);
    card.appendChild(descEl);
    card.appendChild(errorBox);
    card.appendChild(retryBtn);

    planStartContainer.appendChild(card);
    root.appendChild(planStartContainer);

    // Update rail stage to 'none'
    ctx.store.set({ stage: 'none' });
  }

  function renderWorkspaceLayout(plans) {
    clear(root);

    const sortedPlans = sortPlansByCreation(plans);
    // Determine initially viewed plan: preferredPlan or first plan
    const initialBest = preferredPlan(sortedPlans);
    let viewingPlan = initialBest || sortedPlans[0];
    const viewingPlanId = viewingPlan?.plan_id || viewingPlan?.id;

    // Update rail stage based on the viewing plan
    const initialStage = calculateRailStage(viewingPlan);
    ctx.store.set({
      caseId,
      plans: sortedPlans,
      stage: initialStage,
      activePlanId: viewingPlanId,
      viewingPlanId: viewingPlanId
    });

    let lastHandledViewingPlanId = viewingPlanId;
    let lastPlansRef = sortedPlans;

    // Grid container: 380px · 1fr · 400px · 56px (shell rail provides the 64px)
    const layoutEl = h('div', { class: 'screen-workspace-layout' });

    // 1. Left 380px panel (Top: Plans list, Bottom: Agent panel)
    const leftPanel = h('aside', { class: 'workspace-panel-left' });
    const plansContainer = h('section', { class: 'workspace-plans-container' });
    const agentContainer = h('section', { class: 'workspace-agent-container' });
    leftPanel.appendChild(plansContainer);
    leftPanel.appendChild(agentContainer);

    // 2. Center 1fr panel (Viewer + Stage scrubber)
    const centerPanel = h('section', { class: 'workspace-panel-center' });
    const viewerContainer = h('div', { class: 'workspace-viewer-container' });
    const stageBarContainer = h('div', { class: 'workspace-stagebar-container' });
    centerPanel.appendChild(viewerContainer);
    centerPanel.appendChild(stageBarContainer);

    // 3. Right 400px sidebar panel (mountSidebar)
    const sidebarPanel = h('aside', { class: 'workspace-panel-sidebar' });

    // 4. Rightmost 56px tab rail
    const tabRail = h('nav', { class: 'workspace-panel-tabrail' });
    renderRightTabRail(tabRail);

    layoutEl.appendChild(leftPanel);
    layoutEl.appendChild(centerPanel);
    layoutEl.appendChild(sidebarPanel);
    layoutEl.appendChild(tabRail);
    root.appendChild(layoutEl);

    // Initialize 3D viewer (J5 contract)
    activeViewer = createViewer(viewerContainer);

    // Load mesh into viewer
    ctx.api.caseMesh(caseId).then((mesh) => {
      if (isMounted && activeViewer && mesh) {
        activeViewer.loadCase(mesh);
      }
    }).catch(() => {
      // Mesh load failure is non-fatal for UI navigation
    });

    // Function to apply viewing plan to viewer and stagebar and rail
    function applyViewingPlan(plan) {
      if (!plan) return;
      viewingPlan = plan;
      const pid = plan.plan_id || plan.id;
      lastHandledViewingPlanId = pid;

      // 1. Update rail stage and store
      const stage = calculateRailStage(plan);
      ctx.store.set({
        stage,
        activePlanId: pid,
        viewingPlanId: pid
      });

      // 2. Update viewer
      if (activeViewer) {
        activeViewer.setPlan(plan);
      }

      // 3. Update stagebar
      const nStages = plan.n_stages ?? plan.info?.n_stages ?? (plan.stages ? plan.stages.length : 1);
      const maxStage = Math.max(0, nStages - 1);

      if (activeStageBar) {
        activeStageBar.destroy();
        activeStageBar = null;
      }

      clear(stageBarContainer);
      activeStageBar = createStageBar(stageBarContainer, {
        max: maxStage,
        value: 0,
        violations: plan.violations || [],
        onChange: (stageIdx) => {
          if (activeViewer) {
            activeViewer.setStage(stageIdx);
          }
        }
      });
    }

    // Mount plans list component (plans.js)
    const plansMountInstance = mountPlans(plansContainer, {
      plans: sortedPlans,
      caseId,
      selectedPlanId: viewingPlanId,
      onSelectPlan: (plan) => {
        applyViewingPlan(plan);
      },
      onPlanUpdated: (updatedViewingPlan, allPlans) => {
        applyViewingPlan(updatedViewingPlan);
      },
      ctx
    });
    plansCleanup = () => plansMountInstance.destroy();

    // Mount agent chat panel (J7 contract)
    agentCleanup = mountAgent(agentContainer, ctx);

    // Mount sidebar panel (J8 contract)
    sidebarCleanup = mountSidebar(sidebarPanel, ctx);

    // Initial apply for viewing plan
    applyViewingPlan(viewingPlan);

    // Subscribe to store to react to plan updates emitted by agent or external actions
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
    }

    if (ctx?.store && typeof ctx.store.subscribe === 'function') {
      lastHandledViewingPlanId = viewingPlanId;
      lastPlansRef = plans;

      unsubscribeStore = ctx.store.subscribe(() => {
        if (!isMounted) return;
        const state = ctx.store.get();

        const storePlansRaw = state.plans;
        const storePlans = Array.isArray(storePlansRaw) ? storePlansRaw : storePlansRaw?.plans;
        const storeViewingId = state.viewingPlanId;

        if (storePlans && storePlans !== lastPlansRef) {
          lastPlansRef = storePlans;
          plansMountInstance.update(storePlans, storeViewingId);
          const current = plansMountInstance.getViewingPlan();
          if (current) {
            applyViewingPlan(current);
          }
        } else if (storeViewingId && storeViewingId !== lastHandledViewingPlanId) {
          lastHandledViewingPlanId = storeViewingId;
          plansMountInstance.update(plansMountInstance.getPlans(), storeViewingId);
          const current = plansMountInstance.getViewingPlan();
          if (current) {
            applyViewingPlan(current);
          }
        }
      });
    }
  }

  function renderRightTabRail(el) {
    clear(el);
    const tabs = [
      { id: 'rules', label: T.workspace.rules, icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { id: 'conditions', label: T.workspace.conditions, icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
      { id: 'stages', label: T.workspace.stages, icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' }
    ];

    tabs.forEach((tab, i) => {
      const btn = h('button', {
        type: 'button',
        class: `workspace-tabrail-btn ${i === 0 ? 'active' : ''}`,
        title: tab.label
      }, [
        createSvg(20, 20, tab.icon),
        h('span', { class: 'workspace-tabrail-label' }, tab.label)
      ]);
      el.appendChild(btn);
    });
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

  // Initial load
  loadWorkspace();

  return () => {
    isMounted = false;
    if (typeof unsubscribeStore === 'function') {
      unsubscribeStore();
      unsubscribeStore = null;
    }
    if (activeViewer && typeof activeViewer.destroy === 'function') {
      activeViewer.destroy();
      activeViewer = null;
    }
    if (activeStageBar && typeof activeStageBar.destroy === 'function') {
      activeStageBar.destroy();
      activeStageBar = null;
    }
    if (typeof agentCleanup === 'function') {
      agentCleanup();
      agentCleanup = null;
    }
    if (typeof sidebarCleanup === 'function') {
      sidebarCleanup();
      sidebarCleanup = null;
    }
    if (typeof plansCleanup === 'function') {
      plansCleanup();
      plansCleanup = null;
    }
    clear(root);
  };
}
