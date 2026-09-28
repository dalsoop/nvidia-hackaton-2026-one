// 「치열궁을 따라 자리 잡는다」 (시연 연출): while the target tool (propose_target) runs, the target arch is drawn and the
// crowns settle onto it one by one, so the 셋업 → 목표 turn is seen being made instead of the target simply appearing.
//   ① the arch line (0.6 s): a thin green line from between the central incisors out to both ends, the agent's cursor
//      (the reticle of scan-reveal.js — the saw disc is the IPR cut's only) at its tip, 1 mm above the gum. It goes 2 s after the landing.
//   ② the settling: the cursor touches the crowns, the most moved first (in an extraction case the extraction's
//      neighbours first), and each glides from where it stood to its target in 0.35 s (two or three overlap; the round
//      is 6 s). The setup positions stay as the pale ghost until the last crown is there.
//   ③ the 3D chip: 목표 배열 계산 중, and once the result is known 「· 확보 공간 x / 총생 mm」, x rising as crowns arrive.
//   ④ the landing: every crown exactly on the target (the ones still under way in 0.4 s together), the cursor gone.
// The destination is the result as soon as there is one; before it (a live turn) the arch the crowns stand on now,
// smoothed, with the extraction sites narrowed — the line is redrawn through the result at the landing.
//   - a live turn lands when its result lands (step_done target); a round done before that leaves the cursor circling
//     in front of the incisors. A turn that ends with no result puts everything back.
//   - a replay (the recorded target lands first, its tool row plays after) runs the same 6 s round to the landed
//     target, then lands; Esc or a click on the 3D chip lands at once.
//   - app.js calls nothing: this module watches the transcript's propose_target rows (start: the row appears running;
//     a recorded trace's row is the replay's) and the app's state (the result: a new state.targetId with state.step
//     "target"), and writes the crowns, the ghost and the chip over what applyStage wrote from scene.onBeforeRender —
//     after the app's own tick, before the frame is drawn.
//   - prefers-reduced-motion or ?nofx=1: nothing runs; the target lands at once, as before.
import { makeCursor } from "./scan-reveal.js";

const OFF = new URLSearchParams(location.search).has("nofx");
const LINE = 0.6, SLIDE = 0.35, ROUND = 6, LAND = 0.4, LINE_HOLD = 2, LINE_FADE = 0.3, IDLE_OFF = 1.5;   // s
const GAP_CLOSE = 0.35;   // how far an extraction's neighbours step into its place in the guess before the result
const GREEN = 0x76b900, TOOL = "propose_target";
const now = () => performance.now() / 1000;
const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

