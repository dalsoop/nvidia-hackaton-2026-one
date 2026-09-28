// 직접 이동 (manual target edit): the dentist moves crowns by hand on the 「셋업」 (from the scan) or 「목표」 step.
// A draft of the target is drawn through the viewer's own applyStage (state.target is swapped for the draft while
// editing); a click picks a crown and puts the handles on it (manual-gizmo.js). The 「이동」 tab lists every crown's
// total move from the scan in its own axes, editable as numbers (manual-panel.js). Each change is checked by the server
// (overlaps, the fewest aligners). Leaving the edit keeps it (the button again, 적용, Esc, another step): a change is
// stored as a new target (POST …/manual) that the next stages turn stages as it is; 전부 되돌리기 is the way back.
// On 셋업 a right-click also changes the prescription (manual-rx.js: 발치 · IPR per tooth face).
// This file holds the edit itself: open · leave, the draft and its undo, the server check.

import { MAX_DEG, MAX_MM, STEP_DEG, STEP_MM, DEFAULT_FRAME, changeWords, clamp, copyDraft, editsOf, overlapViolations, snap, withLocal } from "./manual-math.js";
import { createGizmo } from "./manual-gizmo.js";
import { markRow, renderBar, renderSummary, renderTable } from "./manual-panel.js";
import { createSetupMenu } from "./manual-rx.js";

export function createManual(ctx) {
  const { state, $, fdi, api, canvas, applyStage, showTab, addMsg, toast } = ctx;
  const M = { active: false, opening: false, saving: false, step: null, caseId: null, prev: null, base: null, baseDraft: null,
              draft: null, view: null, sel: null, undo: [], redo: [], drag: null, check: null, checkSeq: 0, checkTimer: null, frame: 0, pending: null };
  const url = (tail) => `/api/cases/${encodeURIComponent(state.meshCase)}/targets/${tail}`;
  const post = (tail, body) => api(url(tail), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

  const frameOf = (id) => M.base?.frames?.[id] ?? DEFAULT_FRAME;
  const pivotOf = (id) => M.base?.pivots?.[id] ?? [0, 0, 0];
  const locked = () => new Set((M.base?.target?.locked ?? []).map(String));
  const removed = () => new Set((M.base?.target?.removed ?? []).map(String));
  const edits = () => editsOf(M.draft, M.baseDraft);

  const gizmo = createGizmo(ctx, {
    isActive: () => M.active,
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
    ctx.ghost.visible = true;   // where the crowns started, faint, for the edit only (not 겹쳐 보기: its button and legend stay)
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
  // leaving the edit keeps it: a change is stored as a new target; one the server refuses keeps the edit on, with why
  async function finish(then) {
    if (!M.active || M.saving) return;
    if (M.pending) await M.pending.catch(() => {});   // the 셋업 base under the new prescription first (rebase)
    if (!M.active) return;
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
    if (!i || !M.active) return;
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
    if (!b || !id) return;
    if (b.dataset.act === "pick") select(id === M.sel ? null : id);
    else if (b.dataset.act === "reset") resetTooth(id);
  });
  $("moveTable").addEventListener("focusin", (e) => {
    const id = e.target.closest("input[data-key]")?.dataset.id;
    if (id && id !== M.sel) { M.sel = id; draw(); bar(); markRow($("moveTable"), id); }
  });
  $("moveBtn").addEventListener("click", () => (M.active ? finish() : open()));
  $("moveUndo").addEventListener("click", () => restore(M.undo, M.redo));
  $("moveRedo").addEventListener("click", () => restore(M.redo, M.undo));
  $("moveResetTooth").addEventListener("click", () => resetTooth(M.sel));
  $("moveResetAll").addEventListener("click", () => { push(); M.draft = copyDraft(M.baseDraft); changed(); });
  $("moveApply").addEventListener("click", () => finish());
  document.addEventListener("keydown", (e) => {
    if (!M.active) return;
    if (e.key === "Escape" && menu.isOpen) { menu.close(); return; }   // the right-click menu or its IPR form first
    if (e.target.closest?.("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? restore(M.redo, M.undo) : restore(M.undo, M.redo); }
    else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); restore(M.redo, M.undo); }
    else if (k === "escape") finish();
  });
  // 셋업 only: a right-click on a crown (not the end of a right-drag) opens the prescription menu; elsewhere nothing
  // happens here. An extracted crown is hidden, so a click that meets no shown crown tries the hidden ones (발치 취소).
  let rightDown = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) rightDown = [e.clientX, e.clientY];
    else if (e.button === 0) menu.close();
  });
  canvas.addEventListener("contextmenu", (e) => {
    if (!M.active || M.step !== "setup" || state.step !== "setup" || M.saving) return;
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
