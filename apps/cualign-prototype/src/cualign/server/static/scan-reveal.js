// Scan reveal (시연 연출): on the setup turn the agent is seen reading the scan and applying the prescription.
// ① 스캔 인식 (startNumbers, as the agent's first line lands in the transcript) — one FDI number per crown, 17 → 27 at 0.1 s, each crown lit for
//    ~150 ms as its number lands. The numbers stay until ② has run.
// ② 처방 적용 (applyPrescription, as the transcript gets 「처방을 읽었습니다 — …」; never before ① is through) — an
//    extracted crown lifts toward the top of the screen and fades in FADE s, a 「발치」 mark stays (extracted() resolves then); an IPR contact gets the tool cursor (a strip disc that
//    flies in, scrapes ~0.5 s, fades), then its mark, and its crowns show cut (cutShown). At least MIN_APPLY long.
//    The same cursor runs once per plan when a playback the dentist started with ▶ first reaches stage 1 (the cut
//    applies from stage 1, contract 8-ipr-cut.md) — nowhere else: every applyStage calls stageReached (the slider, a
//    stage row, a violation, showPlanEnd, the stage-grow landing, the sweep), and each new plan used to get the cursor on
//    the first of them, so it came up on 단계 out of the blue. A cursor still queued when the step, the case or the plan
//    changes, or the playback stops, goes; so does the setup's once the view has left for 목표·단계.
// The module owns nothing of the app's state: it reads `state`, draws its own objects into `group`, and while it runs
// it overrides a few crown properties every frame from tick() (called in the render loop before the render), so the
// app's applyStage can keep writing the true state underneath. ?nofx=1 turns it off (browser checks).
const OFF = new URLSearchParams(location.search).has("nofx");
const SCAN_GAP = 0.1, PULSE = 0.15, HOLD = 0.3, MIN_APPLY = 1.5;      // s
// the lift goes up the screen, not along +z: from the opening (occlusal) view +z points at the camera, and a crown lifted
// along it only faded where it stood (the user saw 14·24 simply vanish, 2026-09-28). The crowns go together.
const LIFT_MM = 5, FADE = 0.6, FADE_GAP = 0;
const PULSE_HEX = 0x5a5a5a;
export const CURSOR_SVG = `<svg viewBox="0 0 32 32" width="44" height="44" aria-hidden="true">
  <circle cx="16" cy="16" r="11" fill="#2f8ae8" stroke="#0b1622" stroke-width="1.5"/>
  <circle cx="16" cy="16" r="11" fill="none" stroke="#e8f1fb" stroke-width="2" stroke-dasharray="1.6 2.2"/>
  <circle cx="16" cy="16" r="4.5" fill="#e8f1fb" stroke="#0b1622" stroke-width="1.2"/></svg>`;

const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

// The agents' cursors, by what they do. 'saw': the IPR strip disc above, for the cut only (applyPrescription, a ▶
// playback's first stage 1) — a CSS2D label. 'reticle': the stage and target rounds' pointer (stage-grow.js,
// target-reveal.js) — a thin ring in the selection's green, 3 mm across at crown scale, a dot in its middle; touch()
// swells it 1.15× and it settles back in 0.2 s, it never turns. { obj (to add and place), opacity (set), touch(), remove() }
const RETICLE_MM = 3, TOUCH = 0.2, SWELL = 1.15;
let reticleTex = null;
export function makeCursor({ THREE, CSS2DObject, kind = "saw" }) {
  if (kind === "saw") {
    const o = new CSS2DObject(document.createElement("div"));
    o.element.className = "ipr-tool"; o.element.innerHTML = `<i>${CURSOR_SVG}</i>`;
    return { kind, obj: o, set opacity(v) { o.element.style.opacity = String(v); }, touch() {}, remove() { o.parent?.remove(o); } };
  }
  if (!reticleTex) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    g.strokeStyle = g.fillStyle = "#76b900";   // --green, the selected crowns' outline
    g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(64, 64, 11, 0, Math.PI * 2); g.fill();
    reticleTex = new THREE.CanvasTexture(c);
    reticleTex.colorSpace = THREE.SRGBColorSpace;
  }
  const mat = new THREE.SpriteMaterial({ map: reticleTex, transparent: true, depthTest: false, depthWrite: false });
  const o = new THREE.Sprite(mat);
  o.renderOrder = 10; o.scale.set(RETICLE_MM, RETICLE_MM, 1); o.userData.cursor = "reticle";
  let touched = -Infinity;
  o.onBeforeRender = () => {   // before its model-view matrix is taken: the swell shows the same frame
    const u = (performance.now() / 1000 - touched) / TOUCH, k = u < 1 ? SWELL - (SWELL - 1) * ease(u) : 1;
    if (o.scale.x !== RETICLE_MM * k) { o.scale.set(RETICLE_MM * k, RETICLE_MM * k, 1); o.updateMatrixWorld(); }
  };
  return { kind, obj: o, set opacity(v) { mat.opacity = v; }, touch() { touched = performance.now() / 1000; },
           remove() { o.parent?.remove(o); mat.dispose(); } };
}
const pairKey = (a, b) => `${Math.min(+a, +b)}-${Math.max(+a, +b)}`;
const now = () => performance.now() / 1000;