export function createTargetReveal({ THREE, CSS2DObject, scene, group, ghost, state, applyStage, setWorkNote }) {
  const still = () => OFF || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stageGrowing = () => !!window.__stageGrow?.running;   // the stage turn's round owns the crowns and the ghost
  let run = null;
  let line = null;   // the arch line outlives its run by LINE_HOLD

  // the crown's transform as applyStage writes it: d + c − R c, turned about z
  const place = (d, yawDeg, c) => {
    const a = (yawDeg * Math.PI) / 180;
    return { p: new THREE.Vector3(d[0] + c[0] - (Math.cos(a) * c[0] - Math.sin(a) * c[1]), d[1] + c[1] - (Math.sin(a) * c[0] + Math.cos(a) * c[1]), d[2]), r: a };
  };
  const zero = () => ({ p: new THREE.Vector3(), r: 0 });
  const poseAt = (s, t) => {
    const u = t < s.t ? 0 : ease((t - s.t) / s.dur);
    return { p: new THREE.Vector3().lerpVectors(s.from.p, s.to.p, u), r: s.from.r + (s.to.r - s.from.r) * u };
  };
  // the result: the target on screen made by this turn (a replay's has landed before its row plays)
  const result = () => (state.target && state.targetId && state.targetId !== run.targetId0 ? state.target : null);
  function resultPoses(tg) {
    const d = tg.stages?.[0] ?? {};
    return Object.fromEntries(run.ids.map((id) => [id, d[id] ? place(d[id], tg.rotations?.[0]?.[id] ?? 0, tg.pivots?.[id] ?? [0, 0, 0]) : zero()]));
  }
  // before the result: the crowns' centres along the arch, the extraction sites narrowed, smoothed (1-2-1, three
  // passes, the end crowns pinned)
  function guessPoses() {
    const full = state.archOrder.map(String);
    let c = run.ids.map((id) => state.center[id].clone().add(run.from[id].p).setZ(0));
    for (const x of run.removed) {
      const i = full.indexOf(x);
      if (i < 0 || !state.center[x]) continue;
      for (const k of [run.ids.indexOf(full[i - 1]), run.ids.indexOf(full[i + 1])])
        if (k >= 0) c[k].lerp(state.center[x].clone().setZ(0), GAP_CLOSE);
    }
    for (let pass = 0; pass < 3; pass++)
      c = c.map((v, k) => (k === 0 || k === c.length - 1 ? v : c[k - 1].clone().add(v).add(v).add(c[k + 1]).multiplyScalar(0.25)));
    return Object.fromEntries(run.ids.map((id, k) => [id, { p: c[k].sub(state.center[id].clone().setZ(0)), r: 0 }]));
  }
  // the most moved first; in an extraction case the extraction's neighbours before them
  function orderOf(to) {
    const full = state.archOrder.map(String), near = new Set();
    for (const x of run.removed) { const i = full.indexOf(x); if (i >= 0) near.add(full[i - 1]).add(full[i + 1]); }
    const moved = (id) => to[id].p.distanceTo(run.from[id].p) + Math.abs(to[id].r - run.from[id].r) * 5;
    return [...run.ids].sort((a, b) => near.has(b) - near.has(a) || moved(b) - moved(a));
  }

  // ---- the arch line: two halves from the midline out, a tube (a WebGL line is one pixel), drawn over the crowns
  function lineZ() {
    const g = state.gum?.geometry;
    if (g) { g.boundingBox ?? g.computeBoundingBox(); return g.boundingBox.max.z + 1; }
    return Math.min(...run.ids.map((id) => state.teeth[id].geometry.boundingBox?.min.z ?? 0)) + 1;
  }
  function buildLine(poses) {
    dropLine();
    const z = lineZ(), pts = run.ids.map((id) => state.center[id].clone().add(poses[id].p).setZ(z));
    const mid = Math.max(1, run.ids.findIndex((id) => +id >= 9));   // Universal 9 = FDI 21: the first crown past the midline
    const m = pts[mid - 1].clone().lerp(pts[mid] ?? pts[mid - 1], 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    const obj = new THREE.Group();
    for (const half of [[m, ...pts.slice(0, mid).reverse()], [m, ...pts.slice(mid)]]) {
      if (half.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(half, false, "centripetal");
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.18, 6, false), mat);
      mesh.renderOrder = 10; mesh.userData.curve = curve;
      obj.add(mesh);
    }
    group.add(obj);
    line = { obj, mat, mid: m, hideAt: null };
    drawLine(0);
  }
  function drawLine(u) {   // the tube's index runs along the curve, a ring at a time
    for (const mesh of line.obj.children) {
      const n = mesh.geometry.index.count, ring = n / 64;
      mesh.geometry.setDrawRange(0, Math.round(Math.min(1, u) * 64) * ring);
    }
  }
  const lineTip = (u) => line.obj.children[0]?.userData.curve.getPointAt(Math.min(1, u)) ?? line.mid;
  function dropLine() {
    if (!line) return;
    line.obj.parent?.remove(line.obj);
    for (const mesh of line.obj.children) mesh.geometry.dispose();
    line.mat.dispose();
    line = null;
  }

  // ---- the ghost: the same crowns (buildTeeth made one per crown, in the same order) at the setup positions
  function showGhost() {
    const was = { visible: ghost.visible, kids: [] };
    Object.keys(state.teeth).forEach((id, i) => {
      const g = ghost.children[i]; if (!g) return;
      was.kids.push([g, g.position.clone(), g.rotation.z, g.visible]);
      g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.visible = run.ids.includes(id);
    });
    return was;
  }
  function restoreGhost() {
    const was = run?.ghostWas;
    if (!was) return;
    run.ghostWas = null;
    if (stageGrowing()) return;   // the stage round took the ghost over (and puts it back itself)
    for (const [g, p, rz, vis] of was.kids) { g.position.copy(p); g.rotation.set(0, 0, rz); g.visible = vis; }
    ghost.visible = was.visible;
  }

  function start(replay) {
    if (!Object.keys(state.teeth).length) return;
    const removed = new Set([...(state.setup?.extraction ?? []), ...(replay ? state.target?.target?.removed ?? [] : [])].map(String));
    const ids = state.archOrder.map(String).filter((id) => state.teeth[id] && !removed.has(id));
    if (ids.length < 2) return;
    const t0 = now();
    run = { t0, replay, ids, removed, caseId: state.meshCase, step0: state.step, targetId0: replay ? null : state.targetId,
            from: {}, st: {}, land: null, idleSince: null, cursor: null, ghostWas: null, chip: null };
    // a live turn starts from what the screen shows (셋업: the scan); a replay's target has landed already, so from 셋업
    for (const id of ids) { const m = state.teeth[id]; run.from[id] = replay ? zero() : { p: m.position.clone(), r: m.rotation.z }; }
    const res = replay ? result() : null;
    if (replay && !res) { run = null; return; }
    const to = res ? resultPoses(res) : guessPoses();
    const order = orderOf(to), gap = (ROUND - LINE - SLIDE) / Math.max(1, order.length - 1);
    order.forEach((id, k) => { run.st[id] = { from: run.from[id], to: to[id], t: t0 + LINE + k * gap, dur: SLIDE }; });
    run.order = order; run.gap = gap; run.lineGuess = !res;
    buildLine(to);
    run.ghostWas = showGhost();
    run.cursor = makeCursor({ THREE, CSS2DObject, kind: "reticle" }); run.touched = -1;
    group.add(run.cursor.obj);
  }
  // a live round cut by 건너뛰기: the replay that follows goes on from where the crowns are, to the landed target
  function becomeReplay() {
    const res = result(), t = now();
    if (!res) return;
    run.replay = true;
    const to = resultPoses(res);
    for (const id of run.ids) {
      const s = run.st[id];
      run.st[id] = t < s.t ? { ...s, to: to[id] } : { from: poseAt(s, t), to: to[id], t, dur: SLIDE };
    }
    buildLine(to); drawLine(1); run.lineGuess = false;
    run.t0 = Math.min(run.t0, t - LINE);   // the line is already drawn
  }

  function landNow(t) {
    const r = run, to = resultPoses(result());
    for (const id of r.ids) r.st[id] = { from: poseAt(r.st[id], t), to: to[id], t, dur: LAND };
    r.land = { t0: t };
    r.cursor?.remove();
    if (r.lineGuess) { buildLine(to); r.lineGuess = false; }
    drawLine(1);
  }
  function finish() {
    for (const id of run.ids) { const s = run.st[id], m = state.teeth[id]; m.position.copy(s.to.p); m.rotation.set(0, 0, s.to.r); }
    end();
    if (line) line.hideAt = now() + LINE_HOLD;
  }
  // the run is over: its cursor, its ghost and its chip go (the crowns stay as last written)
  function end() {
    const r = run;
    r.cursor?.remove();
    restoreGhost();
    run = null;
    if (r.chip !== null && !state.streaming && !stageGrowing()) setWorkNote(false);
  }
  function abort() { end(); dropLine(); }              // the screen moved on (another step, case or turn): the app has drawn it
  function putBack() { abort(); applyStage(state.stage); }   // the turn ended with no result: the crowns as the app has them

  function chip(t) {
    if (stageGrowing()) return;
    const res = result(), gain = res?.target?.space_gain_mm ?? state.targetSummary?.space_mm;
    const crowd = state.caseInfo?.crowding_mm ?? state.targetSummary?.crowding_mm;
    let text = "목표 배열 계산 중";
    if (res && gain != null) {
      const arrived = run.land ? run.ids.length : run.ids.filter((id) => t >= run.st[id].t + run.st[id].dur).length;
      text += ` · 확보 공간 ${((gain * arrived) / run.ids.length).toFixed(1)}` + (crowd != null ? ` / ${crowd} mm` : " mm");
    }
    if (text !== document.querySelector("#workNote span")?.textContent) setWorkNote(true, text);
    run.chip = text;
  }
  function cursorAt(t) {
    const r = run, c = r.cursor, o = c.obj;
    const on = (id) => state.center[id].clone().add(poseAt(r.st[id], t).p).setZ(state.center[id].z + 4);
    const u = (t - r.t0) / LINE;
    if (u < 1) { o.position.copy(lineTip(u)); c.opacity = Math.min(1, u * 4); return; }
    c.opacity = 1;
    if (t >= r.t0 + ROUND) {   // the round is done, the result not yet: circling in front of the incisors
      o.position.copy(line.mid).add(new THREE.Vector3(Math.cos(t * 1.2) * 2, 6 + Math.sin(t * 1.2) * 2, 4));
      return;
    }
    const k = Math.floor((t - r.t0 - LINE) / r.gap), next = r.order[k + 1], fly = Math.min(0.25, r.gap * 0.6);
    const here = k >= 0 ? on(r.order[k]) : lineTip(1);
    const v = next ? (t - r.st[next].t + fly) / fly : 0;
    if (next && v > 0) o.position.lerpVectors(here, on(next), ease(v));
    else o.position.copy(here);
    if (k >= 0 && r.touched !== k) { r.touched = k; c.touch(); }   // on the crown: the ring swells once
  }

  function tick() {
    const t = now();
    if (line?.hideAt != null && !run) {
      const f = (t - line.hideAt) / LINE_FADE;
      if (f >= 1) dropLine(); else if (f > 0) line.mat.opacity = 0.9 * (1 - f);
    }
    if (!run) return;
    const r = run, res = result();
    if (state.meshCase !== r.caseId || state.step !== (res ? "target" : r.step0) || stageGrowing()) return abort();
    if (!r.land) {
      if (res && (!r.replay || t >= r.t0 + ROUND)) landNow(t);   // live: the result is here; a replay: its round is through
      else if (!res && !state.streaming) { r.idleSince ??= t; if (t - r.idleSince > IDLE_OFF) return putBack(); }
      else r.idleSince = null;
    }
    for (const id of r.ids) {
      const m = state.teeth[id], q = poseAt(r.st[id], t);
      m.position.copy(q.p); m.rotation.set(0, 0, q.r);
    }
    if (r.land && t >= r.land.t0 + LAND) return finish();
    ghost.visible = true;
    if (!r.land) { drawLine((t - r.t0) / LINE); cursorAt(t); }
    chip(t);
  }
  // the tick goes into the frame itself: the renderer has updated the matrices when it calls this, so they are again
  scene.onBeforeRender = () => { if (run || line) { tick(); scene.updateMatrixWorld(); } };

  // ---- the tool rows: a propose_target row appearing running is the tool's start (a recorded trace's: the replay's)
  const seen = new WeakMap();
  function rows() {
    for (const row of document.querySelectorAll(`#transcript .step.tool[data-tool="${TOOL}"]`)) {
      const was = seen.get(row), is = row.classList.contains("running") ? "run" : "done";
      if (was === is) continue;
      seen.set(row, is);
      if (was || is !== "run" || still()) continue;   // a row seen first as done (restored, or a setup's) starts nothing
      const replay = !!row.closest(".recorded");
      if (!run) start(replay);
      else if (replay && !run.replay && !run.land) becomeReplay();
    }
  }
  const transcript = document.getElementById("transcript");
  if (transcript) new MutationObserver(rows).observe(transcript, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });

  const skip = () => { if (run?.replay && !run.land) landNow(now()); };
  addEventListener("keydown", (e) => { if (e.key === "Escape") skip(); });
  document.getElementById("workNote")?.addEventListener("click", skip);

  const api = { tick, skip, get running() { return !!run; }, get lineShown() { return !!line; }, get ghostShown() { return !!run?.ghostWas; } };
  window.__targetReveal = api;   // browser checks
  return api;
}
