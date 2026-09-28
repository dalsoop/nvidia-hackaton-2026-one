// Validation sweep (시연 연출): while the rule-check tool (규칙 검증) runs, the crowns light one after another along the
// arch (17 → 27 and back, 60 ms each) in a faint shade of the selection green. The tool event names no tooth, so the
// sweep itself is staging; what it lands on is not: at the tool's end the plan's own violations decide —
//   none → every crown glows green once (300 ms) and settles;  some → those crowns stay red until the next stage move,
//   another plan or another case (clear()).
// No new material: it writes the emissive the selection highlight uses (applyStage / renderSelection), every frame from
// tick() in the render loop, over what applyStage wrote. prefers-reduced-motion: no sweep, only the end state.
const STEP = 0.06, FLASH = 0.3;                    // s
const SEL_HEX = 0x5a9400, RED_HEX = 0x8a1212;      // SEL_HEX: state.selected's emissive (app.js)
const now = () => performance.now() / 1000;

export function createValidateSweep({ state }) {
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sweep = null, flash = null, red = null;       // red: { ids, planId }
  const base = (id) => (state.selected.has(id) ? SEL_HEX : 0x000000);
  const shown = () => (state.archOrder.length ? state.archOrder : Object.keys(state.teeth)).filter((id) => state.teeth[id]?.visible);

  function start() {
    red = null; flash = null;
    sweep = still() ? null : { t0: now() };
  }
  // violations: the plan's (null when it could not be read: the sweep just stops); planId: the plan they belong to
  function end(violations, planId = null) {
    sweep = null;
    if (!violations) return settle();
    const ids = [...new Set(violations.flatMap((v) => (v.teeth ?? []).map(String)))].filter((id) => state.teeth[id]);
    if (violations.length && ids.length) { red = { ids: new Set(ids), planId }; flash = null; }
    else if (!violations.length) { red = null; flash = still() ? null : { t0: now() }; }
    settle();
  }
  function clear() { if (!red && !sweep && !flash) return; red = null; sweep = null; flash = null; settle(); }
  // back to what applyStage wrote, for the frame after the last override
  function settle() {
    for (const [id, m] of Object.entries(state.teeth)) m.material.emissive.setHex(red?.ids.has(id) ? RED_HEX : base(id));
  }

  function tick() {
    if (!sweep && !flash && !red) return;
    const t = now();
    if (flash && t - flash.t0 >= FLASH) { flash = null; settle(); }
    for (const [id, m] of Object.entries(state.teeth)) {
      if (red?.ids.has(id)) { m.material.emissive.setHex(RED_HEX); continue; }
      m.material.emissive.setHex(base(id));
    }
    if (flash) {
      const k = Math.sin(((t - flash.t0) / FLASH) * Math.PI);
      for (const id of shown()) state.teeth[id].material.emissive.setHex(SEL_HEX).multiplyScalar(Math.max(k, base(id) ? 1 : 0));
    }
    if (sweep) {
      // ping-pong along the arch: 0 … n-1 … 0; the lit crown at about half the selection green
      const ids = shown(), n = ids.length;
      if (n) {
        const i = Math.floor((t - sweep.t0) / STEP), period = Math.max(1, 2 * n - 2), p = i % period, at = p < n ? p : period - p;
        const lit = state.teeth[ids[at]].material.emissive;
        if (!state.selected.has(ids[at])) lit.setHex(SEL_HEX).multiplyScalar(0.55);
      }
    }
  }

  return { start, end, clear, tick, get planId() { return red?.planId ?? null; }, get running() { return !!sweep; } };
}