export function createScanFx({ THREE, CSS2DObject, group, camera, state, fdi, notice, refresh, recut, stageContacts }) {
  const toothPos = (id) => state.center[id].clone().add(state.teeth[id].position);
  const contactPos = (a, b) => toothPos(a).add(toothPos(b)).multiplyScalar(0.5).setZ(Math.max(toothPos(a).z, toothPos(b).z) + 2);
  const label = (cls, text, pos) => {
    const el = document.createElement("div"); el.className = cls; if (text) el.textContent = text;
    const o = new CSS2DObject(el); o.position.copy(pos); group.add(o); return o;
  };

  // ---- the IPR tool cursor: one contact after another; each flies in from the last, scrapes, fades
  function cursorRun(contacts, per, onMark) {
    const o = label("ipr-tool", "", new THREE.Vector3());
    o.element.innerHTML = `<i>${CURSOR_SVG}</i>`;
    o.element.style.opacity = "0";
    const fly = per * 0.3, scrape = per * 0.55, fade = per * 0.15;
    let from = null;
    const run = { t0: null, done: false, marked: new Set(), contacts,
      tick(t) {
        run.t0 ??= t;
        const k = Math.floor((t - run.t0) / per), c = contacts[k];
        if (!c) { run.stop(); return; }
        const u = t - run.t0 - k * per, [a, b] = c;
        if (!state.teeth[a] || !state.teeth[b]) { run.stop(); return; }
        const at = contactPos(a, b);
        from ??= at.clone().add(new THREE.Vector3(9, 12, 6));
        const inner = o.element.firstChild;
        if (u < fly) {
          o.position.lerpVectors(from, at, ease(u / fly));
          o.element.style.opacity = String(Math.min(1, u / (fly * 0.6)));
          inner.style.transform = "";
        } else if (u < fly + scrape) {
          o.position.copy(at); o.element.style.opacity = "1";
          inner.style.transform = `translateX(${(Math.sin(((u - fly) / scrape) * Math.PI * 8) * 5).toFixed(1)}px)`;
        } else {
          o.position.copy(at); inner.style.transform = "";
          o.element.style.opacity = String(Math.max(0, 1 - (u - fly - scrape) / fade));
          if (!run.marked.has(k)) { run.marked.add(k); onMark?.(a, b); from = at.clone(); }
        }
      },
      stop() { run.done = true; o.parent?.remove(o); },
    };
    return run;
  }

  // ---- ② the setup reveal
  let fx = null;              // the running (or held) setup reveal
  const cursors = [];         // stage-playback cursors, independent of the setup reveal
  const cursorPlans = new Set();   // plans whose cut stage already had its cursor (▶ again does not repeat it)
  // ▶ pressed to start a playback (capture: before the app's own click, so state.playing is still the state before it);
  // a click that pauses, or any stage change outside that playback, disarms it
  let armed = null;   // { planId, caseId }
  document.getElementById("playBtn")?.addEventListener("click", () => {
    armed = !state.playing && state.plan ? { planId: state.plan.plan_id, caseId: state.meshCase } : null;
  }, { capture: true });
  const stale = (c) => state.step !== "stages" || state.meshCase !== c.caseId || state.plan?.plan_id !== c.planId || !state.playing;

  // ① as the setup turn is sent: the numbers; ② waits for applyPrescription (applyAt null until then)
  function startNumbers(caseId) {
    if (OFF || fx || !caseId) return;
    const ids = Object.keys(state.teeth).sort((a, b) => a - b);       // Universal 2 → 15 = FDI 17 → 27
    if (!ids.length) return;
    const scanEnd = SCAN_GAP * (ids.length - 1) + PULSE + 0.2;
    fx = { caseId, ids, extraction: [], surfaces: [], per: 0, t0: null, scanEnd, extractEnd: 0, applyAt: null, end: Infinity,
           nums: {}, pulsed: new Map(), faded: new Set(), clones: {}, marks: {}, cursor: null, iprDone: new Set(),
           released: false, finished: false, noticeLast: null, noticeApp: notice.textContent, owner: state.requestId };
    window.dispatchEvent(new CustomEvent("cualign:scan-reveal", { detail: { ids, ms: SCAN_GAP * 1000 } }));   // the 스캔 tab's chart fills in the same order
  }
  const surfacesOf = (rx, extraction) => (rx?.ipr_surfaces ?? []).map(([a, b]) => [String(a), String(b)])
    .filter(([a, b]) => state.teeth[a] && state.teeth[b] && !extraction.includes(a) && !extraction.includes(b));
  // ② as the transcript gets the setup's reasoning: the prescription (Universal) goes on the 3D, from the moment ①
  // is through at the earliest, and runs at least MIN_APPLY
  function applyPrescription(rx) {
    if (!fx || fx.finished || fx.applyAt !== null || !rx) return;
    fx.extraction = (rx.extraction ?? []).map(String).filter((id) => state.teeth[id]);
    fx.surfaces = surfacesOf(rx, fx.extraction);
    fx.extractEnd = fx.extraction.length ? FADE_GAP * (fx.extraction.length - 1) + FADE + 0.15 : 0;
    fx.per = fx.surfaces.length ? Math.min(0.9, Math.max(0.45, 2.4 / fx.surfaces.length)) : 0;
    fx.applyAt = Math.max(fx.t0 === null ? 0 : now() - fx.t0, fx.scanEnd);
    fx.end = fx.applyAt + Math.max(MIN_APPLY, fx.extractEnd + fx.per * fx.surfaces.length) + HOLD;
  }
  // step_done setup landed: ② starts now if the reasoning did not start it; once it runs, the contacts the cursor has
  // not reached yet follow the agent's constraints
  function landed(setup) {
    if (!fx || fx.finished || !setup) return;
    if (fx.applyAt === null) { applyPrescription(setup); return; }
    if (fx.cursor) return;
    fx.surfaces = surfacesOf(setup, fx.extraction);
    fx.per = fx.surfaces.length ? Math.min(0.9, Math.max(0.45, 2.4 / fx.surfaces.length)) : 0;
    fx.end = fx.applyAt + Math.max(MIN_APPLY, fx.extractEnd + fx.per * fx.surfaces.length) + HOLD;
  }
  // resolves once ① is through (at once without a reveal): a replay lands its reasoning and ② together after it
  function numbersDone() {
    const left = !fx || fx.finished ? 0 : fx.t0 === null ? fx.scanEnd : fx.scanEnd - (now() - fx.t0);
    return new Promise((r) => setTimeout(r, Math.max(0, left) * 1000));
  }
  // resolves once the extracted crowns have lifted away (at once without a reveal or an extraction): the setup lands after
  function extracted() {
    const left = !fx || fx.applyAt === null || !fx.extraction.length ? 0
      : fx.applyAt + FADE_GAP * (fx.extraction.length - 1) + FADE - (fx.t0 === null ? 0 : now() - fx.t0);
    return new Promise((r) => setTimeout(r, Math.max(0, left) * 1000));
  }
  // a crown with an IPR contact shows its cut once the cursor has passed all its contacts
  function cutShown(id) {
    if (!fx || fx.finished) return true;
    id = String(id);
    return !fx.surfaces.some(([a, b]) => (a === id || b === id) && !fx.iprDone.has(pairKey(a, b)));
  }
  const ownsNotice = () => state.requestId === fx.owner;   // a later turn has its own line: the reveal leaves it alone
  const say = (text) => {
    if (!ownsNotice()) return;
    if (notice.textContent !== fx.noticeLast) fx.noticeApp = notice.textContent;   // the app wrote its own line meanwhile
    notice.textContent = fx.noticeLast = text;
  };
  const unsay = () => {
    if (ownsNotice() && fx.noticeLast !== null && notice.textContent === fx.noticeLast) notice.textContent = fx.noticeApp;
    fx.noticeLast = null;
  };
  function clearResidue() {
    for (const o of Object.values(fx.nums)) o.parent?.remove(o);
    for (const o of Object.values(fx.marks)) o.parent?.remove(o);
    for (const c of Object.values(fx.clones)) { c.parent?.remove(c); c.material.dispose(); }
    fx.cursor?.stop();
    for (const [id, hex] of fx.pulsed) if (hex !== null) state.teeth[id]?.material.emissive.setHex(hex);
  }
  function finish() {       // the reveal is over; its marks stay (held) until the turn is over too
    fx.finished = true;
    for (const o of Object.values(fx.nums)) o.parent?.remove(o);   // the setup view shows no tooth numbers
    fx.nums = {};
    if (ownsNotice() && notice.textContent === fx.noticeLast) notice.textContent = fx.noticeApp;
    if (fx.released) drop();
  }
  function drop() { clearResidue(); fx = null; refresh(); }
  // the turn is over (its setup landed, or it failed): the app's own setup marks take over once the reveal ends
  function release() { if (!fx) return; fx.released = true; if (fx.finished) drop(); }
  function cancel() { if (fx) { clearResidue(); if (ownsNotice() && notice.textContent === fx.noticeLast) notice.textContent = ""; fx = null; }
                      armed = null; for (const c of cursors.splice(0)) c.stop(); }

  function tickSetup(t) {
    if (!fx.finished && (!state.teeth[fx.ids[0]] || state.meshCase !== fx.caseId)) { cancel(); return; }
    // the view went on to 목표·단계 before the cursor was through: it does not follow there (the contacts count as done)
    if (!fx.finished && fx.surfaces.length && (state.step === "target" || state.step === "stages") && !fx.cursor?.done) {
      fx.cursor?.stop();
      fx.cursor = { done: true, stop() {} };
      for (const [a, b] of fx.surfaces) fx.iprDone.add(pairKey(a, b));
      recut?.();
    }
    fx.t0 ??= t;
    const u = t - fx.t0;
    // ① one number per crown, a short light on it
    if (!fx.finished) {
      fx.ids.forEach((id, i) => {
        const m = state.teeth[id], at = SCAN_GAP * i;
        if (!m || u < at) return;
        if (!fx.nums[id] && !fx.faded.has(id)) {
          const p = state.center[id].clone(); p.z = m.geometry.boundingBox.max.z + 1.5;
          fx.nums[id] = label("num-label fx-num", String(fdi(id)), p);
          fx.pulsed.set(id, m.material.emissive.getHex());
        }
        if (fx.nums[id]) fx.nums[id].position.set(state.center[id].x + m.position.x, state.center[id].y + m.position.y, fx.nums[id].position.z);
        const p = (u - at) / PULSE;
        if (p < 1) m.material.emissive.setHex(PULSE_HEX).multiplyScalar(Math.sin(p * Math.PI));
        else if (fx.pulsed.get(id) !== null) { m.material.emissive.setHex(fx.pulsed.get(id)); fx.pulsed.set(id, null); }
      });
      const seen = fx.ids.filter((_, i) => u >= SCAN_GAP * i).length;
      if (u < fx.scanEnd) say(`스캔 인식 중 … ${seen}개 치아`);
      else if (fx.applyAt === null) unsay();   // waiting for the reasoning: the app's own line
      else {
        const parts = [fx.extraction.length && `${fx.extraction.map(fdi).sort((a, b) => a - b).join("·")} 발치`,
                       fx.surfaces.length && `IPR ${fx.surfaces.length}면`].filter(Boolean);
        say(parts.length ? `처방 적용 중 … ${parts.join(" · ")}` : `스캔 인식 … ${fx.ids.length}개 치아`);
      }
    }
    // ② extraction: the crown lifts and fades (a clone does it; the crown itself is hidden from then on), a mark stays
    fx.extraction.forEach((id, i) => {
      const m = state.teeth[id], at = fx.applyAt + FADE_GAP * i;
      if (!m) return;
      if (u < at) { m.visible = true; m.material.color.setHex(0xe9e3d6); return; }   // until its turn the crown stays as scanned
      m.visible = false;
      if (!fx.faded.has(id)) {
        fx.faded.add(id);
        fx.nums[id]?.parent?.remove(fx.nums[id]); delete fx.nums[id];
        const mat = m.material.clone(); mat.color.setHex(0xe9e3d6); mat.emissive.setHex(0); mat.transparent = true; mat.depthWrite = false;
        const c = new THREE.Mesh(m.geometry, mat); c.position.copy(m.position); c.rotation.copy(m.rotation);
        c.userData.from = m.position.clone();
        c.userData.up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).transformDirection(group.matrixWorld.clone().invert());
        group.add(c); fx.clones[id] = c;
      }
      const c = fx.clones[id];
      if (c?.parent) {
        const p = (u - at) / FADE;
        if (p >= 1) { c.parent.remove(c); c.material.dispose(); }
        else { c.position.copy(c.userData.from).addScaledVector(c.userData.up, LIFT_MM * ease(p)); c.material.opacity = 1 - p * p; }   // it rises at once, fades late
        if (p >= 0.6 && !fx.marks[id]) fx.marks[id] = label("extract-mark", "발치", state.center[id].clone().setZ(state.center[id].z + 2));
      }
    });
    // ② IPR: the tool cursor over each prescribed contact, the contact's mark once it is done
    if (fx.surfaces.length && !fx.finished && fx.applyAt !== null && u >= fx.applyAt + fx.extractEnd && !fx.cursor)
      fx.cursor = cursorRun(fx.surfaces, fx.per, (a, b) => {
        fx.iprDone.add(pairKey(a, b));
        recut?.();   // the two crowns show cut from here
        if (!appMark(`[data-contact="${pairKey(a, b)}"]`)) fx.marks[pairKey(a, b)] = label("fx-ipr-mark", "", contactPos(a, b));
      });
    if (fx.cursor && !fx.cursor.done) fx.cursor.tick(t);
    // the app's own setup marks (drawn when the setup lands) wait for their turn; ours go once the app's are there
    for (const o of state.setupMarks ?? []) {
      const el = o.element, c = el.dataset.contact, x = el.dataset.extract;
      const ready = c ? fx.iprDone.has(c) || !fx.surfaces.some(([a, b]) => pairKey(a, b) === c) : x ? fx.faded.has(x) && !fx.clones[x]?.parent : true;
      el.classList.toggle("fx-wait", !ready && !fx.finished);
      const mine = fx.marks[c ?? x];
      if (mine && ready) { mine.parent?.remove(mine); delete fx.marks[c ?? x]; }
    }
    // done: ② ran its time, or the turn ended without a prescription to apply (failed, or no setup came)
    if (!fx.finished && (u >= fx.end || (fx.released && fx.applyAt === null && u >= fx.scanEnd))) finish();
  }
  const appMark = (sel) => (state.setupMarks ?? []).some((o) => o.element.matches(sel));

  function tick() {
    const t = now();
    if (fx) tickSetup(t);
    for (let i = cursors.length - 1; i >= 0; i--) {
      if (stale(cursors[i].ctx)) cursors[i].stop(); else cursors[i].tick(t);
      if (cursors[i].done) cursors.splice(i, 1);
    }
  }
  // a playback started with ▶ reached stage 1 for the first time on this plan: the cursor goes over its contacts once
  function stageReached(k) {
    if (!armed) return;
    const plan = state.plan, ctx = armed;
    if (OFF || stale(ctx)) { armed = null; return; }
    if (k !== 1) return;   // from the last stage ▶ goes to 치료 전 first, then 1
    armed = null;
    if (cursorPlans.has(plan.plan_id)) return;
    cursorPlans.add(plan.plan_id);
    const contacts = stageContacts(plan);
    if (contacts.length) cursors.push(Object.assign(cursorRun(contacts, Math.min(0.9, Math.max(0.45, 2.4 / contacts.length))), { ctx }));
  }
  return { startNumbers, applyPrescription, landed, numbersDone, extracted, cutShown, release, cancel, tick, stageReached, busy: () => !!fx };
}
