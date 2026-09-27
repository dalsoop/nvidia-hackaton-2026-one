// Patient & scan intake screen orchestrator (J3 contract)
// Left 280px patient list + new patient form; Center patient header, scan list, and scan upload.
// Selecting a patient only changes the hash; the router calls update() so the
// screen (and the half-typed new patient form) is not rebuilt.

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { parsePatientCaseId } from '../../domain/status.js';
import { createPatientList } from './patient-list.js';
import { createPatientDetail } from './patient-detail.js';

export function isNewPatientRoute(pid) {
  return pid === 'new';
}

function routePid(params) {
  return isNewPatientRoute(params?.pid) ? null : (params?.pid || null);
}

export function mount(root, params, ctx) {
  clear(root);

  let isMounted = true;
  let isNewRoute = isNewPatientRoute(params?.pid);
  let patients = [];
  let selectedPid = routePid(params);
  let currentPatient = null;
  let ui = { deletingPatient: false, deletingScanId: null, error: null };
  let loadToken = 0;

  const listEl = h('aside', { class: 'panel-list intake-panel-list' });
  const mainEl = h('section', { class: 'intake-main-panel' });
  root.appendChild(h('div', { class: 'screen-intake' }, listEl, mainEl));

  const patientHref = (pid) => `#/patients/${encodeURIComponent(pid)}`;

  const list = createPatientList(listEl, {
    onSelect: (pid) => ctx.navigate(patientHref(pid)),
    onCreate: async (alias, memo) => {
      const created = await ctx.api.createPatient(alias, memo);
      await loadPatients();
      ctx.navigate(patientHref(created.patient_id));
    }
  });

  function renderMain() {
    if (!isMounted) return;
    list.render({ patients, selectedPid });
    if (currentPatient) {
      detail.showPatient(currentPatient, ui);
    } else {
      detail.showEmpty({ hasPatients: patients.length > 0, error: ui.error });
    }
  }

  function setUi(patch) {
    ui = { ...ui, ...patch };
    renderMain();
  }

  function releaseCase(matches) {
    const caseId = ctx.store.get().caseId;
    if (caseId && matches(caseId)) ctx.store.set({ caseId: null });
  }

  const detail = createPatientDetail(mainEl, {
    ctx,
    actions: {
      onAskDeletePatient: (open) => setUi({ deletingPatient: open }),
      onAskDeleteScan: (sid) => setUi({ deletingScanId: sid }),
      onDeletePatient: async () => {
        const pid = currentPatient.patient_id;
        try {
          await ctx.api.deletePatient(pid);
          releaseCase((caseId) => parsePatientCaseId(caseId)?.pid === pid);
          currentPatient = null;
          selectedPid = null;
          ui = { deletingPatient: false, deletingScanId: null, error: null };
          await loadPatients();
          ctx.navigate(patients.length ? patientHref(patients[0].patient_id) : '#/cases');
        } catch (err) {
          setUi({ error: err?.message || T.errors.requestFailed });
        }
      },
      onDeleteScan: async (sid, caseId) => {
        try {
          currentPatient = await ctx.api.deleteScan(currentPatient.patient_id, sid);
          releaseCase((id) => id === caseId);
          setUi({ deletingScanId: null, error: null });
        } catch (err) {
          setUi({ deletingScanId: null, error: err?.message || T.errors.requestFailed });
        }
      },
      onUploaded: () => loadPatient(selectedPid)
    }
  });

  async function loadPatient(pid) {
    const token = ++loadToken;
    if (!pid) {
      currentPatient = null;
      renderMain();
      return;
    }
    try {
      const patient = await ctx.api.getPatient(pid);
      if (!isMounted || token !== loadToken) return;
      currentPatient = patient;
      ui = { deletingPatient: false, deletingScanId: null, error: null };
    } catch (err) {
      if (!isMounted || token !== loadToken) return;
      currentPatient = null;
      ui = { ...ui, error: err?.message || T.errors.notFound };
    }
    renderMain();
  }

  async function loadPatients() {
    try {
      const res = await ctx.api.listPatients();
      if (!isMounted) return;
      patients = res?.patients || [];
    } catch (err) {
      if (!isMounted) return;
      ui = { ...ui, error: err?.message || T.errors.server };
    }
    renderMain();
  }

  // Without a patient in the route (and not on the new patient form) the
  // first patient opens, as a replace of the current route.
  function openDefaultPatient() {
    if (!selectedPid && !isNewRoute && patients.length) {
      ctx.navigate(patientHref(patients[0].patient_id));
      return true;
    }
    return false;
  }

  async function start() {
    await loadPatients();
    if (!isMounted || openDefaultPatient()) return;
    await loadPatient(selectedPid);
  }

  function update(nextParams) {
    isNewRoute = isNewPatientRoute(nextParams?.pid);
    const pid = routePid(nextParams);
    if (pid === selectedPid && (currentPatient || !pid)) {
      renderMain();
      return;
    }
    selectedPid = pid;
    currentPatient = null;
    ui = { deletingPatient: false, deletingScanId: null, error: null };
    renderMain();
    if (!openDefaultPatient()) loadPatient(pid);
  }

  renderMain();
  start();

  const unmount = () => {
    isMounted = false;
    loadToken += 1;
    clear(root);
  };
  unmount.update = update;
  return unmount;
}
