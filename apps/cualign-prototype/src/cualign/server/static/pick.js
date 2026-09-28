// app.js 에서 나눈 모듈: the 3D under the pointer — hover tooltip, click to pick a tooth, the stage slider's marks,
// keep or undo a new plan, the 3D focus.
import { THREE } from "./three-load.js";
import { $, STRATEGY_KO, fdi, manualEdit, state } from "./state.js";
import { applyStage, camera, canvas, ghost, group, raycaster } from "./viewer.js";
// defined in later modules: app.js hands them in (wire) before any of them is called
let REDUCE_MOTION, addMsg, loadPlan, markChartSelection, stopPlay;
export function wire(fns) { ({ REDUCE_MOTION, addMsg, loadPlan, markChartSelection, stopPlay } = fns); }

// ---- hover tooltip: tooth number · cumulative move · violations at this stage (number only on hover, as in 5/5 SW)
function onPointerMove(e) {
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(p, camera);
  const hit = raycaster.intersectObjects(group.children.filter((o) => o.isMesh && o.visible && !o.userData.gum))[0];
  canvas.style.cursor = hit ? "pointer" : "";
  if (hit && state.plan && !state.pickedOnce && !localStorage.getItem("cualign.pickHint")) showPickHint();
  const tip = $("tip");
  if (!hit) { tip.hidden = true; return; }
  const m = hit.object, id = m.userData.id;
  const parts = [`치아 ${fdi(id)}`];
  if (state.plan) parts.push(`누적 이동 ${(m.userData.moved ?? 0).toFixed(2)} mm`);
  if (m.userData.viol?.length) parts.push(`위반: ${m.userData.viol.join(", ")}`);
  if ((state.plan?.target?.locked ?? []).map(String).includes(id)) parts.push("고정");
  if ((state.plan?.target?.removed ?? []).map(String).includes(id)) parts.push("발치");
  if (parts.length === 1) { tip.hidden = true; return; }
  tip.textContent = parts.join(" · ");
  tip.style.left = `${e.clientX - r.left + 12}px`;
  tip.style.top = `${e.clientY - r.top + 12}px`;
  tip.hidden = false;
}

// the first time the pointer rests on a tooth: one line saying what a click does, once per browser (#14)
function showPickHint() {
  localStorage.setItem("cualign.pickHint", "1");
  $("pickHint").hidden = false;
  setTimeout(() => { $("pickHint").hidden = true; }, 8000);
}
// ---- click a tooth to name it in the chat (#90): a click without a drag toggles it; drags still orbit
function toothAt(e) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return raycaster.intersectObjects(group.children.filter((o) => o.isMesh && o.visible && !o.userData.gum))[0]?.object.userData.id ?? null;
}
function renderSelection() {
  for (const [id, m] of Object.entries(state.teeth)) m.material.emissive.setHex(state.selected.has(id) ? 0x5a9400 : 0x000000);
  markChartSelection();
  const box = $("selChips");
  box.innerHTML = "";
  const attached = attachedTeeth();
  box.hidden = !attached.length;
  if (!attached.length) return;
  box.append("선택한 치아 · 다음 메시지에 함께 보냅니다");
  for (const id of attached.sort((a, b) => fdi(a) - fdi(b))) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.id = id; b.textContent = `${fdi(id)}번 ✕`; b.title = "선택 해제";
    box.append(b);
  }
  const clear = document.createElement("button");
  clear.type = "button"; clear.className = "clear"; clear.textContent = "모두 해제";
  box.append(clear);
}
// the teeth the next message names: the dentist's clicks, not the ones a violation lit
const attachedTeeth = () => [...state.selected].filter((id) => !state.ruleMarked.has(id));
let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (manualEdit.active) return;   // 직접 이동: a click picks the crown to move (manual.js), not a tooth for the chat
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const id = toothAt(e);
  if (!id) return;
  // a tooth a violation lit becomes the dentist's own on a click (attached from now on); otherwise the click toggles
  if (state.ruleMarked.has(id)) state.ruleMarked.delete(id);
  else if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  state.pickedOnce = true; $("pickedLegend").hidden = false; $("pickHint").hidden = true;
  renderSelection();
});
$("selChips").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("clear")) { for (const id of attachedTeeth()) state.selected.delete(id); } else state.selected.delete(b.dataset.id);
  renderSelection();
});

// ---- marks over the stage slider (#90): where the rules found a collision or a per-stage limit breach
function renderStageMarks() {
  const box = $("stageMarks");
  box.innerHTML = "";
  const n = state.plan?.stages?.length ?? 0;
  if (!n) return;
  const by = {};
  for (const v of state.plan.violations ?? []) {
    if (v.stage == null || !["collision", "move_limit"].includes(v.type)) continue;
    const s = (by[v.stage] ??= { collision: 0, move_limit: 0 }); s[v.type]++;
  }
  for (const [k, s] of Object.entries(by)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "stage-mark " + (s.collision ? "collision" : "move_limit");
    b.style.left = `${(+k / n) * 100}%`;
    b.dataset.tip = `단계 ${k} · ` + [s.collision && `충돌 ${s.collision}건`, s.move_limit && `한계 초과 ${s.move_limit}건`].filter(Boolean).join(" · ");
    b.setAttribute("aria-label", b.dataset.tip);
    b.addEventListener("click", () => { stopPlay(); applyStage(+k); });
    box.append(b);
  }
}

