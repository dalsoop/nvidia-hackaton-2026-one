// Central observable state store for cuAlign UI v2

export function createStore(initial = {}) {
  let state = {
    cases: [],
    patients: [],
    plans: [],
    caseId: null,
    viewingPlanId: null,
    stage: 0,
    sidebarTab: 'stages',
    layers: {},
    chat: [],
    ...initial
  };

  const listeners = new Set();

  function get() {
    return state;
  }

  function set(patch) {
    const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
    state = next;
    for (const fn of listeners) {
      fn(state);
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  return { get, set, subscribe };
}
