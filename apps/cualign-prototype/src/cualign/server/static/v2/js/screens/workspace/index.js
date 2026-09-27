import { clear, h } from '../../ui/dom.js';
import { WORKSPACE_VOCAB as W } from '../../domain/vocab/workspace.js';
import { createViewer } from '../../viewer/index.js';
import { mountAgent } from '../../agent/panel.js';
import { mountSidebar } from './sidebar/index.js';
import { fetchPlanDetails, mountPlans, planId } from './plans.js';
import { calculateRailStage } from './plan-card.js';
import { bindDrawers } from './drawers.js';
import { preferredPlan } from '../../domain/status.js';

export function mount(root, params, ctx) {
  clear(root);
  const caseId = params.caseId || ctx.store.get().caseId;
  if (!caseId) {
    ctx.navigate('#/cases');
    return () => clear(root);
  }

  let mounted = true;
  let viewer = null;
  let plansView = null;
  let cleanAgent = null;
  let cleanSidebar = null;
  let unsubscribe = null;
  let lastPlansRef = null;
  let lastViewingId = null;
  let lastStageIndex = 0;
  let requestToken = 0;

  ctx.store.set({
    caseId,
    plans: [],
    viewingPlanId: null,
    viewingPlan: null,
    stageIndex: 0,
    railStage: 'none'
  });

  function disposeScreen() {
    viewer?.destroy();
    plansView?.destroy();
    cleanAgent?.();
    cleanSidebar?.();
    viewer = plansView = cleanAgent = cleanSidebar = null;
    clear(root);
  }

  function layout() {
    const shell = h('div', { class: 'screen-workspace-layout' });
    const left = h('aside', { class: 'workspace-panel-left' });
    const center = h('section', { class: 'workspace-panel-center' });
    const side = h('aside', { class: 'workspace-panel-sidebar' });
    const tabs = h('nav', { class: 'workspace-panel-tabrail', 'aria-label': W.planPanel });
    shell.append(left, center, side, tabs);
    bindDrawers(shell, { left, tabs });
    root.appendChild(shell);
    return { left, center, side };
  }

  async function loadMesh(targetViewer, reportError) {
    try {
      const mesh = await ctx.api.caseMesh(caseId);
      if (mounted && targetViewer === viewer) targetViewer.loadCase(mesh);
    } catch (err) {
      reportError(err);
    }
  }

  function mountSharedPanels(left, side) {
    const agent = h('section', { class: 'workspace-agent-container' });
    left.appendChild(agent);
    cleanAgent = mountAgent(agent, ctx);
    cleanSidebar = mountSidebar(side, ctx);
  }

  function applyDetailedPlan(plan, resetStage = true) {
    if (!plan || !mounted) return;
    const id = planId(plan);
    const stageIndex = resetStage ? 0 : lastStageIndex;
    lastViewingId = id;
    lastStageIndex = stageIndex;
    plansView?.setViewingPlan(plan);
    const plans = plansView?.getPlans() || [];
    lastPlansRef = plans;
    viewer?.setPlan(plan, plansView?.getPlanNumber(id));
    viewer?.setStage(stageIndex);
    ctx.store.set({
      plans,
      viewingPlanId: id,
      viewingPlan: plan,
      stageIndex,
      railStage: calculateRailStage(plan)
    });
  }

  async function selectPlan(planOrId) {
    const id = typeof planOrId === 'string' ? planOrId : planId(planOrId);
    if (!id) return null;
    const token = ++requestToken;
    const detailed = await fetchPlanDetails(ctx.api, id);
    if (!mounted || token !== requestToken) return null;
    applyDetailedPlan(detailed, id !== lastViewingId);
    return detailed;
  }

  function renderWorkspace(planSummaries, initialPlan) {
    disposeScreen();
    const { left, center, side } = layout();
    const plansContainer = h('section', { class: 'workspace-plans-container' });
    const viewerContainer = h('div', { class: 'workspace-viewer-container' });
    left.appendChild(plansContainer);
    center.appendChild(viewerContainer);

    viewer = createViewer(viewerContainer, {
      onStageChange: (stageIndex) => {
        lastStageIndex = stageIndex;
        ctx.store.set({ stageIndex });
      }
    });
    plansView = mountPlans(plansContainer, {
      plans: planSummaries,
      selectedPlanId: planId(initialPlan),
      viewingPlan: initialPlan,
      onSelectPlan: selectPlan,
      onPlanUpdated: async (updated) => applyDetailedPlan(updated, false),
      ctx
    });
    mountSharedPanels(left, side);
    applyDetailedPlan(initialPlan);
    loadMesh(viewer, (err) => plansView?.showError(err));

    unsubscribe?.();
    unsubscribe = ctx.store.subscribe((state) => {
      if (!mounted) return;
      if (state.plans !== lastPlansRef && Array.isArray(state.plans)) {
        lastPlansRef = state.plans;
        plansView?.update(state.plans, state.viewingPlanId);
      }
      if (state.viewingPlanId && state.viewingPlanId !== lastViewingId) {
        // A panel that already fetched the full plan (conditions recalculation)
        // hands it over; otherwise the detail is fetched once here.
        const handed = planId(state.viewingPlan) === state.viewingPlanId && Array.isArray(state.viewingPlan?.stages);
        if (handed) applyDetailedPlan(state.viewingPlan);
        else selectPlan(state.viewingPlanId).catch((err) => plansView?.showError(err));
      }
      if (Number.isInteger(state.stageIndex) && state.stageIndex !== lastStageIndex) {
        lastStageIndex = state.stageIndex;
        viewer?.setStage(state.stageIndex);
      }
    });
  }

  function failureReason(value) {
    if (Array.isArray(value)) return value.join(' · ');
    return value?.message || String(value || W.unknownPlanFailure);
  }

  function renderPlanFailure(reason, constraints) {
    disposeScreen();
    const { left, center, side } = layout();
    const error = h('div', { class: 'plan-start-error', role: 'alert' }, [
      h('strong', null, W.planStartTitle),
      h('span', { class: 'plan-start-error-message' }, failureReason(reason))
    ]);
    const tags = h('div', { class: 'plan-start-tags' }, W.constraintTags(constraints).map((tag) => h('span', null, tag)));
    const retryError = h('div', { class: 'plan-action-error', hidden: true });
    const retry = h('button', {
      type: 'button',
      class: 'btn btn-primary plan-start-recalc-btn',
      onClick: async () => {
        retry.disabled = true;
        retry.textContent = W.calculating;
        retryError.hidden = true;
        try {
          const result = await ctx.api.rulePlan({ case_id: caseId });
          if (result?.unsupported?.length) {
            error.querySelector('.plan-start-error-message').textContent = failureReason(result.unsupported);
            return;
          }
          await loadWorkspace();
        } catch (err) {
          retryError.textContent = failureReason(err);
          retryError.hidden = false;
        } finally {
          if (mounted) {
            retry.disabled = false;
            retry.textContent = W.recalculateWithConditions;
          }
        }
      }
    }, W.recalculateWithConditions);
    const planSection = h('section', { class: 'workspace-plan-start-panel' }, [
      h('div', { class: 'plans-panel-header' }, [h('h2', { class: 'plans-panel-title' }, W.plansTitle), h('span', { class: 'plans-panel-count' }, '0')]),
      error,
      h('div', { class: 'plan-start-conditions' }, [h('span', { class: 'plan-start-label' }, W.conditionsTitle), tags]),
      h('div', { class: 'plan-start-footer' }, [retryError, retry])
    ]);
    left.appendChild(planSection);
    const viewerContainer = h('div', { class: 'workspace-viewer-container' });
    center.appendChild(viewerContainer);
    viewer = createViewer(viewerContainer, { stageBar: false });
    mountSharedPanels(left, side);
    loadMesh(viewer, (err) => { retryError.textContent = failureReason(err); retryError.hidden = false; });
    lastPlansRef = [];
    ctx.store.set({ plans: lastPlansRef, viewingPlanId: null, viewingPlan: null, stageIndex: 0, railStage: 'none' });
  }

  async function loadWorkspace() {
    disposeScreen();
    root.appendChild(h('div', { class: 'screen-workspace-loading' }, [h('div', { class: 'workspace-spinner' }), h('span', null, W.loading)]));
    let activation;
    try {
      activation = await ctx.api.activateCase(caseId);
      const response = await ctx.api.listPlans(caseId);
      const summaries = response?.plans || [];
      if (!summaries.length) {
        const check = await ctx.api.caseCheck(caseId);
        renderPlanFailure(check?.unsupported, activation?.constraints);
        return;
      }
      const preferred = preferredPlan(summaries) || summaries[0];
      const detailed = await fetchPlanDetails(ctx.api, preferred);
      if (mounted) renderWorkspace(summaries, detailed);
    } catch (err) {
      if (mounted) renderPlanFailure(err, activation?.constraints);
    }
  }

  loadWorkspace();
  return () => {
    mounted = false;
    requestToken += 1;
    unsubscribe?.();
    unsubscribe = null;
    disposeScreen();
  };
}
