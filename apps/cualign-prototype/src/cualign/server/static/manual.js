// 직접 이동 (manual target edit): the dentist moves crowns by hand on the 「셋업」 (from the scan) or 「목표」 step.
// A draft of the target is drawn through the viewer's own applyStage (state.target is swapped for the draft while
// editing); a click picks a crown and puts the handles on it (manual-gizmo.js). The 「이동」 tab lists every crown's
// total move from the scan in its own axes, editable as numbers (manual-panel.js). Each change is checked by the server
// (overlaps, the fewest aligners). A crown moves only by its handles, after a click picked it (a drag that starts on a
// crown turns the view). 적용 stores the change as a new target (POST …/manual) that the next stages turn stages as it
// is. Leaving the edit otherwise (the button again, Esc, another step) stores it too, but only a crown moved 0.05 mm or
// turned 0.5° or more, and only after a line over the 3D (「26번 2.4 mm 옮김 — 저장 / 되돌리기」) has stood 3 s:
// 되돌리기 there leaves the target as it was. Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) work wherever the focus is while the edit
// is on, and a Ctrl+Z just after a store opens the edit again on the stored target one step back (stored again on leaving).
// On 셋업 the edit starts from the scan (POST …/targets/scan answers a start that is not stored: target_id "scan"); only
// an applied edit stores it, as the stored target's parent.
// On 셋업 a right-click also changes the prescription (manual-rx.js: 발치 · IPR per tooth face).
// This file holds the edit itself: open · leave, the draft and its undo, the server check.

import { MAX_DEG, MAX_MM, STEP_DEG, STEP_MM, DEFAULT_FRAME, changeWords, clamp, copyDraft, editsOf, overlapViolations, snap, withLocal } from "./manual-math.js";
import { createGizmo } from "./manual-gizmo.js";
import { markRow, renderBar, renderSummary, renderTable } from "./manual-panel.js";
import { createSetupMenu } from "./manual-rx.js";

