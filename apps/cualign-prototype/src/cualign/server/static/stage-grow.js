// 「단계가 자라난다」 (시연 연출): while the stage tool (plan_stages) runs, the target arrangement lies as a white ghost,
// the agent's cursor (the IPR tool cursor of scan-reveal.js) touches the crowns in their order of movement and each one
// slides one step toward its ghost; once the plan is on screen the stage table fills row by row in the same rhythm, and
// the whole lands at the plan's last stage, the treatment done (the crowns glide there in 0.6 s, the ghost lifts, the
// slider at its end, ▶ blinks with 「▶ 처음부터 재생」 by the slider).
//   - order: the plan's (the crowns that move first, then the delayed ones by their start stage); before a plan exists,
//     molars to front along the arch.
//   - one round only (14 crowns × 0.5 s); a tool that runs longer keeps the cursor circling the last crown. A replay
//     plays the same round and lands (Esc or a click on the 3D chip lands at once).
//   - it writes the crowns' transforms and the ghost every frame from tick(), over what applyStage (loadPlan, the turn's
//     end) wrote, and ends at the landing. A live round runs while the agent works: the stage tool ends in about a second
//     and select_plan follows at once, so neither lands it — it lands once the turn's plan is on screen and its table has
//     filled. Only a rule check (validate) of the same turn lands it early, so its sweep never overlaps the round; a
//     replay lands before its tool rows play. A turn with no plan puts it all back.
//   - prefers-reduced-motion or ?nofx=1: nothing runs; the replay keeps its old landing (the last stage).
import { CURSOR_SVG } from "./scan-reveal.js";

const OFF = new URLSearchParams(location.search).has("nofx");
const PER = 0.5, GATHER = 0.4, LAND = 0.6, MIN_FILL = 1.2, STEP_MM = 0.25;   // s, mm
const now = () => performance.now() / 1000;
// a table row is display: contents (its cells are the grid items), so a row is shown or hidden through its cells
const cellsOf = (el) => (el.classList.contains("row") ? [...el.children] : [el]);
const showRow = (el, on) => { for (const c of cellsOf(el)) c.style.opacity = on ? "" : "0"; };
const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

