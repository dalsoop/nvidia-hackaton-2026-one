// Left workflow rail navigation component

import { clear, h } from '../ui/dom.js';
import { T } from '../domain/vocab.js';

function createSvg(width, height, pathD, strokeWidth = '1.7') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  return svg;
}

function createCheckSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '8');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  svg.appendChild(path);
  return svg;
}

function createLockSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '8');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3');
  svg.appendChild(path);
  return svg;
}

export function renderRail(el, { active = 'cases', kind = 'none', confirmed = false, stage = 'none', caseId = null } = {}) {
  clear(el);

  const isPatient = kind === 'patient';
  const wsHref = caseId ? `#/workspace/${encodeURIComponent(caseId)}` : '#/workspace';
  const checkHref = caseId ? `#/check/${encodeURIComponent(caseId)}` : '#/check';
  const intakeHref = caseId ? `#/patients/${encodeURIComponent(caseId.split('-')[0])}` : '#/patients';

  const allSteps = [
    { id: 'cases', label: T.rail.steps.cases, href: '#/cases', path: 'M4 6h16M4 12h16M4 18h10' },
    { id: 'intake', label: T.rail.steps.intake, href: intakeHref, path: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .6 3.4 2.3 4 5.2', patientOnly: true },
    { id: 'check', label: T.rail.steps.check, href: checkHref, path: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8.5 12l2.5 2.5 4.5-5', patientOnly: true },
    { id: 'workspace', label: T.rail.steps.workspace, href: wsHref, path: 'M5.5 19.5c-.8-5.2.3-9.8 2.5-12.3C9.1 5.9 10.5 5 12 5s2.9.9 4 2.2c2.2 2.5 3.3 7.1 2.5 12.3' },
    { id: 'approve', label: T.rail.steps.approve, href: wsHref, path: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6zM8.8 12.2l2.3 2.3 4.3-4.6' },
    { id: 'export', label: T.rail.steps.export, href: wsHref, path: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M4 17v1.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V17' }
  ];

  const defs = kind === 'none' ? allSteps.slice(0, 1) : allSteps.filter((d) => isPatient || !d.patientOnly);
  const at = defs.findIndex((d) => d.id === active);
  const planLock = { none: T.rail.lockPlan, violation: T.rail.lockViolation };

  const stateOf = (d, i) => {
    if (d.id === active) return ['current'];
    if (d.id === 'approve') {
      if (isPatient && !confirmed) return ['locked', T.rail.lockPlan];
      return stage === 'approved' ? ['done'] : stage === 'ready' ? ['open', T.rail.statusReady] : ['locked', planLock[stage] || T.rail.lockPlan];
    }
    if (d.id === 'export') return stage === 'approved' ? ['open'] : ['locked', T.rail.lockExport];
    if (isPatient && d.id === 'workspace' && !confirmed) return ['locked', T.rail.lockConfirm];
    if (isPatient && d.id === 'check' && at < 1) return ['locked', T.rail.lockScan];
    if (i < at || (isPatient && d.id === 'check' && confirmed)) return ['done'];
    return ['open'];
  };

  const states = defs.map(stateOf);

  if (kind !== 'none') {
    const kindLabel = isPatient ? T.rail.kindPatient : T.rail.kindSample;
    const kindTitle = isPatient ? T.rail.kindPatientTitle : T.rail.kindSampleTitle;
    el.appendChild(h('span', { class: 'rail-kind-tag', title: kindTitle }, kindLabel));
  }

  defs.forEach((d, i) => {
    const [st, note] = states[i];
    const prev = i > 0 ? states[i - 1][0] : null;

    if (i > 0) {
      const isLineActive = (prev === 'done' || prev === 'current') && st !== 'locked';
      el.appendChild(h('div', { class: `rail-line ${isLineActive ? 'rail-line-active' : 'rail-line-inactive'}` }));
    }

    const title = note ? T.rail.opensAfter(d.label, note) : d.label;
    const iconWrap = h('span', { class: 'rail-step-icon-wrap' }, createSvg(20, 20, d.path));

    if (st === 'done') {
      iconWrap.appendChild(h('span', { class: 'rail-step-badge-done' }, createCheckSvg()));
    } else if (st === 'locked') {
      iconWrap.appendChild(h('span', { class: 'rail-step-badge-locked' }, createLockSvg()));
    }

    const children = [
      iconWrap,
      h('span', { class: 'rail-step-label' }, d.label),
      note ? h('span', { class: 'rail-step-note' }, note) : null
    ];

    if (st === 'locked') {
      el.appendChild(h('span', { class: `rail-step rail-step-${st}`, title, 'aria-disabled': 'true' }, ...children));
    } else {
      el.appendChild(h('a', { class: `rail-step rail-step-${st}`, title, href: d.href }, ...children));
    }
  });

  return el;
}
