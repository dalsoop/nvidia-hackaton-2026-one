// Table and list view component for cases screen

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { formatPlanSummary, formatViolations } from './data.js';

function getStatusBadgeClass(status) {
  switch (status) {
    case 'scan_check':
      return 'badge badge-scan-check';
    case 'needs_plan':
      return 'badge badge-needs-plan';
    case 'violation':
      return 'badge badge-violation';
    case 'ready':
      return 'badge badge-ready';
    case 'approved':
      return 'badge badge-approved';
    default:
      return 'badge';
  }
}

export function renderCaseList(container, {
  cases = [],
  selectedCaseId = null,
  onCaseSelect = () => {}
} = {}) {
  clear(container);

  // Top header with title and total count
  const titleRow = h('div', { class: 'cases-list-header-row' },
    h('h1', { class: 'cases-list-title' }, T.cases.title),
    h('span', { class: 'cases-list-count' }, String(cases.length))
  );

  const tableContainer = h('div', { class: 'cases-table-container' });

  // Grid header row
  const tableHeader = h('div', { class: 'cases-table-header' },
    h('span', null, T.cases.colCase),
    h('span', null, T.cases.colStatus),
    h('span', null, T.cases.colPlan),
    h('span', null, T.cases.colViolation),
    h('span', null, T.cases.colPlansCount),
    h('span', null, T.cases.colPrescription)
  );

  tableContainer.appendChild(tableHeader);

  if (cases.length === 0) {
    const emptyRow = h('div', { class: 'cases-table-empty' }, T.errors.notFound);
    tableContainer.appendChild(emptyRow);
  } else {
    for (const c of cases) {
      const isSelected = selectedCaseId === c.case_id;
      const statusLabel = T.status[c.status] || c.status;
      const badgeCls = getStatusBadgeClass(c.status);
      const planText = formatPlanSummary(c.preferredPlan);
      const violText = formatViolations(c, c.preferredPlan);
      const nPlans = String(c.plans ? c.plans.length : 0);

      const row = h('div', {
        class: ['cases-table-row', isSelected ? 'cases-row-selected' : ''].filter(Boolean),
        onClick: () => onCaseSelect(c.case_id)
      },
        h('div', { class: 'cases-cell-identity' },
          h('span', { class: 'cases-cell-id' }, c.displayId),
          h('span', { class: 'cases-cell-title' }, c.displayTitle)
        ),
        h('div', null,
          h('span', { class: badgeCls }, statusLabel)
        ),
        h('div', { class: 'cases-cell-plan' }, planText),
        h('div', { class: 'cases-cell-viol' }, violText),
        h('div', { class: 'cases-cell-nplans' }, nPlans),
        h('div', { class: 'cases-cell-rx' }, c.prescription)
      );

      tableContainer.appendChild(row);
    }
  }

  container.appendChild(titleRow);
  container.appendChild(tableContainer);

  return container;
}
