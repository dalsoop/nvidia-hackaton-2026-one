// Cases list screen orchestrator: mounts filter panel, table list, and detail panel

import { clear, h } from '../../ui/dom.js';
import { TCases } from '../../domain/vocab/cases.js';
import {
  countByKind,
  countByStatus,
  filterCases,
  sortCases,
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
  let currentSortBy = 'default';
  let currentSortOrder = 'asc';
  let selectedCaseId = params?.caseId || null;
  const checkCache = new Map();
  const checkErrorCache = new Map();
  const checkPending = new Set();

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

    const sorted = sortCases(filtered, {
      sortBy: currentSortBy,
      order: currentSortOrder
    });

    const statusCounts = countByStatus(allCases);
    const kindCounts = countByKind(allCases);
    const selectedCase = getSelectedCase();

    if (selectedCase && ctx.store) {
      const state = ctx.store.get();
      if (state.caseDisplayId !== selectedCase.displayId || state.currentScan !== selectedCase.scan) {
        ctx.store.set({
          caseId: selectedCase.case_id,
          caseDisplayId: selectedCase.displayId,
          caseTitle: selectedCase.displayTitle,
          currentScan: selectedCase.scan
        });
      }
    }

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
      cases: sorted,
      selectedCaseId,
      onCaseSelect: (caseId) => {
        ctx.navigate(`#/cases/${encodeURIComponent(caseId)}`);
      },
      onSort: (colKey) => {
        if (currentSortBy === colKey) {
          currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
        } else {
          currentSortBy = colKey;
          currentSortOrder = 'asc';
        }
        updateView();
      }
    });

    const checkData = selectedCaseId ? checkCache.get(selectedCaseId) : null;
    const checkError = selectedCaseId ? checkErrorCache.get(selectedCaseId) : null;
    renderDetail(detailEl, {
      selectedCase,
      checkData,
      checkError,
      onClose: () => {
        ctx.navigate('#/cases');
      },
      onNavigate: (route) => {
        if (ctx.navigate) {
          ctx.navigate(route);
        }
      }
    });
  }

  async function ensureCheckData(caseId) {
    if (!caseId || checkCache.has(caseId) || checkPending.has(caseId)) {
      return;
    }
    checkPending.add(caseId);
    try {
      const data = await ctx.api.caseCheck(caseId);
      if (isMounted) {
        checkCache.set(caseId, data);
        if (selectedCaseId === caseId) {
          updateView();
        }
      }
    } catch (err) {
      if (isMounted) {
        checkCache.set(caseId, null);
        checkErrorCache.set(caseId, err?.message || TCases.requestFailed);
        if (selectedCaseId === caseId) {
          updateView();
        }
      }
    } finally {
      checkPending.delete(caseId);
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

      ensureCheckData(selectedCaseId);
      updateView();
    } catch (err) {
      if (!isMounted) {
        return;
      }
      clear(root);
      const errMsg = err?.message || TCases.serverError;
      const errorBox = h('div', { class: 'cases-error-box' }, errMsg);
      root.appendChild(errorBox);
    }
  }

  // Selecting or closing a case only changes the hash; the router calls
  // update() instead of remounting, so the list is not fetched again.
  function update(nextParams) {
    selectedCaseId = nextParams?.caseId || null;
    ensureCheckData(selectedCaseId);
    updateView();
  }

  loadData();

  const unmount = () => {
    isMounted = false;
    clear(root);
  };
  unmount.update = update;
  return unmount;
}
