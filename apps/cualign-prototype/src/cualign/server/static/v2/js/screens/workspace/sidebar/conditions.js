// Conditions form & diff calculation for workspace right sidebar (J8 contract)

import { clear, h } from '../../../ui/dom.js';
import { fdiToUniversal, universalToFdi } from '../../../domain/teeth.js';
import { T } from '../../../domain/vocab.js';
import { SIDEBAR_VOCAB } from '../../../domain/vocab/sidebar.js';
import { preferredPlan } from '../../../domain/status.js';

export const DEFAULT_CONSTRAINTS = Object.freeze({
  allow_extraction: false,
  lock: [],
  ipr_exclude: [],
  ipr_limit_mm: 0.25,
  stage_cap: null,
  order: 'simultaneous'
});

const PATIENT_CASE_RE = /^P\d+-S\d+$/;

/**
 * Normalizes an array or string of tooth numbers into sorted, unique Universal teeth (2..15).
 * Supports both Universal (2..15) and FDI (11..28) notations.
 *
 * @param {Array|string} teeth - Input teeth
 * @returns {Array<number>} Sorted unique Universal tooth numbers
 */
export function normalizeToothList(teeth) {
  if (!teeth) return [];
  let rawItems = [];

  if (typeof teeth === 'string') {
    rawItems = teeth.split(/[, \s]+/).filter(Boolean);
  } else if (Array.isArray(teeth)) {
    rawItems = teeth;
  } else {
    return [];
  }

  const result = [];
  for (const item of rawItems) {
    const n = Number(item);
    if (!Number.isInteger(n)) continue;

    // If FDI number (> 16, e.g. 11..28), convert to Universal
    const u = n > 16 ? fdiToUniversal(n) : n;
    if (u !== null && u >= 2 && u <= 15) {
      result.push(u);
    }
  }

  return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * Compares two tooth lists for equality regardless of original ordering or duplication.
 */
function areTeethEqual(a, b) {
  const normA = normalizeToothList(a);
  const normB = normalizeToothList(b);
  if (normA.length !== normB.length) return false;
  return normA.every((val, idx) => val === normB[idx]);
}

/**
 * Calculate the changed constraint fields between current form values and base constraints.
 * Returns only the changed fields, handling clear_stage_cap when stage_cap is set to null.
 *
 * @param {Object} current - Form input values
 * @param {Object} [base] - Base plan constraints (or default constraints)
 * @returns {Object} Changed constraint fields
 */
export function calculateConditionDiff(current = {}, base = null) {
  const diff = {};
  const b = base || DEFAULT_CONSTRAINTS;

  // 1. allow_extraction
  if (current.allow_extraction !== undefined && current.allow_extraction !== null) {
    const curVal = Boolean(current.allow_extraction);
    const baseVal = Boolean(b.allow_extraction);
    if (curVal !== baseVal) {
      diff.allow_extraction = curVal;
    }
  }

  // 2. lock
  if (current.lock !== undefined && current.lock !== null) {
    if (!areTeethEqual(current.lock, b.lock)) {
      diff.lock = normalizeToothList(current.lock);
    }
  }

  // 3. ipr_exclude
  if (current.ipr_exclude !== undefined && current.ipr_exclude !== null) {
    if (!areTeethEqual(current.ipr_exclude, b.ipr_exclude)) {
      diff.ipr_exclude = normalizeToothList(current.ipr_exclude);
    }
  }

  // 4. ipr_limit_mm (<= 0.25)
  if (current.ipr_limit_mm !== undefined && current.ipr_limit_mm !== null && current.ipr_limit_mm !== '') {
    const curIpr = Math.min(0.25, Math.max(0, Number(current.ipr_limit_mm)));
    const baseIpr = b.ipr_limit_mm !== undefined && b.ipr_limit_mm !== null ? Number(b.ipr_limit_mm) : 0.25;
    if (Math.abs(curIpr - baseIpr) > 1e-6) {
      diff.ipr_limit_mm = curIpr;
    }
  }

  // 5. stage_cap and clear_stage_cap
  if (current.clear_stage_cap === true) {
    if (b.stage_cap !== null && b.stage_cap !== undefined) {
      diff.clear_stage_cap = true;
    }
  } else if (current.stage_cap !== undefined) {
    const curCap = current.stage_cap === '' || current.stage_cap === null ? null : Number(current.stage_cap);
    const baseCap = b.stage_cap === '' || b.stage_cap === null ? null : Number(b.stage_cap);

    if (curCap !== baseCap) {
      if (curCap === null) {
        diff.clear_stage_cap = true;
      } else {
        diff.stage_cap = curCap;
      }
    }
  }

  // 6. order ('simultaneous' | 'anterior_first' | 'sequential')
  if (current.order !== undefined && current.order !== null) {
    const curOrder = String(current.order);
    const baseOrder = b.order ? String(b.order) : 'simultaneous';
    if (curOrder !== baseOrder) {
      diff.order = curOrder;
    }
  }

  return diff;
}

/**
 * Render the conditions panel with form and recalculate button.
 *
 * @param {HTMLElement} container - Target container
 * @param {Object} ctx - App context
 */
export function renderConditions(container, ctx) {
  clear(container);

  const state = ctx.store.get();
  const plans = state.plans || [];
  const currentPlan = (state.viewingPlanId && plans.find(p => (p.plan_id || p.id) === state.viewingPlanId))
    || state.viewingPlan
    || preferredPlan(plans)
    || plans[0]
    || null;

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

    if (!prescriptionText && typeof ctx.api?.listCases === 'function' && caseId) {
      ctx.api.listCases().then((res) => {
        const list = res?.cases || res || [];
        const found = list.find(c => (c.case_id || c.id) === caseId);
        if (found && (found.prescription || found.prescription_text)) {
          ctx.store.set({ cases: list, currentCase: found });
        }
      }).catch(() => {});
    }

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
    value: (currentConstraints.lock || []).join(', ')
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
    value: (currentConstraints.ipr_exclude || []).join(', ')
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

  // Footer: 46px "이 조건으로 계산" button
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

    const parentPlanId = currentPlan?.plan_id || currentPlan?.id || null;
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

      // Fetch fresh plans list: "plans 새로 받기"
      const plansRes = await ctx.api.listPlans(caseId);
      const updatedPlans = plansRes?.plans || plansRes || [];

      const newViewingId = res?.chosen?.plan_id || res?.best_failed?.plan_id || updatedPlans[0]?.plan_id || updatedPlans[0]?.id;

      ctx.store.set({
        plans: updatedPlans,
        viewingPlanId: newViewingId,
        stage: 0
      });
    } catch (err) {
      errorBox.textContent = `계산 실패: ${err.message || T.errors.requestFailed}`;
      errorBox.hidden = false;
    } finally {
      recalcBtn.disabled = false;
      recalcBtn.textContent = SIDEBAR_VOCAB.conditions.recalculate;
    }
  }
}
