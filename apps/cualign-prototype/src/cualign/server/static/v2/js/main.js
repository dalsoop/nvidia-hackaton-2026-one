// Application entry point: hash router, layout shell mounting, lifecycle management

import { createStore } from './state/store.js';
import * as api from './api/endpoints.js';
import { renderTopbar } from './shell/topbar.js';
import { renderRail } from './shell/rail.js';
import { matchRoutePattern } from './shell/router.js';
import { isPatientCase, isScanConfirmed } from './domain/status.js';

import * as casesScreen from './screens/cases/index.js';
import * as patientScreen from './screens/intake/patient.js';
import * as checkScreen from './screens/intake/check.js';
import * as workspaceScreen from './screens/workspace/index.js';

export const ROUTES = [
  { pattern: '#/cases', screen: casesScreen, nav: { active: 'cases', kind: 'none' } },
  { pattern: '#/cases/:caseId', screen: casesScreen, nav: { active: 'cases', kind: 'none' } },
  { pattern: '#/patients/:pid', screen: patientScreen, nav: { active: 'intake', kind: 'patient' } },
  { pattern: '#/check/:caseId', screen: checkScreen, nav: { active: 'check', kind: 'patient' } },
  { pattern: '#/workspace/:caseId', screen: workspaceScreen, nav: { active: 'workspace' } }
];

function resolveKind(navConfig, caseId) {
  if (navConfig && navConfig.kind) {
    return navConfig.kind;
  }
  if (caseId) {
    return isPatientCase(caseId) ? 'patient' : 'sample';
  }
  return 'none';
}

export function matchRoute(hash) {
  return matchRoutePattern(ROUTES, hash);
}

export function initApp() {
  const topbarEl = document.getElementById('topbar');
  const railEl = document.getElementById('rail');
  const screenEl = document.getElementById('screen');

  const store = createStore();
  let currentUnmount = null;
  let currentNavConfig = { active: 'cases', kind: 'none' };
  let currentParams = {};

  function navigate(path) {
    window.location.hash = path.startsWith('#') ? path : `#${path}`;
  }

  const ctx = {
    store,
    api,
    navigate
  };

  function renderShell() {
    const state = store.get();
    const caseId = currentParams.caseId || state.caseId;
    const kind = currentNavConfig.kind || (caseId
      ? (isPatientCase(caseId, state.patients) ? 'patient' : 'sample')
      : resolveKind(currentNavConfig, caseId));

    renderTopbar(topbarEl, ctx);
    renderRail(railEl, {
      active: currentNavConfig.active || 'cases',
      kind,
      confirmed: isScanConfirmed(state.currentScan),
      stage: state.railStage || 'none',
      caseId
    });
  }

  store.subscribe(renderShell);

  function handleRoute() {
    const { route, params } = matchRoute(window.location.hash);

    if (currentUnmount) {
      currentUnmount();
      currentUnmount = null;
    }

    currentNavConfig = route.nav;
    currentParams = params;

    if (params.caseId && params.caseId !== store.get().caseId) {
      store.set({
        caseId: params.caseId,
        caseDisplayId: null,
        caseTitle: null,
        currentScan: null
      });
    } else if (!params.caseId && (route.nav.active === 'intake' || route.nav.active === 'cases')) {
      store.set({
        caseId: null,
        caseDisplayId: null,
        caseTitle: null,
        currentScan: null
      });
    } else {
      renderShell();
    }

    if (route.screen && typeof route.screen.mount === 'function') {
      currentUnmount = route.screen.mount(screenEl, params, ctx);
    }
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