// ---- keep or undo a new plan (#90): the previous plan stays one click away after every replanning
function addDecision(prevId, newId) {
  if (!prevId || !newId || prevId === newId) return;
  const bar = document.createElement("div");
  bar.className = "decision";
  bar.innerHTML = `<span></span><button class="btn ghost small" type="button" data-act="revert">이전 안으로 되돌리기</button>`;
  const say = (t) => { bar.querySelector("span").textContent = t; };
  // the dentist reads strategy and stages; the ids stay in the tooltip (DESIGN.md: no plan ids on screen)
  const kind = (p) => (["passed", "running", "failed"].includes(p?.review?.status) ? "에이전트 계획" : "규칙 계산");
  const newRow = state.plan?.plan_id === newId ? { strategy: state.plan.strategy, n_stages: state.plan.info?.n_stages, review: state.plan.review } : state.planRows[newId];
  const prevRow = state.planRows[prevId];
  const newText = `${kind(newRow)} · ${planWords(newRow)}`, prevText = `${kind(prevRow)} · ${planWords(prevRow)}`;
  bar.title = `새 계획 ${newId} · 이전 계획 ${prevId}`;
  say(`3D가 새 안(${newText})으로 바뀌었습니다. 이전 안: ${prevText}`);
  bar.addEventListener("click", async (e) => {
    const act = e.target.dataset?.act;
    if (!act || state.streaming || state.loading) return;
    if (act === "revert") {
      try {
        await loadPlan(prevId);
        say(`이전 계획(${prevText})으로 되돌렸습니다. 다음 요청은 이 계획에서 이어집니다.`);
        // the model hears about it too, so the next revision starts from the plan on screen
        state.messages.push({ role: "user", content: `[화면 조작] 새 계획을 버리고 이전 계획(${prevId})으로 되돌렸습니다. 다음 요청은 이 계획을 기준으로 해 주세요.` });
      } catch (err) { addMsg("error", "되돌리기 실패: " + err.message); return; }
    }
    bar.querySelectorAll("button").forEach((b) => b.remove());
    bar.classList.add("done");
  });
  $("transcript").appendChild(bar);
  $("transcript").scrollTop = $("transcript").scrollHeight;
}

// 「발치 20단계」: a plan in the dentist's words, from a /api/plans row or the plan on screen
function planWords(p) {
  return p ? `${STRATEGY_KO[p.strategy] ?? p.strategy} ${p.n_stages}단계` : "—";
}

// 크게 보기: the panels slide out (back in) over FOCUS_MS while the 3D column widens (narrows) with them (style.css
// body.focus-moving); the 3D's ResizeObserver resizes the renderer every frame. Reduced motion or a drawer layout: at once.
const FOCUS_MS = 220, WIDE = matchMedia("(min-width: 1281px)");
function setFocus3d(on) {
  const b = document.body;
  clearTimeout(setFocus3d.timer);
  if (REDUCE_MOTION.matches || !WIDE.matches) { b.classList.remove("focus-moving"); b.classList.toggle("focus3d", on); return; }
  b.classList.add("focus-moving");
  void getComputedStyle($("side")).opacity;   // coming back, the panels are laid out (off display: none) before the columns move
  b.classList.toggle("focus3d", on);
  setFocus3d.timer = setTimeout(() => b.classList.remove("focus-moving"), FOCUS_MS);
}
$("focusBtn").addEventListener("click", (e) => {
  const on = !document.body.classList.contains("focus3d");
  setFocus3d(on); e.currentTarget.setAttribute("aria-pressed", String(on));
  e.currentTarget.setAttribute("aria-label", on ? "대화 · 대화 패널을 다시 엽니다" : "크게 · 대화 패널을 접고 3D를 크게 봅니다");
});
$("overlayBtn").addEventListener("click", (e) => {
  state.overlay = !state.overlay;
  e.currentTarget.setAttribute("aria-pressed", String(state.overlay));
  $("overlayLegend").hidden = !state.overlay;
  ghost.visible = state.overlay && state.stage > 0;
});
$("firstBtn").addEventListener("click", () => { state.stageTouched = true; stopPlay(); applyStage(0); });
$("lastBtn").addEventListener("click", () => { if (state.plan) { state.stageTouched = true; stopPlay(); applyStage(state.plan.stages.length); } });

export { addDecision, attachedTeeth, onPointerMove, renderSelection, renderStageMarks };
