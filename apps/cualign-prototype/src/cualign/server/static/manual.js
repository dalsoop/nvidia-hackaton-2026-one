// 직접 이동 (manual target edit): the dentist moves crowns of the target arrangement by hand on the 「목표」 step.
// A draft of the target is drawn through the viewer's own applyStage (state.target is swapped for the draft while
// editing); a click picks a crown and puts arrows on it (mesial · buccal · occlusal along the crown's own axes from
// the server, core/manual.frames) and a ring for the turn about its vertical axis. The 「이동」 tab lists every crown's
// total move from the scan in those axes, editable as numbers. Each change is checked by the server (overlaps, the
// fewest aligners); 적용 stores a new target (POST …/manual) that the next stages turn stages like any other.

export const STEP_MM = 0.05, STEP_DEG = 0.5, MAX_MM = 10, MAX_DEG = 45;   // snap of a drag; bounds as core/manual.py
export const AXES = ["mesial", "buccal", "occlusal"];
const DEFAULT_FRAME = { mesial: [1, 0, 0], buccal: [0, 1, 0], occlusal: [0, 0, 1] };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const round = (x, step) => Math.round(x / step) * step;

// the crown's total move d (world mm) in its own axes: {mesial, buccal, occlusal}
export function localOf(d, frame = DEFAULT_FRAME) {
  return Object.fromEntries(AXES.map((k) => [k, dot(d, frame[k])]));
}
// d with its component along one axis set to `value` (the others kept)
export function withLocal(d, frame, key, value) {
  const a = (frame ?? DEFAULT_FRAME)[key], k = value - dot(d, a);
  return [d[0] + a[0] * k, d[1] + a[1] * k, d[2] + a[2] * k];
}
// the teeth whose pose differs from the base target's, as the API takes them: {tooth: {d, yaw}}
export function editsOf(draft, base) {
  const out = {};
  for (const [id, d] of Object.entries(draft.d)) {
    const b = base.d[id] ?? [0, 0, 0];
    if (Math.hypot(d[0] - b[0], d[1] - b[1], d[2] - b[2]) > 1e-4 || Math.abs((draft.yaw[id] ?? 0) - (base.yaw[id] ?? 0)) > 1e-3)
      out[id] = { d: d.map((x) => +x.toFixed(4)), yaw: +(draft.yaw[id] ?? 0).toFixed(3) };
  }
  return out;
}
const signed = (x, digits) => (x > 0 ? "+" : "") + x.toFixed(digits);
// one line per edited crown for the transcript: 「11번 근심 +0.30mm · 회전 +2.0°」 (the change from the base)
export function changeWords(draft, base, frames, fdi) {
  const words = { mesial: ["근심", "원심"], buccal: ["협측", "설측"], occlusal: ["정출", "함입"] };
  return Object.keys(editsOf(draft, base)).sort((a, b) => fdi(a) - fdi(b)).map((id) => {
    const f = frames[id] ?? DEFAULT_FRAME, d = draft.d[id], b = base.d[id] ?? [0, 0, 0];
    const delta = [d[0] - b[0], d[1] - b[1], d[2] - b[2]], parts = [];
    for (const k of AXES) {
      const v = dot(delta, f[k]);
      if (Math.abs(v) >= 0.005) parts.push(`${words[k][v > 0 ? 0 : 1]} ${Math.abs(v).toFixed(2)}mm`);
    }
    const y = (draft.yaw[id] ?? 0) - (base.yaw[id] ?? 0);
    if (Math.abs(y) >= 0.05) parts.push(`회전 ${signed(y, 1)}°`);
    return `${fdi(id)}번 ${parts.join(" · ")}`;
  });
}

