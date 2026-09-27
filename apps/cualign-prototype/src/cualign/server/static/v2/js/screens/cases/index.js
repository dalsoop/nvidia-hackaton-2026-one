// Cases list screen orchestrator: mounts filter panel, table list, and detail panel

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import {
  countByKind,
  countByStatus,
  filterCases,
  transformCasesData
} from './data.js';
import { renderFilters } from './filters.js';
import { renderCaseList } from './list.js';
import { renderDetail } from './detail.js';

export function mount(root, params, ctx) {
  clear(root);

  let isMounted = true;
  let allCases = [];
  let currentStatus = 'all';
  let currentKind = 'all';
  let selectedCaseId = params.caseId || null;
  const checkCache = new Map();

  // Root screen container
  const screenEl = h('div', { class: 'screen-cases' });
  const filtersEl = h('aside', { class: 'cases-panel-filters' });
  const listEl = h('section', { class: 'cases-panel-list' });
  const detailEl = h('aside', { class: 'cases-panel-detail' });

  screenEl.appendChild(filtersEl);
  screenEl.appendChild(listEl);
  screenEl.appendChild(detailEl);
  root.appendChild(screenEl);

  function getSelectedCase() {
    if (!selectedCaseId) {
      return null;
    }
    return allCases.find((c) => c.case_id === selectedCaseId) || null;
  }

  function updateView() {
    if (!isMounted) {
      return;
    }

    const filtered = filterCases(allCases, {
      statusFilter: currentStatus,
      kindFilter: currentKind
    });

    const statusCounts = countByStatus(allCases);
    const kindCounts = countByKind(allCases);
    const selectedCase = getSelectedCase();

    if (selectedCase) {
      screenEl.classList.remove('cases-detail-closed');
    } else {
      screenEl.classList.add('cases-detail-closed');
    }

    renderFilters(filtersEl, {
      statusCounts,
      kindCounts,
      currentStatus,
      currentKind,
      onStatusSelect: (statusId) => {
        currentStatus = statusId;
        updateView();
      },
      onKindSelect: (kindId) => {
        currentKind = kindId;
        updateView();
      }
    });

    renderCaseList(listEl, {
      cases: filtered,
      selectedCaseId,
      onCaseSelect: (caseId) => {
        selectedCaseId = caseId;
        if (ctx.store) {
          ctx.store.set({ caseId });
        }
        if (ctx.navigate) {
          ctx.navigate(`#/cases/${encodeURIComponent(caseId)}`);
        }
        ensureCheckData(caseId);
        updateView();
      }
    });

    const checkData = selectedCaseId ? checkCache.get(selectedCaseId) : null;
    renderDetail(detailEl, {
      selectedCase,
      checkData,
      onClose: () => {
        selectedCaseId = null;
        if (ctx.navigate) {
          ctx.navigate('#/cases');
        }
        updateView();
      },
      onNavigate: (route) => {
        if (ctx.navigate) {
          ctx.navigate(route);
        }
      }
    });
  }

  async function ensureCheckData(caseId) {
    if (!caseId || checkCache.has(caseId)) {
      return;
    }
    try {
      const data = await ctx.api.caseCheck(caseId);
      if (isMounted) {
        checkCache.set(caseId, data);
        if (selectedCaseId === caseId) {
          updateView();
        }
      }
    } catch {
      if (isMounted) {
        checkCache.set(caseId, null);
      }
    }
  }

  async function loadData() {
    try {
      const [casesRes, patientsRes, plansRes] = await Promise.all([
        ctx.api.listCases(),
        ctx.api.listPatients(),
        ctx.api.listPlans()
      ]);

      if (!isMounted) {
        return;
      }

      allCases = transformCasesData({
        casesData: casesRes,
        patientsData: patientsRes,
        plansData: plansRes
      });

      if (ctx.store) {
        ctx.store.set({ cases: allCases });
      }

      if (params.caseId) {
        selectedCaseId = params.caseId;
      } else if (allCases.length > 0 && !selectedCaseId) {
        selectedCaseId = allCases[0].case_id;
      }

      if (selectedCaseId) {
        if (ctx.store) {
          ctx.store.set({ caseId: selectedCaseId });
        }
        ensureCheckData(selectedCaseId);
      }

      updateView();
    } catch (err) {
      if (!isMounted) {
        return;
      }
      clear(root);
      const errMsg = err?.message || T.errors.server;
      const errorBox = h('div', { class: 'cases-error-box' }, errMsg);
      root.appendChild(errorBox);
    }
  }

  loadData();

  return () => {
    isMounted = false;
    clear(root);
  };
}
