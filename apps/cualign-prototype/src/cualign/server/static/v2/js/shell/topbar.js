// Topbar component: logo and current patient/case navigation

import { clear, h } from '../ui/dom.js';
import { T } from '../domain/vocab.js';

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
    const caseBtn = h('a', {
      class: 'topbar-case-btn',
      href: `#/workspace/${encodeURIComponent(state.caseId)}`
    }, state.caseId);
    actions.push(caseBtn);
  }

  const newPatientBtn = h('a', {
    class: 'btn',
    href: '#/patients'
  }, T.topbar.newPatient);
  actions.push(newPatientBtn);

  el.appendChild(logo);
  el.appendChild(spacer);
  for (const act of actions) {
    el.appendChild(act);
  }

  return el;
}
