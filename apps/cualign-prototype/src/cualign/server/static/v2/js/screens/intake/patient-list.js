// Left panel of the intake screen: patient count, new patient form, patient cards.
// The form is built once so typed values survive list refreshes and errors.

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { INTAKE_TEXTS } from '../../domain/vocab/intake.js';

const ALIAS_MAX_LENGTH = 40;
const MEMO_MAX_LENGTH = 200;

export function formatPatientDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 16).replace('T', ' ');
}

function patientCard(patient, isSelected, onSelect) {
  const scansCount = T.itemsCount(patient.n_scans ?? patient.scans?.length ?? 0);
  return h('button', {
    type: 'button',
    class: ['intake-patient-card', isSelected ? 'intake-patient-card-active' : ''],
    onClick: () => onSelect(patient.patient_id)
  },
    h('div', { class: 'intake-card-top' },
      h('span', { class: 'intake-card-alias' }, patient.alias),
      h('span', { class: 'intake-card-id' }, patient.patient_id)
    ),
    h('div', { class: 'intake-card-bottom' },
      h('span', { class: 'intake-card-meta' }, INTAKE_TEXTS.scanCountText(scansCount)),
      h('span', { class: 'intake-card-date' }, formatPatientDate(patient.created_at))
    )
  );
}

export function createPatientList(container, { onCreate, onSelect }) {
  clear(container);

  const count = h('span', { class: 'panel-subtitle' });
  const header = h('div', { class: 'panel-header intake-list-header' },
    h('h3', { class: 'panel-title' }, INTAKE_TEXTS.patientListTitle),
    count
  );

  const aliasInput = h('input', {
    type: 'text', class: 'intake-input', name: 'alias',
    placeholder: INTAKE_TEXTS.aliasPlaceholder, maxlength: ALIAS_MAX_LENGTH,
    autocomplete: 'off', required: true
  });
  const memoInput = h('input', {
    type: 'text', class: 'intake-input', name: 'memo',
    placeholder: INTAKE_TEXTS.memoPlaceholder, maxlength: MEMO_MAX_LENGTH,
    autocomplete: 'off'
  });
  const formError = h('div', { class: 'intake-form-error', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary intake-submit-btn' }, INTAKE_TEXTS.submitNewPatient);

  function setFormError(message) {
    formError.textContent = message || '';
    formError.hidden = !message;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const alias = aliasInput.value.trim();
    if (!alias) {
      setFormError(INTAKE_TEXTS.aliasRequired);
      return;
    }
    setFormError('');
    submit.disabled = true;
    try {
      await onCreate(alias, memoInput.value.trim());
      aliasInput.value = '';
      memoInput.value = '';
    } catch (err) {
      setFormError(err?.message || T.errors.requestFailed);
    } finally {
      submit.disabled = false;
    }
  }

  const form = h('form', { class: 'intake-patient-form', onSubmit: handleSubmit },
    h('div', { class: 'intake-form-title' }, INTAKE_TEXTS.newPatientTitle),
    aliasInput, memoInput, formError, submit
  );
  const items = h('div', { class: 'intake-patient-items' });
  container.append(header, form, items);

  return {
    render({ patients = [], selectedPid = null } = {}) {
      count.textContent = T.itemsCount(patients.length);
      clear(items);
      if (!patients.length) {
        items.appendChild(h('div', { class: 'intake-patient-empty' }, INTAKE_TEXTS.noPatients));
        return;
      }
      for (const patient of patients) {
        items.appendChild(patientCard(patient, patient.patient_id === selectedPid, onSelect));
      }
    }
  };
}
