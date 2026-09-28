// 직접 이동의 화면 요소 그리기: 「이동」 탭의 요약(서버 검사)과 치아별 표, 3D 아래 편집 막대의 상태.
// 상태는 인자로만 받고 이벤트는 manual.js 가 단다 (표는 data-id·data-key·data-act 로 무엇을 눌렀는지 알린다).

import { AXES, AXIS_KO, STEP_DEG, STEP_MM, localOf } from "./manual-math.js";

// the server check: {min_stages, min_months, max_move_mm, max_yaw_deg, overlaps} | {error} | null (running)
export function renderSummary(box, check, fdi) {
  box.replaceChildren();
  const line = (text, cls = "") => { const p = document.createElement("p"); p.className = cls; p.textContent = text; box.append(p); };
  if (!check) { line("검사 중…", "muted"); return; }
  if (check.error) { line(check.error, "bad"); return; }
  line(`예상 최소 ${check.min_stages}단계 · 약 ${check.min_months}개월`, "l1");
  line(`최대 이동 ${check.max_move_mm}mm · 최대 회전 ${check.max_yaw_deg}° · 장당 0.25mm·2° 기준, 충돌을 피하는 순서 조정으로 더 늘 수 있음`, "muted");
  if (check.overlaps.length) line("겹침 " + check.overlaps.map((o) => `${fdi(o.teeth[0])}-${fdi(o.teeth[1])} ${o.overlap_mm3}mm³`).join(", "), "bad");
  else line("겹침 없음", "ok");
}

// one row per crown along the arch. t = {ids, sel, draft, frameOf(id), locked: Set, removed: Set, moved: Set, edited(id)}
export function renderTable(box, t, fdi) {
  box.replaceChildren();
  const head = document.createElement("div"); head.className = "mv-row mv-head";
  for (const h of ["치아", "근원심", "협설", "수직", "회전°", ""]) head.append(Object.assign(document.createElement("span"), { textContent: h }));
  box.append(head);
  for (const id of t.ids) {
    const row = document.createElement("div");
    row.className = "mv-row" + (id === t.sel ? " sel" : "");
    row.dataset.id = id;
    const name = document.createElement("button");
    name.type = "button"; name.className = "mv-id"; name.dataset.act = "pick";
    name.textContent = fdi(id) + (t.moved.has(id) ? " ✎" : "");
    row.append(name);
    if (t.removed.has(id) || t.locked.has(id)) {
      const s = document.createElement("span"); s.className = "mv-note"; s.textContent = t.removed.has(id) ? "발치" : "고정";
      row.append(s); box.append(row); continue;
    }
    const loc = localOf(t.draft.d[id], t.frameOf(id));
    for (const k of AXES) row.append(numberInput(id, k, loc[k], STEP_MM * 2, 2, fdi));
    row.append(numberInput(id, "yaw", t.draft.yaw[id] ?? 0, STEP_DEG, 1, fdi));
    const reset = document.createElement("button");
    reset.type = "button"; reset.className = "mv-reset"; reset.dataset.act = "reset"; reset.title = "이 치아를 적용 전 목표 위치로"; reset.textContent = "↺";
    reset.disabled = !t.edited(id);
    row.append(reset);
    box.append(row);
  }
}
function numberInput(id, key, value, step, digits, fdi) {
  const i = document.createElement("input");
  i.type = "number"; i.step = String(step); i.value = value.toFixed(digits); i.dataset.key = key; i.dataset.id = id;
  i.setAttribute("aria-label", `${fdi(id)}번 ${AXIS_KO[key]}`);
  return i;
}
// the table's selected row, without redrawing it (a focused input keeps its caret)
export function markRow(box, id) {
  for (const r of box.querySelectorAll(".mv-row")) r.classList.toggle("sel", r.dataset.id === id);
}

// the edit bar under the 3D. b = {sel, canUndo, canRedo, selEdited, anyEdited}
export function renderBar($, b, fdi) {
  $("moveSel").textContent = b.sel ? `${fdi(b.sel)}번 선택` : "치아를 눌러 선택";
  $("moveUndo").disabled = !b.canUndo; $("moveRedo").disabled = !b.canRedo;
  $("moveResetTooth").disabled = !b.selEdited;
  $("moveResetAll").disabled = $("moveApply").disabled = !b.anyEdited;
}