export function createStageGrow({ THREE, CSS2DObject, group, ghost, state, applyStage, setWorkNote }) {
  const still = () => OFF || matchMedia("(prefers-reduced-motion: reduce)").matches;
  let run = null;
  let after = null;   // a live round that landed before its plan was on screen: { planId0, until } — the plan opens at its end

  // the crown's transform as applyStage writes it: d + c − R c, turned about z
  const place = (d, yawDeg, c) => {
    const a = (yawDeg * Math.PI) / 180;
    return { p: new THREE.Vector3(d[0] + c[0] - (Math.cos(a) * c[0] - Math.sin(a) * c[1]), d[1] + c[1] - (Math.sin(a) * c[0] + Math.cos(a) * c[1]), d[2]), r: a };
  };
  const targetOf = (id, m) => {
    const t = state.target;
    const d = t?.stages?.[0]?.[id];
    if (!d) return { p: m.position.clone(), r: m.rotation.z };   // no target turn on record: what the screen shows
    return place(d, t.rotations?.[0]?.[id] ?? 0, t.pivots?.[id] ?? [0, 0, 0]);
  };
  function orderOf(ids, plan) {
    const arch = (state.archOrder.length ? state.archOrder : Object.keys(state.teeth)).map(String).filter((id) => ids.includes(id));
    const outside = [];   // molars first from both ends, inward to the front teeth
    for (let i = 0, j = arch.length - 1; i <= j; i++, j--) { outside.push(arch[i]); if (j !== i) outside.push(arch[j]); }
    const delays = plan?.info?.delays ?? {};
    return outside.map((id, k) => [id, delays[id] ?? 0, k]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
  }

  function start({ plan = null, replay = false } = {}) {
    if (still() || !Object.keys(state.teeth).length) return false;
    stop(false);
    const ids = Object.entries(state.teeth).filter(([, m]) => m.visible).map(([id]) => id);
    const r = { t0: now(), replay, ids, order: orderOf(ids, plan), toolDone: replay, planId0: replay ? null : state.plan?.plan_id ?? null,
                plan: replay ? plan : null, screen: {}, to: {}, ghostWas: { visible: ghost.visible, kids: [] }, fill: null, land: null,
                caseId: state.meshCase, idleSince: null, resolve: null };
    for (const [id, m] of Object.entries(state.teeth)) { r.screen[id] = { p: m.position.clone(), r: m.rotation.z }; r.to[id] = targetOf(id, m); }
    // the ghost: the same crowns (buildTeeth made one per crown, in the same order) placed at the target
    Object.keys(state.teeth).forEach((id, i) => {
      const g = ghost.children[i]; if (!g) return;
      r.ghostWas.kids.push([g, g.position.clone(), g.rotation.z, g.visible]);
      g.position.copy(r.to[id].p); g.rotation.set(0, 0, r.to[id].r); g.visible = ids.includes(id);
    });
    const o = new CSS2DObject(document.createElement("div"));
    o.element.className = "ipr-tool"; o.element.innerHTML = `<i>${CURSOR_SVG}</i>`; o.element.style.opacity = "0";
    group.add(o); r.cursor = o;
    run = r;
    note();
    return true;
  }

  function note() {
    if (!run) return;
    const n = run.plan?.stages?.length ?? 0, k = run.fill ? Math.max(1, Math.round(fillAt(now()) * n)) : 0;
    setWorkNote(true, n && k ? `단계 나누는 중 · ${k}/${n}` : "단계 나누는 중");
  }
  const roundEnd = () => run.t0 + GATHER + run.order.length * PER;
  const fillAt = (t) => (run.fill ? Math.min(1, (t - run.fill.t0) / run.fill.dur) : 0);
  const stepOf = (id) => {   // one step toward the target: 1/N of the move, or 0.25 mm while N is unknown
    const n = run.plan?.stages?.length, dist = run.to[id].p.length();
    return Math.min(1, n ? 1 / n : STEP_MM / Math.max(dist, STEP_MM));
  };

  // the plan landed on screen (the live turn) or came with the replay: the table fills from now in the cursor's rhythm
  function beginFill(t) {
    run.plan ??= state.plan;
    run.order = orderOf(run.ids, run.plan);   // the plan's order for what is left of the round
    const rows = [...document.querySelectorAll("#stageGrid > .row, #stageGrid > .phase")];
    for (const el of rows) showRow(el, false);
    run.fill = { t0: t, dur: Math.max(MIN_FILL, roundEnd() - t), rows };
  }

  function tick() {
    if (!run && after) {   // the plan of the early-landed round is on screen now: its last stage and ▶, like a full landing
      if (now() > after.until) after = null;
      else if (state.plan && state.plan.plan_id !== after.planId0 && state.step === "stages") { after = null; applyStage(endStage()); atEnd(); }
    }
    if (!run) return;
    const t = now(), r = run;
    if (state.meshCase !== r.caseId) return stop(false);
    // the plan of this turn is on screen: fill, then land
    if (!r.fill && (r.replay || (state.plan && state.plan.plan_id !== r.planId0 && state.step === "stages"))) beginFill(t);
    // the turn ended with no plan (a failure, a cut turn): everything goes back
    if (!r.fill && !r.replay && !state.streaming) { r.idleSince ??= t; if (t - r.idleSince > 1.5) return stop(false); }
    if (r.fill && !r.land && fillAt(t) >= 1 && t >= roundEnd()) landNow(t);
    if (r.land) return landing(t);
    ghost.visible = true;
    note();   // the chip stays this round's while it runs (the turn's end turns the chip off: setStreaming)
    // the crowns: gathered to stage 0, then each one a step toward the ghost when the cursor touches it
    const g = ease((t - r.t0) / GATHER);
    const touched = Math.floor((t - r.t0 - GATHER) / PER);
    for (const [id, m] of Object.entries(state.teeth)) {
      const s = r.screen[id], k = r.order.indexOf(id);
      let u = 0;
      if (k >= 0 && k <= touched) u = stepOf(id) * ease((t - r.t0 - GATHER - k * PER) / (PER * 0.6));
      const p = new THREE.Vector3().lerpVectors(new THREE.Vector3(), r.to[id].p, u), a = r.to[id].r * u;
      m.position.lerpVectors(s.p, p, g); m.rotation.set(0, 0, s.r + (a - s.r) * g);
    }
    // the cursor: flies to the crown in turn, rests on it; after the round it circles the last crown slowly
    const i = Math.min(r.order.length - 1, Math.max(0, touched)), id = r.order[i], m = state.teeth[id];
    if (m) {
      const at = state.center[id].clone().add(m.position).setZ(state.center[id].z + m.position.z + 4);
      const u = (t - r.t0 - GATHER - i * PER) / (PER * 0.3);
      if (t >= roundEnd()) at.add(new THREE.Vector3(Math.cos(t * 1.6) * 1.2, Math.sin(t * 1.6) * 1.2, 0));
      if (i > 0 && u < 1) { const pid = r.order[i - 1]; r.cursor.position.lerpVectors(state.center[pid].clone().add(state.teeth[pid].position).setZ(at.z), at, ease(u)); }
      else r.cursor.position.copy(at);
      r.cursor.element.style.opacity = String(Math.min(1, Math.max(0, (t - r.t0 - GATHER * 0.5) / 0.3)));
    }
    // the table: rows appear top to bottom (the phase rule with them), the chip counts the stages
    if (r.fill) {
      const shown = Math.ceil(fillAt(t) * r.fill.rows.length);
      r.fill.rows.forEach((el, k) => { if (k < shown) showRow(el, true); });
    }
  }

  function landNow(t = now()) {
    if (!run || run.land) return;
    if (!run.fill) beginFill(t);
    for (const el of run.fill.rows) showRow(el, true);
    run.cursor.parent?.remove(run.cursor);
    restoreGhost();
    run.land = { t0: t, from: Object.fromEntries(Object.entries(state.teeth).map(([id, m]) => [id, { p: m.position.clone(), r: m.rotation.z }])),
                 to: lastFrame(run.plan ?? state.plan) };
  }
  // the plan's last stage as applyStage places it (no plan: stage 0, the scan)
  function lastFrame(plan) {
    const n = plan?.stages?.length ?? 0, st = n ? plan.stages[n - 1] : {}, rot = n ? plan.rotations?.[n - 1] ?? {} : {};
    return Object.fromEntries(Object.keys(state.teeth).map((id) => [id, place(st[id] ?? [0, 0, 0], rot[id] ?? 0, plan?.pivots?.[id] ?? [0, 0, 0])]));
  }
  function landing(t) {
    const r = run, u = ease((t - r.land.t0) / LAND);
    for (const [id, m] of Object.entries(state.teeth)) {
      const f = r.land.from[id], e = r.land.to[id];
      m.position.lerpVectors(f.p, e.p, u); m.rotation.set(0, 0, f.r + (e.r - f.r) * u);
    }
    if (u < 1) return;
    stop(true);
  }

  function restoreGhost() {
    if (!run?.ghostWas) return;
    for (const [g, p, rz, vis] of run.ghostWas.kids) { g.position.copy(p); g.rotation.set(0, 0, rz); g.visible = vis; }
    ghost.visible = run.ghostWas.visible;
    run.ghostWas = null;
  }
  // landed: the last stage with the slider there, ▶ blinking and 「▶ 처음부터 재생」 by it (unless the dentist moved the
  // stage during the turn, as showPlanEnd); not landed: the screen as applyStage has it
  const endStage = () => (state.plan && !state.stageTouched ? state.plan.stages.length : state.stage);
  function atEnd() {
    const tip = document.getElementById("stageTip");
    if (tip && state.plan && state.stage === state.plan.stages.length) tip.textContent += " · ▶ 처음부터 재생";
    pulsePlay();
  }
  function stop(landed) {
    if (!run) return;
    const r = run;
    r.cursor?.parent?.remove(r.cursor);
    restoreGhost();
    for (const el of r.fill?.rows ?? []) showRow(el, true);
    run = null;
    setWorkNote(false);
    applyStage(landed ? endStage() : state.stage);
    if (landed && !r.replay && (!state.plan || state.plan.plan_id === r.planId0)) after = { planId0: r.planId0, until: now() + 90 };
    if (landed) atEnd();
    r.resolve?.(landed);
  }
  const pulsePlay = () => document.getElementById("playBtn")?.animate(
    [{ boxShadow: "0 0 0 0 rgba(118,185,0,0)" }, { boxShadow: "0 0 0 6px rgba(118,185,0,0.55)" }, { boxShadow: "0 0 0 0 rgba(118,185,0,0)" }],
    { duration: 900, iterations: 3 });

  // the tool events (addStep): a tool that makes plans (the stage tool, a strategy compare) starts the round; its end
  // lets the landing wait for the plan
  function tool(name, phase) {
    // the turn's rule check and its sweep: this round lands now, so the two never overlap. Any other tool (select_plan
    // right after the stage tool) keeps it running
    if (!/stage|compare/i.test(name ?? "")) { if (/validate/i.test(name ?? "") && phase === "start" && run && !run.replay && run.toolDone) landNow(); return; }
    if (phase === "start" && !run) start();
    else if (phase === "end" && run) run.toolDone = true;
  }
  // the replay: the same round with the plan already on screen, then the landing. false: nothing ran (the caller lands
  // the old way)
  function play() {
    if (!start({ plan: state.plan, replay: true })) return Promise.resolve(false);
    return new Promise((res) => { run.resolve = res; });
  }
  const skip = () => { if (run?.replay && !run.land) { run.t0 = now() - GATHER - run.order.length * PER; if (run.fill) run.fill.dur = 0; landNow(); } };
  addEventListener("keydown", (e) => { if (e.key === "Escape") skip(); });
  document.getElementById("workNote")?.addEventListener("click", skip);

  const api = { tool, play, tick, skip, cancel: () => stop(false), get running() { return !!run; }, get ghostShown() { return !!run && !run.land; } };
  window.__stageGrow = api;   // browser checks
  return api;
}
