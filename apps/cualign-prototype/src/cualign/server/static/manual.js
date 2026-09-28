// 직접 이동 (manual target edit): the dentist moves crowns by hand on the 「셋업」 (from the scan) or 「목표」 step.
// A draft of the target is drawn through the viewer's own applyStage (state.target is swapped for the draft while
// editing); a click picks a crown and puts the handles on it (manual-gizmo.js). The 「이동」 tab lists every crown's
// total move from the scan in its own axes, editable as numbers (manual-panel.js). Each change is checked by the server
// (overlaps, the fewest aligners); 적용 stores a new target (POST …/manual) that the next stages turn stages as it is.
// This file holds the edit itself: open · cancel · apply, the draft and its undo, the server check.

import { MAX_DEG, MAX_MM, STEP_DEG, STEP_MM, DEFAULT_FRAME, changeWords, clamp, copyDraft, editsOf, overlapViolations, snap, withLocal } from "./manual-math.js";
import { createGizmo } from "./manual-gizmo.js";
import { markRow, renderBar, renderSummary, renderTable } from "./manual-panel.js";

export function createManual(ctx) {
  const { state, $, fdi, api, applyStage, showTab, addMsg, toast } = ctx;
  const M = { active: false, opening: false, base: null, baseDraft: null, draft: null, view: null, sel: null, undo: [], redo: [],
              drag: null, check: null, checkSeq: 0, checkTimer: null, frame: 0, overlayWas: false, restore: null };
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
      ctx.enterTarget(await post("scan"));
      start(prev);
    } catch (e) {
      addMsg("error", "수동 배치를 시작하지 못했습니다: " + e.message);
    } finally { M.opening = false; }
  }
  function start(restoreTo) {
    M.base = state.target;
    const st = M.base.stages?.[0] ?? {}, rot = M.base.rotations?.[0] ?? {}, gone = removed();
    M.baseDraft = { d: {}, yaw: {} };
    for (const id of Object.keys(state.teeth)) {
      if (gone.has(id)) continue;
      M.baseDraft.d[id] = [...(st[id] ?? [0, 0, 0])];
      M.baseDraft.yaw[id] = rot[id] ?? 0;
    }
    M.draft = copyDraft(M.baseDraft);
    M.view = { ...M.base, violations: [], stages: [], rotations: [] };
    Object.assign(M, { undo: [], redo: [], sel: null, check: null, restore: restoreTo, active: true });
    state.selected.clear();
    document.body.classList.add("manual-on");
    $("moveBtn").setAttribute("aria-pressed", "true");
    M.overlayWas = state.overlay;
    if (!state.overlay) $("overlayBtn").click();   // the scan's arch as the white ghost: where the crowns started
    showTab("move");
    draw(); table(); bar(); runCheck();
  }
  function close() {
    M.active = false; M.drag = null; gizmo.hide();
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
    if (state.tab === "move") ctx.followStep(state.step);   // the panel the step shows (app.js STEP_TAB)
  }
  async function apply() {
    if (!M.active) return;
    const teeth = edits();
    if (!Object.keys(teeth).length) { toast("옮긴 치아가 없습니다."); return; }
    const btn = $("moveApply"); btn.disabled = true;
    try {
      const res = await post(`${encodeURIComponent(state.targetId)}/manual`, { teeth });
      const words = changeWords(M.draft, M.baseDraft, M.base.frames ?? {}, fdi), check = M.check, fromScan = !!M.restore;
      M.restore = null;
      close();
      // the last check's overlaps stay red on the stored target until the stages are validated (the GET gives none)
      if (check && !check.error) res.violations = overlapViolations(check.overlaps);
      state.target = res; state.targetId = res.target_id; state.targetSummary = null;
      applyStage(res.stages.length);
      ctx.loadTargetCut(res.target_id);
      ctx.followStep(state.step);
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
      const res = await post(`${encodeURIComponent(state.targetId)}/check`, { teeth: edits() });
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
  $("moveBtn").addEventListener("click", () => (M.active ? cancel() : open()));
  $("moveUndo").addEventListener("click", () => restore(M.undo, M.redo));
  $("moveRedo").addEventListener("click", () => restore(M.redo, M.undo));
  $("moveResetTooth").addEventListener("click", () => resetTooth(M.sel));
  $("moveResetAll").addEventListener("click", () => { push(); M.draft = copyDraft(M.baseDraft); changed(); });
  $("moveCancel").addEventListener("click", cancel);
  $("moveApply").addEventListener("click", apply);
  document.addEventListener("keydown", (e) => {
    if (!M.active || e.target.closest?.("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? restore(M.redo, M.undo) : restore(M.undo, M.redo); }
    else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); restore(M.redo, M.undo); }
    else if (k === "escape") select(null);
  });

  return {
    get active() { return M.active; },
    open, cancel,
    // the flow moved off the 목표 step (a turn, the strip, a plan): the draft is dropped
    leave(step) { if (M.active && step !== "target") cancel(); },
  };
}
