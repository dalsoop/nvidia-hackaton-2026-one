// Table and list view component for cases screen

import { clear, h } from '../../ui/dom.js';
import { TCases } from '../../domain/vocab/cases.js';
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

function getStatusLabel(status) {
  switch (status) {
    case 'scan_check':
      return TCases.statusScanCheck;
    case 'needs_plan':
      return TCases.statusNeedsPlan;
    case 'violation':
      return TCases.statusViolation;
    case 'ready':
      return TCases.statusReady;
    case 'approved':
      return TCases.statusApproved;
    default:
      return status;
  }
}

export function renderCaseList(container, {
  cases = [],
  selectedCaseId = null,
  onCaseSelect = () => {},
  onSort = () => {}
} = {}) {
  clear(container);

  // Top header with title and total count
  const titleRow = h('div', { class: 'cases-list-header-row' },
    h('h1', { class: 'cases-list-title' }, TCases.cases),
    h('span', { class: 'cases-list-count' }, String(cases.length))
  );

  const tableContainer = h('div', { class: 'cases-table-container' });

  // Grid header row
  const tableHeader = h('div', { class: 'cases-table-header' },
    h('span', { class: 'cases-th-sortable', onClick: () => onSort('case') }, TCases.colCase),
    h('span', { class: 'cases-th-sortable', onClick: () => onSort('status') }, TCases.colStatus),
    h('span', null, TCases.colPlan),
    h('span', null, TCases.colViolation),
    h('span', { class: 'cases-th-sortable', onClick: () => onSort('plans') }, TCases.colPlans),
    h('span', null, TCases.colPrescription)
  );

  tableContainer.appendChild(tableHeader);

  if (cases.length === 0) {
    const emptyRow = h('div', { class: 'cases-table-empty' }, TCases.notFound);
    tableContainer.appendChild(emptyRow);
  } else {
    for (const c of cases) {
      const isSelected = selectedCaseId === c.case_id;
      const statusLabel = getStatusLabel(c.status);
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
