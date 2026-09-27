// Conditions form & diff calculation for workspace right sidebar (J8 contract)

import { clear, h } from '../../../ui/dom.js';
import { formatUniversalTeethAsFdi } from '../../../domain/teeth.js';
import { T } from '../../../domain/vocab.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';
import { planId, resolveCreatedPlanId, selectViewingPlan } from './plan-state.js';
import { calculateConditionDiff, DEFAULT_CONSTRAINTS, normalizeToothList } from './conditions-model.js';

export { calculateConditionDiff, DEFAULT_CONSTRAINTS, normalizeToothList } from './conditions-model.js';

const PATIENT_CASE_RE = /^P\d+-S\d+$/;

/**
 * Render the conditions panel with form and recalculate button.
 *
 * @param {HTMLElement} container - Target container
 * @param {Object} ctx - App context
 */
export function renderConditions(container, ctx) {
  clear(container);

  const state = ctx.store.get();
  const currentPlan = selectViewingPlan(state);

  const caseId = state.caseId || currentPlan?.case_id || null;
  const isSample = !caseId || !PATIENT_CASE_RE.test(caseId);

  const currentConstraints = currentPlan?.constraints || DEFAULT_CONSTRAINTS;

  const panelRoot = h('div', { class: 'sidebar-conditions-panel' });

  // Header
  const headerEl = h('div', { class: 'sidebar-panel-header' }, [
    h('h3', { class: 'sidebar-panel-title' }, SIDEBAR_VOCAB.conditions.title),
    currentPlan
      ? h('span', { class: 'sidebar-header-plan-id' }, currentPlan.plan_id || currentPlan.id || '')
      : null
  ]);
  panelRoot.appendChild(headerEl);

  // Scrollable body
  const bodyEl = h('div', { class: 'conditions-body' });

  // If sample case: show prescription sentence above the form
  if (isSample) {
    const currentCase = state.currentCase || state.activeCase || (state.cases || []).find(c => (c.case_id || c.id) === caseId);
    const prescriptionText = currentCase?.prescription || currentCase?.prescription_text || currentCase?.title || state.prescription || currentPlan?.prescription || '';

    if (prescriptionText) {
      const rxBanner = h('div', { class: 'conditions-prescription-banner' }, [
        h('div', { class: 'prescription-badge' }, SIDEBAR_VOCAB.conditions.prescriptionBannerTitle),
        h('div', { class: 'prescription-content' }, prescriptionText)
      ]);
      bodyEl.appendChild(rxBanner);
    }
  }

  // Conditions Form
  const formEl = h('form', {
    class: 'conditions-form',
    onSubmit: (e) => {
      e.preventDefault();
      handleRecalculate();
    }
  });

  // 1. Extraction allowed checkbox
  const extCheck = h('input', {
    type: 'checkbox',
    id: 'cond_allow_extraction',
    checked: Boolean(currentConstraints.allow_extraction)
  });
  const extGroup = h('div', { class: 'form-group form-group-checkbox' }, [
    h('label', { for: 'cond_allow_extraction', class: 'checkbox-label' }, [
      extCheck,
      h('span', { class: 'label-text' }, SIDEBAR_VOCAB.conditions.allowExtraction)
    ]),
    h('span', { class: 'form-hint' }, SIDEBAR_VOCAB.conditions.allowExtractionHint)
  ]);
  formEl.appendChild(extGroup);

  // 2. Locked teeth
  const lockInput = h('input', {
    type: 'text',
    id: 'cond_lock',
    class: 'form-input',
    placeholder: SIDEBAR_VOCAB.conditions.lockPlaceholder,
    value: formatUniversalTeethAsFdi(currentConstraints.lock || [])
  });
  const lockGroup = h('div', { class: 'form-group' }, [
    h('label', { for: 'cond_lock', class: 'form-label' }, SIDEBAR_VOCAB.conditions.lock),
    lockInput,
    h('span', { class: 'form-hint' }, SIDEBAR_VOCAB.conditions.lockHint)
  ]);
  formEl.appendChild(lockGroup);

  // 3. IPR excluded teeth
  const exclInput = h('input', {
    type: 'text',
    id: 'cond_ipr_exclude',
    class: 'form-input',
    placeholder: SIDEBAR_VOCAB.conditions.iprExcludePlaceholder,
    value: formatUniversalTeethAsFdi(currentConstraints.ipr_exclude || [])
  });
  const exclGroup = h('div', { class: 'form-group' }, [
    h('label', { for: 'cond_ipr_exclude', class: 'form-label' }, SIDEBAR_VOCAB.conditions.iprExclude),
    exclInput,
    h('span', { class: 'form-hint' }, SIDEBAR_VOCAB.conditions.iprExcludeHint)
  ]);
  formEl.appendChild(exclGroup);

  // 4. IPR limit per surface (<= 0.25 mm)
  const iprInput = h('input', {
    type: 'number',
    id: 'cond_ipr_limit',
    class: 'form-input',
    min: '0',
    max: '0.25',
    step: '0.01',
    value: String(currentConstraints.ipr_limit_mm ?? 0.25)
  });
  const iprGroup = h('div', { class: 'form-group' }, [
    h('label', { for: 'cond_ipr_limit', class: 'form-label' }, SIDEBAR_VOCAB.conditions.iprLimit),
    iprInput,
    h('span', { class: 'form-hint' }, SIDEBAR_VOCAB.conditions.iprLimitHint)
  ]);
  formEl.appendChild(iprGroup);

  // 5. Stage cap (positive integer or blank)
  const capInput = h('input', {
    type: 'number',
    id: 'cond_stage_cap',
    class: 'form-input',
    min: '1',
    step: '1',
    placeholder: SIDEBAR_VOCAB.conditions.stageCapPlaceholder,
    value: currentConstraints.stage_cap != null ? String(currentConstraints.stage_cap) : ''
  });
  const capGroup = h('div', { class: 'form-group' }, [
    h('label', { for: 'cond_stage_cap', class: 'form-label' }, SIDEBAR_VOCAB.conditions.stageCap),
    capInput,
    h('span', { class: 'form-hint' }, SIDEBAR_VOCAB.conditions.stageCapHint)
  ]);
  formEl.appendChild(capGroup);

  // 6. Movement Order
  const orderSelect = h('select', {
    id: 'cond_order',
    class: 'form-select'
  }, [
    h('option', { value: 'simultaneous', selected: currentConstraints.order === 'simultaneous' }, SIDEBAR_VOCAB.conditions.orderSimultaneous),
    h('option', { value: 'anterior_first', selected: currentConstraints.order === 'anterior_first' }, SIDEBAR_VOCAB.conditions.orderAnteriorFirst),
    h('option', { value: 'sequential', selected: currentConstraints.order === 'sequential' }, SIDEBAR_VOCAB.conditions.orderSequential)
  ]);
  const orderGroup = h('div', { class: 'form-group' }, [
    h('label', { for: 'cond_order', class: 'form-label' }, SIDEBAR_VOCAB.conditions.order),
    orderSelect,
    h('span', { class: 'form-hint' }, SIDEBAR_VOCAB.conditions.orderHint)
  ]);
  formEl.appendChild(orderGroup);

  // Error feedback element
  const errorBox = h('div', { class: 'conditions-error-box', hidden: true });
  formEl.appendChild(errorBox);

  bodyEl.appendChild(formEl);
  panelRoot.appendChild(bodyEl);

  // Footer: 46px recalculate button
  const recalcBtn = h('button', {
    type: 'button',
    class: 'btn-calculate-conditions',
    onClick: handleRecalculate
  }, SIDEBAR_VOCAB.conditions.recalculate);

  const footerEl = h('div', { class: 'conditions-footer' }, [recalcBtn]);
  panelRoot.appendChild(footerEl);

  container.appendChild(panelRoot);

  async function handleRecalculate() {
    errorBox.hidden = true;
    errorBox.textContent = '';

    if (!caseId) {
      errorBox.textContent = SIDEBAR_VOCAB.conditions.errorNoCase;
      errorBox.hidden = false;
      return;
    }

    const currentFormValues = {
      allow_extraction: extCheck.checked,
      lock: normalizeToothList(lockInput.value),
      ipr_exclude: normalizeToothList(exclInput.value),
      ipr_limit_mm: iprInput.value === '' ? 0.25 : Math.min(0.25, Math.max(0, Number(iprInput.value))),
      stage_cap: capInput.value.trim() === '' ? null : Number(capInput.value.trim()),
      order: orderSelect.value
    };

    if (currentFormValues.stage_cap !== null && (!Number.isInteger(currentFormValues.stage_cap) || currentFormValues.stage_cap < 1)) {
      errorBox.textContent = SIDEBAR_VOCAB.conditions.errorStageCapPositiveInt;
      errorBox.hidden = false;
      return;
    }

    const parentPlanId = planId(currentPlan);
    const diff = calculateConditionDiff(currentFormValues, currentPlan?.constraints);

    const payload = {
      case_id: caseId,
      ...diff
    };
    if (parentPlanId) {
      payload.parent_plan_id = parentPlanId;
    }

    recalcBtn.disabled = true;
    recalcBtn.textContent = SIDEBAR_VOCAB.conditions.recalculating;

    try {
      const res = await ctx.api.rulePlan(payload);

      // Fetch fresh plans list
      const plansRes = await ctx.api.listPlans(caseId);
      const updatedPlans = plansRes?.plans || plansRes || [];

      const newViewingId = resolveCreatedPlanId(res, updatedPlans);
      const newViewingPlan = newViewingId && typeof ctx.api.getPlan === 'function'
        ? await ctx.api.getPlan(newViewingId)
        : null;

      ctx.store.set({
        plans: updatedPlans,
        viewingPlanId: newViewingId,
        viewingPlan: newViewingPlan,
        stageIndex: 0
      });
    } catch (err) {
      errorBox.textContent = SIDEBAR_VOCAB.conditions.calculateFailed(err.message || T.errors.requestFailed);
      errorBox.hidden = false;
    } finally {
      recalcBtn.disabled = false;
      recalcBtn.textContent = SIDEBAR_VOCAB.conditions.recalculate;
    }
  }
}
