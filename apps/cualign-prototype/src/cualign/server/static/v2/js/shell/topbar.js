// Topbar component: logo and current patient/case navigation

import { clear, h } from '../ui/dom.js';
import { T } from '../domain/vocab.js';
import { isPatientCase, isScanConfirmed, sampleCaseNumber } from '../domain/status.js';

export function renderTopbar(el, ctx = {}) {
  clear(el);

  const logo = h('a', { class: 'topbar-logo', href: '#/cases' },
    'cu',
    h('span', { class: 'topbar-logo-accent' }, 'Align')
  );

  const spacer = h('div', { class: 'topbar-spacer' });

  const actions = [];
  const state = ctx.store ? ctx.store.get() : {};

  if (state.caseId) {
    const fallbackLabel = isPatientCase(state.caseId, state.patients)
      ? state.caseId
      : sampleCaseNumber(state.caseId);
    const isUnconfirmedPatient = isPatientCase(state.caseId, state.patients) &&
      !isScanConfirmed(state.currentScan);
    const caseBtn = h('a', {
      class: 'topbar-case-btn',
      href: isUnconfirmedPatient
        ? `#/check/${encodeURIComponent(state.caseId)}`
        : `#/workspace/${encodeURIComponent(state.caseId)}`
    }, state.caseDisplayId || state.caseTitle || fallbackLabel);
    actions.push(caseBtn);
  }

  const newPatientBtn = h('a', {
    class: 'btn',
    href: '#/patients/new'
  }, T.topbar.newPatient);
  actions.push(newPatientBtn);

  el.appendChild(logo);
  el.appendChild(spacer);
  for (const act of actions) {
    el.appendChild(act);
  }

  return el;
}
