// Filter sidebar component for cases screen

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { LABEL_ALL } from './data.js';

const STATUS_ITEMS = Object.freeze([
  { id: 'all', labelKey: null, labelFallback: LABEL_ALL, dotClass: 'cases-dot-all' },
  { id: 'scan_check', labelKey: 'scan_check', dotClass: 'cases-dot-scan' },
  { id: 'needs_plan', labelKey: 'needs_plan', dotClass: 'cases-dot-noplan' },
  { id: 'violation', labelKey: 'violation', dotClass: 'cases-dot-violation' },
  { id: 'ready', labelKey: 'ready', dotClass: 'cases-dot-ready' },
  { id: 'approved', labelKey: 'approved', dotClass: 'cases-dot-approved' }
]);

const KIND_ITEMS = Object.freeze([
  { id: 'all', label: LABEL_ALL },
  { id: 'sample', label: T.cases.sample },
  { id: 'patient', label: T.cases.anonymizedPatient }
]);

export function renderFilters(container, {
  statusCounts = {},
  kindCounts = {},
  currentStatus = 'all',
  currentKind = 'all',
  onStatusSelect = () => {},
  onKindSelect = () => {}
} = {}) {
  clear(container);

  const title = h('h2', { class: 'cases-filters-title' }, T.cases.filter);

  // Status section
  const statusHeader = h('div', { class: 'cases-filters-section-title' }, T.cases.filterStatus);
  const statusList = h('div', { class: 'cases-filters-list' });

  for (const item of STATUS_ITEMS) {
    const label = item.labelKey ? T.status[item.labelKey] : item.labelFallback;
    const count = statusCounts[item.id] ?? 0;
    const isActive = currentStatus === item.id;

    const row = h('div', {
      class: ['cases-filter-item', isActive ? 'cases-filter-item-active' : ''].filter(Boolean),
      onClick: () => onStatusSelect(item.id)
    },
      h('span', { class: 'cases-filter-item-left' },
        h('span', { class: ['cases-dot', item.dotClass] }),
        label
      ),
      h('span', { class: 'cases-filter-count' }, String(count))
    );
    statusList.appendChild(row);
  }

  // Kind section
  const kindHeader = h('div', { class: 'cases-filters-section-title' }, T.cases.filterKind);
  const kindList = h('div', { class: 'cases-filters-list' });

  for (const item of KIND_ITEMS) {
    const count = item.id === 'all' ? kindCounts.all ?? 0 : (kindCounts[item.id] ?? 0);
    const isActive = currentKind === item.id;

    const row = h('div', {
      class: ['cases-filter-item', isActive ? 'cases-filter-item-active' : ''].filter(Boolean),
      onClick: () => onKindSelect(item.id)
    },
      h('span', null, item.label),
      h('span', { class: 'cases-filter-count' }, String(count))
    );
    kindList.appendChild(row);
  }

  container.appendChild(title);
  container.appendChild(h('div', { class: 'cases-filters-section' }, statusHeader, statusList));
  container.appendChild(h('div', { class: 'cases-filters-section' }, kindHeader, kindList));

  return container;
}