export function createManual(ctx) {
  const { state, $, fdi, api, canvas, applyStage, showTab, addMsg, toast } = ctx;
  const M = { active: false, opening: false, saving: false, step: null, caseId: null, prev: null, base: null, baseDraft: null,
              draft: null, view: null, sel: null, undo: [], redo: [], drag: null, check: null, checkSeq: 0, checkTimer: null, frame: 0, pending: null,
              confirm: null,   // leaving with a move: {then, timer} while the line over the 3D stands
              saved: null };   // the last store: {caseId, targetId, undo} — a Ctrl+Z right after it opens the edit again
  const url = (tail) => `/api/cases/${encodeURIComponent(state.meshCase)}/targets/${tail}`;
  const post = (tail, body) => api(url(tail), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

  const frameOf = (id) => M.base?.frames?.[id] ?? DEFAULT_FRAME;
  const pivotOf = (id) => M.base?.pivots?.[id] ?? [0, 0, 0];
  const locked = () => new Set((M.base?.target?.locked ?? []).map(String));
  const removed = () => new Set((M.base?.target?.removed ?? []).map(String));
  const edits = () => editsOf(M.draft, M.baseDraft);
  const MIN_MM = 0.05, MIN_DEG = 0.5;   // below this a crown did not move (a press, a table nudge): not stored
  const moveOf = (id) => { const d = M.draft.d[id], b = M.baseDraft.d[id] ?? [0, 0, 0]; return Math.hypot(d[0] - b[0], d[1] - b[1], d[2] - b[2]); };
  const turnOf = (id) => (M.draft.yaw[id] ?? 0) - (M.baseDraft.yaw[id] ?? 0);
  const real = (id) => moveOf(id) >= MIN_MM - 1e-6 || Math.abs(turnOf(id)) >= MIN_DEG - 1e-6;
  // the crowns moved less than that go back to the base, so what is stored and said is what really moved
  function settle() {
    for (const id of Object.keys(edits())) if (!real(id)) { M.draft.d[id] = [...M.baseDraft.d[id]]; M.draft.yaw[id] = M.baseDraft.yaw[id]; }
  }

  const gizmo = createGizmo(ctx, {
    isActive: () => M.active && !M.confirm,
    onDragStart(handle) {
      if (!M.sel) return false;
      push();
      M.drag = { id: M.sel, handle, d0: [...M.draft.d[M.sel]], yaw0: M.draft.yaw[M.sel] ?? 0 };
    },
    onDrag(handle, amount) {
      const g = M.drag;
      if (handle === "yaw") M.draft.yaw[g.id] = clamp(snap(g.yaw0 + amount, STEP_DEG), MAX_DEG);
      else {
        const mm = snap(amount, STEP_MM), a = frameOf(g.id)[handle], d = g.d0.map((x, k) => x + a[k] * mm);
        if (Math.hypot(...d) <= MAX_MM) M.draft.d[g.id] = d;
      }
      redraw(); bar();
    },
    onDragEnd() {
      const g = M.drag; M.drag = null;
      if (!g) return;
      if (!M.draft.d[g.id].some((x, k) => x !== g.d0[k]) && M.draft.yaw[g.id] === g.yaw0) M.undo.pop();   // a press without a move
      changed();
    },
    onClick(e) { select(gizmo.pick(e, Object.values(state.teeth).filter((m) => m.visible))?.object.userData.id ?? null); },
  });

  // ---- drawing: the draft as the target (one stage, the rotations, the server's overlaps as collisions)
  function draw() {
    M.view.stages = [{ ...M.draft.d }];
    M.view.rotations = [{ ...M.draft.yaw }];
    state.target = M.view;
    applyStage(1);
    const m = state.teeth[M.sel];
    if (m) m.material.emissive.setHex(0x5a9400);
    if (M.active && M.sel && M.draft.d[M.sel]) {
      const c = pivotOf(M.sel), d = M.draft.d[M.sel];
      gizmo.show([c[0] + d[0], c[1] + d[1], c[2] + d[2]], frameOf(M.sel));
    } else gizmo.hide();
  }
  function redraw() {   // at most once a frame while dragging (applyStage bends the gum too)
    if (M.frame) return;
    M.frame = requestAnimationFrame(() => { M.frame = 0; if (M.active) draw(); });
  }
  function table() {
    const ids = (state.archOrder.length ? state.archOrder : Object.keys(state.teeth).sort((a, b) => a - b)).filter((id) => state.teeth[id]);
    const e = edits();
    renderTable($("moveTable"), { ids, sel: M.sel, draft: M.draft, frameOf, locked: locked(), removed: removed(), edited: (id) => !!e[id],
                                  moved: new Set([...(M.base?.info?.manual_teeth ?? []).map(String), ...Object.keys(e)]) }, fdi);
  }
  function bar() {
    const e = edits();
    renderBar($, { sel: M.sel, canUndo: M.undo.length > 0, canRedo: M.redo.length > 0, selEdited: !!(M.sel && e[M.sel]), anyEdited: Object.keys(e).length > 0 }, fdi);
  }
  function changed() { redraw(); table(); bar(); scheduleCheck(); }
  function push() { M.undo.push(copyDraft(M.draft)); if (M.undo.length > 100) M.undo.shift(); M.redo = []; }
  function restore(from, to) {
    if (!from.length) return;
    to.push(copyDraft(M.draft));
    M.draft = from.pop();
    changed();
  }

  // ---- open / leave. On 셋업 the edit starts from the scan: the server makes a target with every crown in place under
  // the case's prescription (POST …/targets/scan), drawn as the draft while the step stays 셋업; a stored change makes
  // it the 목표. On 목표 the edit starts from the target on screen.
  async function open() {
    if (M.active) { showTab("move"); return; }
    if (state.streaming || state.loading || M.opening) return;
    if (state.step === "setup") return openOnSetup();
    if (state.step !== "target" || !state.target || !state.targetId) { toast("셋업이나 목표 단계에서 직접 이동할 수 있습니다."); return; }
    start(state.target, "target");
  }
  async function openOnSetup() {
    M.opening = true;
    try { start(await post("scan"), "setup"); }
    catch (e) { addMsg("error", "직접 이동을 시작하지 못했습니다: " + e.message); }
    finally { M.opening = false; }
  }
  // the edit's base: its crowns where the target has them; `keep` (the poses edited so far) stays on the crowns still there
  function setBase(base, keep = {}) {
    M.base = base;
    const st = base.stages?.[0] ?? {}, rot = base.rotations?.[0] ?? {}, gone = removed();
    M.baseDraft = { d: {}, yaw: {} };
    for (const id of Object.keys(state.teeth)) {
      if (gone.has(id)) continue;
      M.baseDraft.d[id] = [...(st[id] ?? [0, 0, 0])];
      M.baseDraft.yaw[id] = rot[id] ?? 0;
    }
    M.draft = copyDraft(M.baseDraft);
    for (const [id, p] of Object.entries(keep)) if (M.draft.d[id]) { M.draft.d[id] = [...p.d]; M.draft.yaw[id] = p.yaw; }
    M.view = { ...base, violations: [], stages: [], rotations: [] };
  }
  function start(base, step) {
    Object.assign(M, { step, caseId: state.meshCase, prev: { target: state.target, targetId: state.targetId } });
    setBase(base);
    Object.assign(M, { undo: [], redo: [], sel: null, check: null, active: true });
    state.selected.clear();
    document.body.classList.add("manual-on");
    $("moveBtn").setAttribute("aria-pressed", "true");
    showTab("move");
    draw(); table(); bar(); runCheck();
  }
  function close() {
    unconfirm();
    M.active = false; M.drag = null; gizmo.hide(); menu.close();
    clearTimeout(M.checkTimer); M.checkSeq++;
    document.body.classList.remove("manual-on");
    $("moveBtn").setAttribute("aria-pressed", "false");
  }
  // nothing moved: the view as it was before the edit
  function discard() {
    state.target = M.prev.target; state.targetId = M.prev.targetId;
    close();
    applyStage(state.step === "target" ? (state.target?.stages?.length ?? 0) : 0);
    if (state.tab === "move") ctx.followStep(state.step);   // the panel the step shows (app.js STEP_TAB)
  }
  // another case is opening (or this one restarts): the edit belongs to the old one and is not stored
  function drop() { if (M.active) close(); }
  // leaving the edit keeps a real move: stored as a new target (at once for 적용 — `now` —, otherwise once the line over
  // the 3D has stood 3 s); nothing moved, the view goes back as it was. One the server refuses keeps the edit on, with why
  async function finish(then, now = false) {
    if (!M.active || M.saving) return;
    if (M.confirm) {   // the line already stands: 적용 stores at once, another leave only changes where to go after
      if (now) { const c = M.confirm; unconfirm(); save(c.then ?? then); } else if (then) M.confirm.then = then;
      return;
    }
    if (M.pending) await M.pending.catch(() => {});   // the 셋업 base under the new prescription first (rebase)
    if (!M.active) return;
    settle();
    if (!Object.keys(edits()).length) { discard(); then?.(); return; }
    if (now) save(then); else confirm(then);
  }
  // the line over the 3D: what moved, 저장 / 되돌리기, stored by itself after 3 s
  let bar3d = null;
  function confirm(then) {
    M.drag = null; gizmo.hide(); menu.close();
    if (!bar3d) {
      bar3d = document.createElement("div");
      bar3d.className = "move-confirm";
      bar3d.setAttribute("role", "status");
      Object.assign(bar3d.style, { position: "absolute", left: "50%", bottom: "72px", transform: "translateX(-50%)", zIndex: 30, display: "none",
        alignItems: "center", gap: "8px", padding: "6px 8px 6px 12px", background: "var(--panel)", border: "1px solid var(--line)",
        borderRadius: "var(--radius)", fontSize: "13px", whiteSpace: "nowrap" });
      const text = document.createElement("span"), ok = document.createElement("button"), back = document.createElement("button");
      text.className = "mc-text";
      ok.type = back.type = "button"; ok.className = "btn primary small"; back.className = "btn ghost small";
      ok.dataset.act = "save"; ok.textContent = "저장"; back.dataset.act = "undo"; back.textContent = "되돌리기";
      bar3d.append(text, ok, back);
      bar3d.addEventListener("click", (e) => {
        const act = e.target.closest("button")?.dataset.act, c = M.confirm;
        if (!act || !c) return;
        unconfirm();
        if (act === "save") save(c.then);
        else { discard(); c.then?.(); }   // not stored: the target as it was
      });
      canvas.parentElement.append(bar3d);
    }
    const ids = Object.keys(edits()).sort((a, b) => fdi(a) - fdi(b));
    const words = ids.map((id) => `${fdi(id)}번 ` + [moveOf(id) >= MIN_MM - 1e-6 ? `${moveOf(id).toFixed(1)} mm` : "",
                                                    Math.abs(turnOf(id)) >= MIN_DEG - 1e-6 ? `${turnOf(id).toFixed(1)}°` : ""].filter(Boolean).join(" · "));
    bar3d.querySelector(".mc-text").textContent = `${words.join(", ")} 옮김 — 3초 뒤 저장`;
    bar3d.style.display = "flex";
    M.confirm = { then, timer: setTimeout(() => { const c = M.confirm; if (!c) return; unconfirm(); save(c.then); }, 3000) };
  }
  function unconfirm() {
    if (!M.confirm) return;
    clearTimeout(M.confirm.timer); M.confirm = null;
    bar3d.style.display = "none";
  }
  async function save(then) {
    if (!M.active || M.saving) return;
    const teeth = edits();
    if (!Object.keys(teeth).length) { discard(); then?.(); return; }
    M.saving = true; $("moveApply").disabled = true;
    let res;
    try {
      res = await post(`${encodeURIComponent(M.base.target_id)}/manual`, { teeth });
    } catch (e) {
      M.check = { error: "저장하지 못해 직접 이동을 끝내지 않았습니다 — " + e.message };
      renderSummary($("moveSummary"), M.check, fdi); showTab("move");
      toast("직접 이동을 저장하지 못했습니다: " + e.message);
      return;
    } finally { M.saving = false; if (M.active) bar(); }
    const words = changeWords(M.draft, M.baseDraft, M.base.frames ?? {}, fdi), check = M.check, fromScan = M.step === "setup";
    M.saved = { caseId: M.caseId, targetId: res.target_id, undo: M.undo };   // the stored target is the base now; the steps stay for Ctrl+Z
    close();
    // the last check's overlaps stay red on the stored target until the stages are validated (the GET gives none)
    if (check && !check.error) res.violations = overlapViolations(check.overlaps);
    if (fromScan) ctx.enterTarget(res);   // the scan-position edit becomes the 목표
    else {
      state.target = res; state.targetId = res.target_id; state.targetSummary = null;
      applyStage(res.stages.length);
      ctx.loadTargetCut(res.target_id);
      ctx.followStep(state.step);
    }
    const est = check && !check.error ? ` · 예상 최소 ${check.min_stages}단계(약 ${check.min_months}개월)` : "";
    addMsg("system", (fromScan ? "치료 전 위치에서 직접 옮긴 목표 배열을 저장했습니다" : "직접 이동을 목표 배열에 저장했습니다") + ` — ${words.join(" / ")}${est}.`);
    ctx.afterApply();
    then?.();
  }
  // Ctrl+Z just after a store: the edit opens again on the stored target, one step back (leaving stores it again)
  function resume() {
    const s = M.saved;
    if (!s?.undo.length || s.caseId !== state.meshCase || s.targetId !== state.targetId || state.step !== "target" || !state.target
        || state.streaming || state.loading || M.opening) return false;
    M.saved = null;
    start(state.target, "target");
    M.undo = s.undo;
    restore(M.undo, M.redo);
    return true;
  }
  // the 셋업 prescription changed (manual-rx.js): the edit goes on over a scan target made under it
  async function rebase() {
    M.pending = post("scan");
    let base;
    try { base = await M.pending; } finally { M.pending = null; }
    if (!M.active) return;
    // the poses as they are now: a crown moved while the new base was on its way stays moved
    const keep = Object.fromEntries(Object.keys(edits()).map((id) => [id, { d: M.draft.d[id], yaw: M.draft.yaw[id] }]));
    M.prev = { target: null, targetId: null };   // a later target is stale now (the server's flow is back at 셋업)
    setBase(base, keep);
    Object.assign(M, { undo: [], redo: [], check: null });
    if (M.sel && !M.draft.d[M.sel]) M.sel = null;
    draw(); table(); bar(); scheduleCheck();
  }
  const menu = createSetupMenu(ctx, { rx: () => M.base?.constraints ?? {}, onChanged: rebase });

  // ---- the server check: overlaps and the fewest aligners, a moment after the last change
  function scheduleCheck() { clearTimeout(M.checkTimer); M.checkTimer = setTimeout(runCheck, 250); }
  async function runCheck() {
    if (!M.active) return;
    const seq = ++M.checkSeq;
    $("moveSummary").classList.add("busy");
    try {
      const res = await post(`${encodeURIComponent(M.base.target_id)}/check`, { teeth: edits() });
      if (seq !== M.checkSeq || !M.active) return;
      M.check = res;
      M.view.violations = overlapViolations(res.overlaps);
      draw();
    } catch (e) {
      if (seq !== M.checkSeq || !M.active) return;
      M.check = { error: e.message };
    } finally { if (seq === M.checkSeq) { $("moveSummary").classList.remove("busy"); renderSummary($("moveSummary"), M.check, fdi); } }
  }

  // ---- selection and the per-tooth resets
  function select(id) {
    const ok = id && M.draft.d[id] && !locked().has(id);
    if (id && !ok && (removed().has(id) || locked().has(id))) toast(removed().has(id) ? `${fdi(id)}번은 발치하는 치아입니다.` : `${fdi(id)}번은 고정 치아입니다.`);
    M.sel = ok ? id : null;
    draw(); table(); bar();
    $("moveTable").querySelector(`.mv-row[data-id="${M.sel}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function resetTooth(id) {
    if (!id || !M.baseDraft.d[id]) return;
    push();
    M.draft.d[id] = [...M.baseDraft.d[id]]; M.draft.yaw[id] = M.baseDraft.yaw[id];
    changed();
  }

  // ---- events: the table, the edit bar, the keys
  $("moveTable").addEventListener("change", (e) => {
    const i = e.target.closest("input[data-key]");
    if (!i || !M.active || M.saving) return;
    unconfirm();   // a number typed while the line stands: the edit goes on
    const id = i.dataset.id, v = Number(i.value);
    if (!Number.isFinite(v)) { table(); return; }
    push();
    if (i.dataset.key === "yaw") M.draft.yaw[id] = clamp(v, MAX_DEG);
    else M.draft.d[id] = withLocal(M.draft.d[id], frameOf(id), i.dataset.key, clamp(v, MAX_MM));
    M.sel = id;
    changed();
  });
  $("moveTable").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"), id = b?.closest(".mv-row")?.dataset.id;
    if (!b || !id || M.confirm) return;
    if (b.dataset.act === "pick") select(id === M.sel ? null : id);
    else if (b.dataset.act === "reset") resetTooth(id);
  });
  $("moveTable").addEventListener("focusin", (e) => {
    const id = e.target.closest("input[data-key]")?.dataset.id;
    if (id && id !== M.sel) { M.sel = id; draw(); bar(); markRow($("moveTable"), id); }
  });
  $("moveBtn").addEventListener("click", () => (M.active ? finish() : open()));
  $("moveUndo").addEventListener("click", () => { unconfirm(); restore(M.undo, M.redo); });
  $("moveRedo").addEventListener("click", () => { unconfirm(); restore(M.redo, M.undo); });
  $("moveResetTooth").addEventListener("click", () => { unconfirm(); resetTooth(M.sel); });
  $("moveResetAll").addEventListener("click", () => { unconfirm(); push(); M.draft = copyDraft(M.baseDraft); changed(); });
  $("moveApply").addEventListener("click", () => finish(null, true));
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on window in the capture phase: while the edit is on no field or button keeps them (the
  // move table's inputs, the chat box). The key is read by its place (e.code): with the Korean layout in 한글 mode e.key
  // is 「ㅋ」, not 「z」. With the edit off, only a Ctrl+Z right after a store and outside a text field (resume).
  const keyIs = (e, c) => e.code === "Key" + c.toUpperCase() || e.key?.toLowerCase() === c;
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
    const undo = keyIs(e, "z") && !e.shiftKey, redo = (keyIs(e, "z") && e.shiftKey) || (keyIs(e, "y") && !e.shiftKey);
    if (!undo && !redo) return;
    if (!M.active) {
      if (undo && !e.target.closest?.("input, textarea, select, [contenteditable]") && resume()) e.preventDefault();
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (M.saving) return;
    unconfirm();   // an undo while the line stands: the edit goes on
    if (undo) restore(M.undo, M.redo); else restore(M.redo, M.undo);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!M.active) return;
    if (e.key === "Escape" && menu.isOpen) { menu.close(); return; }   // the right-click menu or its IPR form first
    if (e.target.closest?.("input, textarea, select")) return;
    if (e.key === "Escape") finish();
  });
  // 셋업 only: a right-click on a crown (not the end of a right-drag) opens the prescription menu; elsewhere nothing
  // happens here. An extracted crown is hidden, so a click that meets no shown crown tries the hidden ones (발치 취소).
  let rightDown = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) rightDown = [e.clientX, e.clientY];
    else if (e.button === 0) menu.close();
  });
  canvas.addEventListener("contextmenu", (e) => {
    if (!M.active || M.step !== "setup" || state.step !== "setup" || M.saving || M.confirm) return;
    if (rightDown && Math.hypot(e.clientX - rightDown[0], e.clientY - rightDown[1]) > 4) return;
    const teeth = Object.values(state.teeth);
    const id = (gizmo.pick(e, teeth.filter((m) => m.visible)) ?? gizmo.pick(e, teeth.filter((m) => !m.visible)))?.object.userData.id;
    if (!id) { menu.close(); return; }
    e.preventDefault();
    menu.open(e, id);
  });

  return {
    get active() { return M.active; },
    open,
    // the flow is going to another step (the strip, a turn, a plan): the edit is kept — stored first, then the step
    // follows (true = wait: finish() moves on once stored). Another case (or a restart) drops it unsaved.
    leave(step) {
      if (!M.active) return false;
      if (M.caseId !== state.meshCase) { drop(); return false; }
      if (step === M.step) return false;
      if (!Object.keys(edits()).length) { discard(); return false; }
      finish(() => { if (state.step !== step) ctx.setStep(step); });
      return true;
    },
    drop,
  };
}
