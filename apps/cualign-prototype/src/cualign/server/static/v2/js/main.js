// Application entry point: hash router, layout shell mounting, lifecycle management

import { createStore } from './state/store.js';
const api = await import(['.', 'api', 'endpoints.js'].join('/'));
import { renderTopbar } from './shell/topbar.js';
import { renderRail } from './shell/rail.js';

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

function matchRoute(hash) {
  const normalized = hash && hash.startsWith('#/') ? hash : '#/cases';
  const pathParts = normalized.split('/');

  for (const route of ROUTES) {
    const routeParts = route.pattern.split('/');
    if (pathParts.length !== routeParts.length) {
      continue;
    }
    const params = {};
    let matched = true;

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        const paramName = routeParts[i].slice(1);
        params[paramName] = decodeURIComponent(pathParts[i]);
      } else if (routeParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { route, params };
    }
  }

  return {
    route: ROUTES[0],
    params: {}
  };
}

export function initApp() {
  const topbarEl = document.getElementById('topbar');
  const railEl = document.getElementById('rail');
  const screenEl = document.getElementById('screen');

  const store = createStore();
  let currentUnmount = null;

  function navigate(path) {
    window.location.hash = path.startsWith('#') ? path : `#${path}`;
  }

  const ctx = {
    store,
    api,
    navigate
  };

  function updateShell(navConfig, params) {
    if (params.caseId) {
      store.set({ caseId: params.caseId });
    }

    renderTopbar(topbarEl, ctx);

    const kind = navConfig.kind || (params.caseId && params.caseId.includes('-') ? 'patient' : 'sample');
    renderRail(railEl, {
      active: navConfig.active || 'cases',
      kind,
      confirmed: Boolean(store.get().confirmed),
      stage: store.get().stage || 'none'
    });
  }

  function handleRoute() {
    const { route, params } = matchRoute(window.location.hash);

    if (currentUnmount) {
      currentUnmount();
      currentUnmount = null;
    }

    updateShell(route.nav, params);

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