export function createManual(ctx) {
  const { THREE, scene, camera, canvas, state, $, fdi, api, applyStage, showTab, addMsg, toast } = ctx;
  const M = { active: false, base: null, baseDraft: null, draft: null, view: null, sel: null, undo: [], redo: [],
              drag: null, down: null, checkSeq: 0, checkTimer: null, frame: 0, overlayWas: false };
  const ray = new THREE.Raycaster();

  // ---- the gizmo: three double arrows and a ring, drawn over the crowns (no depth test), with fatter invisible hit shapes
  const COLORS = { mesial: 0xff5da2, buccal: 0x2ec4b6, occlusal: 0x9b7bff, yaw: 0xffd166 };
  const L = 5, R = 6;
  const gizmo = new THREE.Group(); gizmo.visible = false; scene.add(gizmo);
  const hits = [], arrows = {};
  const mat = (color, opacity = 0.95) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity });
  const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  for (const k of AXES) {
    const g = new THREE.Group(), m = mat(COLORS[k]);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2 * L, 8), m);
    for (const s of [1, -1]) {
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 14), m);
      head.position.y = s * (L + 0.75); if (s < 0) head.rotation.z = Math.PI;
      g.add(head);
    }
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2 * L + 3, 6), hitMat);
    hit.userData.handle = k; hits.push(hit);
    g.add(shaft, hit);
    for (const o of g.children) o.renderOrder = 999;
    gizmo.add(g); arrows[k] = g;
  }
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 72), mat(COLORS.yaw));
    const hit = new THREE.Mesh(new THREE.TorusGeometry(R, 0.8, 6, 48), hitMat);
    hit.userData.handle = "yaw"; hits.push(hit);
    ring.renderOrder = hit.renderOrder = 999;
    gizmo.add(ring, hit);
  }

  const frameOf = (id) => M.base?.frames?.[id] ?? DEFAULT_FRAME;
  const pivotOf = (id) => M.base?.pivots?.[id] ?? [0, 0, 0];
  const snapshot = () => ({ d: Object.fromEntries(Object.entries(M.draft.d).map(([k, v]) => [k, [...v]])), yaw: { ...M.draft.yaw } });
  const locked = () => new Set((M.base?.target?.locked ?? []).map(String));
  const removed = () => new Set((M.base?.target?.removed ?? []).map(String));

  function placeGizmo() {
    const id = M.sel;
    gizmo.visible = !!(M.active && id && M.draft.d[id]);
    if (!gizmo.visible) return;
    const c = pivotOf(id), d = M.draft.d[id];
    gizmo.position.set(c[0] + d[0], c[1] + d[1], c[2] + d[2]);
    const up = new THREE.Vector3(0, 1, 0), f = frameOf(id);
    for (const k of AXES) arrows[k].quaternion.setFromUnitVectors(up, new THREE.Vector3(...f[k]).normalize());
  }

  // the draft drawn as the target: one stage, the rotations, the server's overlaps as collisions (red, mm³ labels)
  function draw() {
    M.view.stages = [Object.fromEntries(Object.entries(M.draft.d).map(([k, v]) => [k, v]))];
    M.view.rotations = [{ ...M.draft.yaw }];
    state.target = M.view;
    applyStage(1);
    const m = state.teeth[M.sel];
    if (m) m.material.emissive.setHex(0x5a9400);
    placeGizmo();
  }
  function redraw() {   // at most once a frame while dragging (applyStage bends the gum too)
    if (M.frame) return;
    M.frame = requestAnimationFrame(() => { M.frame = 0; if (M.active) draw(); });
  }
  function changed() { redraw(); renderTable(); renderBar(); scheduleCheck(); }
  function push() { M.undo.push(snapshot()); if (M.undo.length > 100) M.undo.shift(); M.redo = []; }

  // ---- open / close. On 셋업 the edit starts from the scan (처음부터 수동 배치): the server makes a target with every
  // crown in place (POST …/targets/scan), shown as the 목표 while it is edited; 취소 goes back to 셋업 as it was.
  async function open() {
    if (M.active) { showTab("move"); return; }
    if (state.streaming || state.loading || M.opening) return;
    if (state.step === "setup") return openFromScan();
    if (state.step !== "target" || !state.target || !state.targetId) { toast("셋업이나 목표 단계에서 직접 이동할 수 있습니다."); return; }
    start(null);
  }
  async function openFromScan() {
    const prev = { target: state.target, targetId: state.targetId, progress: state.progress };
    M.opening = true;
    try {
      const t = await api(`/api/cases/${encodeURIComponent(state.meshCase)}/targets/scan`, { method: "POST" });
      ctx.enterTarget(t);
      start(prev);
    } catch (e) {
      addMsg("error", "수동 배치를 시작하지 못했습니다: " + e.message);
    } finally { M.opening = false; }
  }
  function start(restore) {
    M.base = state.target;
    const st = M.base.stages?.[0] ?? {}, rot = M.base.rotations?.[0] ?? {};
    const gone = removed();
    M.baseDraft = { d: {}, yaw: {} };
    for (const id of Object.keys(state.teeth)) {
      if (gone.has(id)) continue;
      M.baseDraft.d[id] = [...(st[id] ?? [0, 0, 0])];
      M.baseDraft.yaw[id] = rot[id] ?? 0;
    }
    M.draft = { d: Object.fromEntries(Object.entries(M.baseDraft.d).map(([k, v]) => [k, [...v]])), yaw: { ...M.baseDraft.yaw } };
    M.view = { ...M.base, violations: [], stages: [], rotations: [] };
    M.undo = []; M.redo = []; M.sel = null; M.check = null; M.restore = restore;
    M.active = true;
    state.selected.clear();
    document.body.classList.add("manual-on");
    $("moveBtn").setAttribute("aria-pressed", "true");
    M.overlayWas = state.overlay;
    if (!state.overlay) $("overlayBtn").click();   // the scan's arch as the white ghost: where the crowns started
    showTab("move");
    draw(); renderTable(); renderBar(); runCheck();
  }
  function close() {
    M.active = false; gizmo.visible = false; M.drag = null;
    clearTimeout(M.checkTimer); M.checkSeq++;
    document.body.classList.remove("manual-on");
    $("moveBtn").setAttribute("aria-pressed", "false");
    if (state.overlay !== M.overlayWas) $("overlayBtn").click();
  }
  function cancel() {
    if (!M.active) return;
    state.target = M.base;
    close();
    if (M.restore) { const prev = M.restore; M.restore = null; ctx.restoreFlow(prev); return; }   // 처음부터 수동 배치: back to 셋업
    applyStage(state.step === "target" ? (state.target?.stages?.length ?? 0) : state.stage);
    if (state.tab === "move") showTab("cond");
  }
  async function apply() {
    if (!M.active) return;
    const teeth = editsOf(M.draft, M.baseDraft);
    if (!Object.keys(teeth).length) { toast("옮긴 치아가 없습니다."); return; }
    const btn = $("moveApply"); btn.disabled = true;
    try {
      const res = await api(`/api/cases/${encodeURIComponent(state.meshCase)}/targets/${encodeURIComponent(state.targetId)}/manual`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teeth }) });
      const words = changeWords(M.draft, M.baseDraft, M.base.frames ?? {}, fdi), check = M.check, fromScan = !!M.restore;
      M.restore = null;
      close();
      // the last check's overlaps stay red on the stored target until the stages are validated (the GET gives none)
      if (check && !check.error) res.violations = check.overlaps.map((o) => ({ stage: 1, type: "collision", teeth: o.teeth, overlap_mm3: o.overlap_mm3 }));
      state.target = res; state.targetId = res.target_id; state.targetSummary = null;
      applyStage(res.stages.length);
      ctx.loadTargetCut(res.target_id);
      showTab("cond");
      const est = check && !check.error ? ` · 예상 최소 ${check.min_stages}단계(약 ${check.min_months}개월)` : "";
      addMsg("system", (fromScan ? "치료 전 위치에서 수동 배치한 목표 배열을 저장했습니다" : "직접 이동을 목표 배열에 적용했습니다") + ` — ${words.join(" / ")}${est}.`);
      ctx.afterApply();
    } catch (e) {
      addMsg("error", "직접 이동을 적용하지 못했습니다: " + e.message);
    } finally { btn.disabled = false; }
  }

  // ---- the server check: overlaps and the fewest aligners, a moment after the last change
  function scheduleCheck() { clearTimeout(M.checkTimer); M.checkTimer = setTimeout(runCheck, 250); }
  async function runCheck() {
    if (!M.active) return;
    const seq = ++M.checkSeq;
    $("moveSummary").classList.add("busy");
    try {
      const res = await api(`/api/cases/${encodeURIComponent(state.meshCase)}/targets/${encodeURIComponent(state.targetId)}/check`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teeth: editsOf(M.draft, M.baseDraft) }) });
      if (seq !== M.checkSeq || !M.active) return;
      M.check = res;
      M.view.violations = res.overlaps.map((o) => ({ stage: 1, type: "collision", teeth: o.teeth, overlap_mm3: o.overlap_mm3 }));
      draw();
    } catch (e) {
      if (seq !== M.checkSeq || !M.active) return;
      M.check = { error: e.message };
    } finally { if (seq === M.checkSeq) { $("moveSummary").classList.remove("busy"); renderSummary(); } }
  }

  // ---- the 이동 tab: summary, then one row per crown along the arch
  function renderSummary() {
    const box = $("moveSummary"), c = M.check;
    box.replaceChildren();
    const line = (text, cls = "") => { const p = document.createElement("p"); p.className = cls; p.textContent = text; box.append(p); };
    if (!c) { line("검사 중…", "muted"); return; }
    if (c.error) { line(c.error, "bad"); return; }
    line(`예상 최소 ${c.min_stages}단계 · 약 ${c.min_months}개월`, "l1");
    line(`최대 이동 ${c.max_move_mm}mm · 최대 회전 ${c.max_yaw_deg}° · 장당 0.25mm·2° 기준, 충돌을 피하는 순서 조정으로 더 늘 수 있음`, "muted");
    if (c.overlaps.length) line("겹침 " + c.overlaps.map((o) => `${fdi(o.teeth[0])}-${fdi(o.teeth[1])} ${o.overlap_mm3}mm³`).join(", "), "bad");
    else line("겹침 없음", "ok");
  }
  function renderTable() {
    const box = $("moveTable");
    box.replaceChildren();
    const head = document.createElement("div"); head.className = "mv-row mv-head";
    for (const h of ["치아", "근원심", "협설", "수직", "회전°", ""]) head.append(Object.assign(document.createElement("span"), { textContent: h }));
    box.append(head);
    const lock = locked(), gone = removed(), moved = new Set([...(M.base?.info?.manual_teeth ?? []).map(String), ...Object.keys(editsOf(M.draft, M.baseDraft))]);
    const ids = (state.archOrder.length ? state.archOrder : Object.keys(state.teeth).sort((a, b) => a - b)).filter((id) => state.teeth[id]);
    for (const id of ids) {
      const row = document.createElement("div");
      row.className = "mv-row" + (id === M.sel ? " sel" : "");
      row.dataset.id = id;
      const name = document.createElement("button");
      name.type = "button"; name.className = "mv-id"; name.dataset.act = "pick";
      name.textContent = fdi(id) + (moved.has(id) ? " ✎" : "");
      row.append(name);
      if (gone.has(id) || lock.has(id)) {
        const s = document.createElement("span"); s.className = "mv-note"; s.textContent = gone.has(id) ? "발치" : "고정";
        row.append(s); box.append(row); continue;
      }
      const loc = localOf(M.draft.d[id], frameOf(id));
      for (const k of AXES) row.append(numberInput(id, k, loc[k], STEP_MM * 2, 2));
      row.append(numberInput(id, "yaw", M.draft.yaw[id] ?? 0, STEP_DEG, 1));
      const reset = document.createElement("button");
      reset.type = "button"; reset.className = "mv-reset"; reset.dataset.act = "reset"; reset.title = "이 치아를 적용 전 목표 위치로"; reset.textContent = "↺";
      reset.disabled = !editsOf({ d: { [id]: M.draft.d[id] }, yaw: { [id]: M.draft.yaw[id] } }, M.baseDraft)[id];
      row.append(reset);
      box.append(row);
    }
  }
  function numberInput(id, key, value, step, digits) {
    const i = document.createElement("input");
    i.type = "number"; i.step = String(step); i.value = value.toFixed(digits); i.dataset.key = key; i.dataset.id = id;
    i.setAttribute("aria-label", `${fdi(id)}번 ${{ mesial: "근원심", buccal: "협설", occlusal: "수직", yaw: "회전" }[key]}`);
    return i;
  }
  function renderBar() {
    $("moveSel").textContent = M.sel ? `${fdi(M.sel)}번 선택` : "치아를 눌러 선택";
    $("moveUndo").disabled = !M.undo.length; $("moveRedo").disabled = !M.redo.length;
    $("moveResetTooth").disabled = !M.sel || !editsOf(M.draft, M.baseDraft)[M.sel];
    $("moveResetAll").disabled = !Object.keys(editsOf(M.draft, M.baseDraft)).length;
    $("moveApply").disabled = !Object.keys(editsOf(M.draft, M.baseDraft)).length;
  }
  function select(id) {
    const ok = id && M.draft.d[id] && !locked().has(id);
    if (id && !ok && (removed().has(id) || locked().has(id))) toast(removed().has(id) ? `${fdi(id)}번은 발치하는 치아입니다.` : `${fdi(id)}번은 고정 치아입니다.`);
    M.sel = ok ? id : null;
    draw(); renderTable(); renderBar();
    $("moveTable").querySelector(`.mv-row[data-id="${M.sel}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function resetTooth(id) {
    if (!id || !M.baseDraft.d[id]) return;
    push();
    M.draft.d[id] = [...M.baseDraft.d[id]]; M.draft.yaw[id] = M.baseDraft.yaw[id];
    changed();
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    const s = from.pop();
    M.draft = s;
    changed();
  }

  $("moveTable").addEventListener("change", (e) => {
    const i = e.target.closest("input[data-key]");
    if (!i || !M.active) return;
    const id = i.dataset.id, v = Number(i.value);
    if (!Number.isFinite(v)) { renderTable(); return; }
    push();
    if (i.dataset.key === "yaw") M.draft.yaw[id] = Math.max(-MAX_DEG, Math.min(MAX_DEG, v));
    else M.draft.d[id] = withLocal(M.draft.d[id], frameOf(id), i.dataset.key, Math.max(-MAX_MM, Math.min(MAX_MM, v)));
    if (M.sel !== id) M.sel = id;
    changed();
  });
  $("moveTable").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"), id = b?.closest(".mv-row")?.dataset.id;
    if (!b || !id) return;
    if (b.dataset.act === "pick") select(id === M.sel ? null : id);
    else if (b.dataset.act === "reset") resetTooth(id);
  });
  $("moveTable").addEventListener("focusin", (e) => {
    const id = e.target.closest("input[data-key]")?.dataset.id;
    if (id && id !== M.sel) { M.sel = id; draw(); renderBar(); for (const r of $("moveTable").querySelectorAll(".mv-row")) r.classList.toggle("sel", r.dataset.id === id); }
  });
  $("moveBtn").addEventListener("click", () => (M.active ? cancel() : open()));
  $("moveUndo").addEventListener("click", () => restore(M.undo, M.redo));
  $("moveRedo").addEventListener("click", () => restore(M.redo, M.undo));
  $("moveResetTooth").addEventListener("click", () => resetTooth(M.sel));
  $("moveResetAll").addEventListener("click", () => { push(); M.draft = { d: Object.fromEntries(Object.entries(M.baseDraft.d).map(([k, v]) => [k, [...v]])), yaw: { ...M.baseDraft.yaw } }; changed(); });
  $("moveCancel").addEventListener("click", cancel);
  $("moveApply").addEventListener("click", apply);
  document.addEventListener("keydown", (e) => {
    if (!M.active || e.target.closest?.("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? restore(M.redo, M.undo) : restore(M.undo, M.redo); }
    else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); restore(M.redo, M.undo); }
    else if (k === "escape") select(null);
  });

  // ---- pointer: a press on a handle drags it (the orbit never sees it); a click without a drag picks a crown
  const ndc = (e) => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  const toScreen = (v) => { const p = v.clone().project(camera), r = canvas.getBoundingClientRect(); return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top]; };
  canvas.addEventListener("pointerdown", (e) => {
    if (!M.active || e.button !== 0) return;
    M.down = [e.clientX, e.clientY];
    if (!gizmo.visible) return;
    ray.setFromCamera(ndc(e), camera);
    const hit = ray.intersectObjects(hits, false)[0];
    if (!hit) return;
    e.stopImmediatePropagation(); e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const id = M.sel, handle = hit.object.userData.handle, origin = gizmo.position.clone();
    const drag = { id, handle, start: [e.clientX, e.clientY], d0: [...M.draft.d[id]], yaw0: M.draft.yaw[id] ?? 0 };
    if (handle === "yaw") {
      drag.o = toScreen(origin);
      drag.sign = camera.getWorldDirection(new THREE.Vector3()).z < 0 ? 1 : -1;   // seen from above, screen CCW = CCW about +z
    } else {
      drag.axis = frameOf(id)[handle];
      const a = toScreen(origin), b = toScreen(origin.clone().add(new THREE.Vector3(...drag.axis)));
      drag.px = [b[0] - a[0], b[1] - a[1]];   // screen pixels per mm along the axis
    }
    push();
    M.drag = drag;
  }, { capture: true });
  canvas.addEventListener("pointermove", (e) => {
    const g = M.drag;
    if (!g) return;
    e.stopImmediatePropagation();
    if (g.handle === "yaw") {
      const a0 = Math.atan2(-(g.start[1] - g.o[1]), g.start[0] - g.o[0]), a1 = Math.atan2(-(e.clientY - g.o[1]), e.clientX - g.o[0]);
      let da = ((a1 - a0) * 180) / Math.PI;
      da = ((da + 540) % 360) - 180;
      M.draft.yaw[g.id] = Math.max(-MAX_DEG, Math.min(MAX_DEG, round(g.yaw0 + g.sign * da, STEP_DEG)));
    } else {
      const n2 = g.px[0] ** 2 + g.px[1] ** 2;
      if (n2 < 1e-4) return;   // the axis points at the camera: turn the view first
      const mm = round(((e.clientX - g.start[0]) * g.px[0] + (e.clientY - g.start[1]) * g.px[1]) / n2, STEP_MM);
      const d = g.d0.map((x, k) => x + g.axis[k] * mm);
      if (Math.hypot(...d) <= MAX_MM) M.draft.d[g.id] = d;
    }
    redraw(); renderBar();
  }, { capture: true });
  const endDrag = () => {
    if (!M.drag) return;
    const moved = M.draft.d[M.drag.id].some((x, k) => x !== M.drag.d0[k]) || M.draft.yaw[M.drag.id] !== M.drag.yaw0;
    M.drag = null;
    if (!moved) M.undo.pop();
    changed();
  };
  canvas.addEventListener("pointerup", (e) => {
    if (M.drag) { endDrag(); return; }
    if (!M.active || !M.down || Math.hypot(e.clientX - M.down[0], e.clientY - M.down[1]) > 4) return;
    ray.setFromCamera(ndc(e), camera);
    const hit = ray.intersectObjects(Object.values(state.teeth).filter((m) => m.visible), false)[0];
    select(hit?.object.userData.id ?? null);
  }, { capture: true });
  canvas.addEventListener("pointercancel", endDrag, { capture: true });

  return {
    get active() { return M.active; },
    open, cancel,
    // the flow moved off the 목표 step (a turn, the strip, a plan): the draft is dropped
    leave(step) { if (M.active && step !== "target") cancel(); },
  };
}
