// app.js 에서 나눈 모듈: the transcript — messages, markdown, review questions, reasoning lines, the tool trace rows.
import { $, RULE_KO, STRATEGY_KO, api, esc, state } from "./state.js";
import { stageGrow, sweepFx } from "./viewer.js";
import { condWords } from "./conditions.js";
import { renderPlanList, withoutComparison } from "./plans.js";
// defined in later modules: app.js hands them in (wire) before any of them is called
let autosize, send;
export function wire(fns) { ({ autosize, send } = fns); }

// ------------------------------------------------------------------ chat
const TOOL_KO = { load_case: "케이스 읽기", list_cases: "케이스 목록", clinical_limits: "임상 한계 읽기", get_constraints: "조건 읽기",
  set_constraints: "조건 설정", propose_target: "목표 배열 제안", plan_stages: "단계 계획", validate: "규칙 검증",
  compare_strategies: "전략 비교", select_plan: "계획 선택", export_stl: "STL 내보내기", get_plan: "계획 읽기",
  load_skill: "임상 규칙 읽기", reviewer: "검토" };
function toolKo(name) {
  const n = (name ?? "").replace(/^Function (Start|End): /, "").replace(/^cualign__/, "");
  if (n.startsWith("fallback: ")) return "규칙 기반 " + (STRATEGY_KO[n.slice(10)] ?? n.slice(10));
  return TOOL_KO[n] ?? n;
}
const NOTE_RE = /\s*((?:이 계획은|검토 메모도)\s*초안입니다\.?\s*)?최종 판단은 의사가 합니다\.?\s*$/;
function splitNote(text) {
  const m = NOTE_RE.exec(text ?? "");
  return m ? { body: text.slice(0, m.index), note: m[0].trim() } : { body: text ?? "", note: "" };
}
// The planner's answer is a card: bold sentence(s), then `- 조건: …` folded, `- 검토: …` and `- 의사 확인 필요: …` as
// labelled rows, other bullets as a list, and the closing note. Partial text renders the same way while streaming.
const BULLET = /^\s*[-*•]\s+/;
function renderMd(text) {
  const { body, note } = splitNote(text);
  text = body;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const out = [];
  for (const block of (text ?? "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    let para = [], list = [];
    const flush = () => {
      if (para.length) out.push("<p>" + para.map(inline).join("<br>") + "</p>");
      if (list.length) out.push("<ul>" + list.map((l) => "<li>" + inline(l) + "</li>").join("") + "</ul>");
      para = []; list = [];
    };
    for (const l of lines) {
      if (!BULLET.test(l)) { if (list.length) flush(); para.push(l); continue; }
      if (para.length) flush();
      const item = l.replace(BULLET, ""), m = /^(조건|검토|의사 확인 필요)\s*:\s*(.*)$/.exec(item);
      if (!m) { list.push(item); continue; }
      if (m[1] === "의사 확인 필요") { m[2] = m[2].replace(/(이 계획은 초안입니다\.?\s*)?최종 판단은 의사가 합니다\.?/g, "").trim(); if (!m[2]) continue; }
      flush();
      if (m[1] === "조건") out.push(`<details class="fold"><summary>조건 보기</summary><p>${inline(m[2])}</p></details>`);
      else out.push(`<div class="row${m[1] === "검토" ? "" : " ask"}"><b>${m[1] === "검토" ? "" : '<i class="dot"></i>'}${m[1]}</b><span>${inline(m[2])}</span></div>`);
    }
    flush();
  }
  return out.join("") + (note ? `<small class="note">${esc(note)}</small>` : "");
}
// Re-render a bubble without closing a fold the dentist opened while the answer streams in.
function setAnswer(bubble, text) {
  const open = bubble.querySelector("details.fold")?.open;
  bubble.innerHTML = renderMd(text);
  if (open) bubble.querySelector("details.fold")?.setAttribute("open", "");
}
// The reviewer memo ends with a `질문:` section of `- …` lines: those questions, or [] when there are none.
function reviewQuestions(memo) {
  const lines = splitNote(memo ?? "").body.split("\n");
  const k = lines.findLastIndex((l) => /질문\s*:/.test(l));
  if (k < 0) return [];
  const qs = lines.slice(k + 1).filter((l) => BULLET.test(l)).map((l) => l.replace(BULLET, "").trim()).filter(Boolean);
  const same = lines[k].split(/질문\s*:/)[1]?.trim();
  return qs.length ? qs : same ? [same] : [];
}
function addReviewQuestions(bubble, memo) {
  const qs = reviewQuestions(memo);
  if (!qs.length) return null;
  const div = document.createElement("details");
  div.className = "review-q";
  div.innerHTML = "<summary></summary><ul></ul>";
  div.querySelector("summary").textContent = `검토 질문 ${qs.length}개`;
  for (const q of qs) { const li = document.createElement("li"); li.textContent = q; div.querySelector("ul").append(li); }
  bubble.append(div);   // part of the answer, not another block
  return div;
}
function addMsg(role, text = "") {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "assistant") div.innerHTML = renderMd(text); else div.textContent = text;
  $("transcript").appendChild(div);
  $("transcript").scrollTop = $("transcript").scrollHeight;
  return div;
}

// Inline trace (Claude Code style): one row per tool/LLM event, keyed by NAT step id, rendered
// inside the transcript right before the assistant bubble. The summary line, the tool rows and the reasoning lines
// are always shown; the raw payloads (arguments, output, time) sit under 자세히.
function newTrace(before = null) {
  const box = document.createElement("div");
  box.className = "trace";
  box.innerHTML = '<div class="head"><span class="pulse-dot"></span><span class="text"></span></div><div class="rows"></div>'
    + '<details class="raw" hidden><summary>자세히</summary><div class="log"></div></details>';
  before ? before.before(box) : $("transcript").appendChild(box);
  return { box, el: box.querySelector(".rows"), log: box.querySelector(".log"), rows: new Map() };
}
// follow a new line only when the transcript is already at its bottom (the dentist may be reading above)
function keepBottom(add) {
  const t = $("transcript"), pinned = t.scrollHeight - t.scrollTop - t.clientHeight < 24;
  const out = add();
  if (pinned) t.scrollTop = t.scrollHeight;
  return out;
}
// The agent's reasoning as sentences: one deterministic Korean line per tool call from its name and arguments, and
// one per result the turn hands back (step_done, the selected plan). No model writes them, and the replay builds the
// same lines from the same values. Tooth numbers only as the server wrote them (FDI); no ids.
function reasonForTool(name, input) {
  const n = (name ?? "").replace(/^Function (Start|End): /, "").replace(/^cualign__/, "");
  const strategy = STRATEGY_KO[(tryJson(input) ?? {}).strategy];
  return { set_constraints: "처방을 읽고 계획 조건으로 옮깁니다.", load_skill: "임상 규칙을 읽습니다.",
    propose_target: strategy ? `${strategy} 전략으로 목표 배열을 만듭니다.` : "목표 배열을 만듭니다.",
    plan_stages: "목표 배열까지 단계로 나눕니다.", compare_strategies: "같은 조건으로 전략들을 비교합니다.",
    validate: "규칙을 다시 검증합니다.", select_plan: "화면에 보일 계획을 고릅니다.", reviewer: "검토를 요청했습니다." }[n] ?? null;
}
function reasonsForSetup(done) {
  const cond = done?.conditions_ko ? done.conditions_ko.split(" · ").join(", ") : condWords().join(", ");
  const crowding = state.caseInfo?.crowding_mm;
  return [`처방을 읽었습니다 — ${cond}.`, ...(crowding != null ? [`총생 ${crowding} mm 만큼 공간이 필요합니다.`] : [])];
}
function reasonsForTarget(s) {
  if (s?.space_mm == null || s?.crowding_mm == null) return [];
  return [s.space_deficit_mm > 0 ? `확보 ${s.space_mm} mm 로 총생 ${s.crowding_mm} mm 중 ${s.space_deficit_mm} mm 가 모자랍니다.`
    : `확보 ${s.space_mm} mm 로 총생 ${s.crowding_mm} mm 를 해결했습니다.`];
}
function reasonsForPlan(plan) {
  if (!plan?.info) return [];
  const v = plan.violations ?? [], by = {};
  for (const x of v) by[x.type] = (by[x.type] ?? 0) + 1;
  const review = { passed: "통과", failed: "실패" }[plan.review?.status];
  return [`${plan.info.n_stages}단계(약 ${plan.info.months}개월)로 나눴습니다` + (plan.info.per_stage_mm ? ` — 단계당 최대 ${plan.info.per_stage_mm} mm.` : "."),
    v.length ? `규칙 검증 — 위반 ${v.length}건: ` + Object.entries(by).map(([k, n]) => `${RULE_KO[k] ?? k} ${n}건`).join(", ") + "."
      : "규칙 검증 — 위반 0건.",
    ...(review ? [`검토 → ${review}.`] : [])];
}
function addReasons(lines, trace = state.trace) {
  if (!trace || !lines?.length) return;
  keepBottom(() => { for (const text of lines) {
    const row = document.createElement("div");
    row.className = "reason"; row.textContent = text;
    trace.el.appendChild(row);
  } });
}
// The folded line reads as progress while a tool runs and as the list of tools used when the turn is done.
const RUN_KO = { "케이스 읽기": "케이스를 읽는 중", "케이스 목록": "케이스 목록을 읽는 중", "임상 한계 읽기": "임상 한계를 읽는 중",
  "조건 읽기": "조건을 읽는 중", "조건 설정": "조건을 반영하는 중", "목표 배열 제안": "목표 배열을 제안하는 중", "단계 계획": "단계를 나누는 중",
  "규칙 검증": "규칙을 검증하는 중", "전략 비교": "전략을 비교하는 중", "계획 선택": "계획을 고르는 중", "STL 내보내기": "STL을 내보내는 중",
  "계획 읽기": "계획을 읽는 중", "임상 규칙 읽기": "임상 규칙을 읽는 중", "검토": "계획을 검토하는 중", "모델 추론": "생각하는 중" };
function traceSummary(trace) {
  const rows = [...trace.el.querySelectorAll(":scope > .step")];
  const running = rows.findLast((r) => r.classList.contains("running"));
  trace.box.classList.toggle("running", !!running);
  const recorded = trace.box.classList.contains("recorded");
  if (trace === state.trace || recorded) setWorkPhrase(running?.dataset.tool);
  if (recorded) return;   // a replay keeps its 「녹화된 답」 line; the dot still breathes while its rows play
  const names = [...new Set(rows.map((r) => r.querySelector(".name").textContent))].filter((n) => n !== "모델 추론");
  trace.box.querySelector(".text").textContent = running
    ? (RUN_KO[running.querySelector(".name").textContent] ?? running.querySelector(".name").textContent + " 중") + "…"
    : (names.length ? `도구 ${rows.length}회 · ` + names.join(" → ") : `모델 응답 ${rows.length}회`);
}
// While a turn runs a chip at the bottom of the 3D says the agent is at work; the 3D keeps its brightness and controls.
// Its pulse dot and its words follow the running tool (by name, else the turn's step); between tools (a model call, a
// 429 wait) the plain sentence; the setup turn's reasoning says 처방 읽는 중. At the end the dot settles: a check held
// 0.6 s before the chip fades, or an X as the failure card shows in the transcript.
// setWorkNote(true, text): on, pulsing, with `text` (the default without); again while on, only the words change.
// setWorkNote(false): the dot settles as a check, the chip fades 0.6 s later. workNoteFailed(): an X, gone at once.
const WORK_NOTE = "에이전트가 작업 중입니다";
const WORK_KO = { set_constraints: "처방 읽는 중", propose_target: "목표 배열 계산 중", plan_stages: "단계 나누는 중",
  compare_strategies: "단계 나누는 중", validate: "규칙 검증 중", reviewer: "검토 요청 중" };
const WORK_STEP_KO = { setup: "처방 읽는 중", target: "목표 배열 계산 중", stages: "단계 나누는 중", cap: "단계 나누는 중", compare: "단계 나누는 중" };
function setWorkNote(on, text = null) {
  const note = $("workNote"), dot = note.querySelector(".pulse-dot");
  if (on) {
    if (note.dataset.state !== "run") { clearTimeout(note.fade); note.dataset.state = "run"; dot.className = "pulse-dot"; note.classList.add("on"); }
    note.querySelector("span").textContent = text || WORK_NOTE;
    return;
  }
  if (note.dataset.state !== "run") return;   // settled already (a failed turn's X), or never on
  note.dataset.state = "ok"; dot.className = "pulse-dot ok";
  note.fade = setTimeout(() => note.classList.remove("on"), 600);
}
function workNoteFailed() {
  const note = $("workNote");
  if (note.dataset.state !== "run") return;
  clearTimeout(note.fade);
  note.dataset.state = "fail"; note.querySelector(".pulse-dot").className = "pulse-dot fail";
  note.classList.remove("on");
}
function setWorkPhrase(tool) {
  if ($("workNote").dataset.state !== "run") return;
  setWorkNote(true, tool ? (WORK_KO[tool] ?? WORK_STEP_KO[state.turnStep]) : null);
}
// The planner's reasoning while the answer is held (reasoning events, rails_middleware.ReasoningRelay): one line shows
// the latest sentences, the earlier ones go under 자세히. Once the answer arrives the line folds to a count.
function addThinking(text, trace = state.trace) {
  if (!trace || !text) return;
  if (!trace.thinking) {
    trace.thinking = document.createElement("div");
    trace.thinking.className = "thinking";
    trace.thinking.lines = [];
    keepBottom(() => trace.el.appendChild(trace.thinking));
    trace.thinkLog = document.createElement("div");   // not a pre: the tool rows' raw calls are the log's pre elements
    trace.thinkLog.className = "think-log";
    trace.log.appendChild(trace.thinkLog); trace.log.parentElement.hidden = false;
  }
  const t = trace.thinking;
  if (t.classList.contains("folded")) return;
  t.textContent = latestSentences(text); t.lines.push(text);
  trace.thinkLog.textContent = "모델 추론\n" + t.lines.join("\n");
}
// One event holds the pieces of about a second (the model writes ~300 characters a second, 2026-09-28): the line
// shows its last sentences, at least 40 characters, so a trailing fragment does not stand alone.
function latestSentences(text) {
  const parts = text.split(/(?<=[.!?。])\s+/).filter(Boolean);
  let out = parts.pop() ?? "";
  while (parts.length && out.length < 40) out = parts.pop() + " " + out;
  return out;
}
function foldThinking(trace = state.trace) {
  const t = trace?.thinking;
  if (!t || t.classList.contains("folded")) return;
  t.classList.add("folded");
  t.textContent = `모델 추론 ${t.lines.length}줄 · 자세히에 접어 두었습니다`;
}
function setStreaming(on) {
  state.streaming = on;
  document.body.classList.toggle("streaming", on);
  setWorkNote(on);
}

// NAT's step adaptor sends markdown: **Input:**\n```json\n…\n```\n\n**Output:**\n…
function splitPayload(md) {
  const m = /\*\*(?:Function )?Input:\*\*\s*```\w*\n([\s\S]*?)\n```/.exec(md ?? "");
  const o = /\*\*(?:Function )?Output:\*\*\s*(?:```\w*\n)?([\s\S]*?)(?:\n```)?\s*$/.exec(md ?? "");
  return { input: m?.[1]?.trim() ?? "", output: o?.[1]?.trim() ?? "" };
}
function tryJson(t) { try { return JSON.parse(t); } catch { return null; } }
function argsSummary(input) {
  const j = tryJson(input);
  if (!j || typeof j !== "object") return input.replace(/\s+/g, " ").slice(0, 70);
  return Object.entries(j).filter(([k, v]) => k !== "unused" && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ").slice(0, 90);
}
function outSummary(name, output) {
  const j = tryJson(output);
  if (j && typeof j === "object") {
    if ("passed" in j) return j.passed ? "규칙 통과" : `위반 ${j.violations ?? j.n_violations ?? "?"}건 ${JSON.stringify(j.by_type ?? "")}`;
    if ("plan_id" in j && "n_stages" in j) return `${j.plan_id} · ${j.n_stages}장 · ${j.months}개월`;
    if ("target_id" in j) return `${j.target_id} · ${j.strategy ?? ""} · 확보 ${j.space_gain_mm ?? "?"}mm · 부족 ${j.space_deficit_mm ?? "?"}mm`;
    if ("crowding_mm" in j) return `${j.case_id ?? ""} 총생 ${j.crowding_mm}mm · 치아 ${j.n_teeth ?? "?"}개`;
    if ("download_url" in j) return j.download_url;
    if (Array.isArray(j.rows)) return `${j.rows.length}개 전략 비교`;
  }
  return (output ?? "").replace(/\s+/g, " ").slice(0, 110);
}

// A tool row (not a model or rule-plan row) shows a pulse dot and its seconds counting in tenths while it runs; its end
// settles the dot as a check with 「완료 · 3.2s」. `quiet`: no reasoning line (a replay adds its own, in its order).
const toolName = (label) => (label ?? "").replace(/^Function (Start|End): /, "").replace(/^cualign__/, "");
const stepSecs = (row) => ((performance.now() - row.t0) / 1000).toFixed(1) + "s";
let stepClock = null;
function tickSteps() {
  const rows = document.querySelectorAll("#transcript .step.tool.running");
  for (const r of rows) r.querySelector(".time").textContent = stepSecs(r);
  if (!rows.length) { clearInterval(stepClock); stepClock = null; }
}
function addStep(name, payload, cls = "", trace = state.trace, id = null, { quiet = false } = {}) {
  if (!trace) trace = state.trace = newTrace();
  const isLlm = /llm|thought|reason|nim_/i.test(name ?? "") || cls === "llm";
  const isTool = !isLlm && !cls;
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 1);
  const { input, output } = isLlm || cls ? { input: "", output: text } : splitPayload(text);
  const label = (name ?? "step").replace(/^Function (Start|End): /, "");
  let row = id && trace.rows.get(id), fresh = false;
  if (!row) {
    fresh = true;
    row = document.createElement("div");
    row.className = `step ${isLlm ? "llm" : cls || "tool"}`;
    row.innerHTML = (isTool ? `<span class="pulse-dot"></span>` : `<span class="dot"></span>`)
      + `<span class="name"></span><span class="arrow">→</span><span class="out"></span>` + (isTool ? `<span class="time"></span>` : "");
    if (isTool) row.dataset.tool = toolName(label);
    row.t0 = performance.now();
    row.raw = document.createElement("pre");
    keepBottom(() => trace.el.appendChild(row));
    trace.log.appendChild(row.raw); trace.log.parentElement.hidden = false;
    if (id) trace.rows.set(id, row);
  }
  row.querySelector(".name").textContent = isLlm ? "모델 추론" : toolKo(label);
  const done = !!output, wasRunning = row.classList.contains("running");
  // the server's tool end says only 완료 (worker.py): the seconds say it, not a second 「→ 완료」
  const out = done && !isLlm && output !== "완료" ? outSummary(label, output) : "";
  row.querySelector(".arrow").style.visibility = out ? "visible" : "hidden";
  row.querySelector(".out").textContent = out;
  row.classList.toggle("running", !done);
  if (isTool) {
    row.querySelector(".pulse-dot").className = "pulse-dot" + (done ? " ok" : "");
    row.querySelector(".time").textContent = !done ? stepSecs(row) : wasRunning ? "완료 · " + stepSecs(row) : "완료";
    if (!done) stepClock ??= setInterval(tickSteps, 100);
  }
  // 자세히: the raw event, the arguments as the model chose them and the time the call took
  row.raw.textContent = (isLlm ? `모델 추론 (${label})` : toolKo(label)) + (input ? ` (${argsSummary(input)})` : "")
    + (done ? ` · ${((performance.now() - row.t0) / 1000).toFixed(1)}초` : "") + "\n" + (text ?? "");
  traceSummary(trace);
  if (fresh && isTool && !quiet) addReasons([reasonForTool(label, input)].filter(Boolean), trace);
  if (isTool && (fresh || wasRunning)) toolMoment(row.dataset.tool, tryJson(input) ?? {}, !done ? "start" : "end");
  if (isTool && (fresh || wasRunning) && !String(id).startsWith("replay-")) stageGrow.tool(label, !done ? "start" : "end");   // stage-grow.js (the replay plays it itself)
}
// a turn that failed: its tool rows still running settle as an X with the server's sentence (nothing when it gave none)
function failRows(trace, reason = "") {
  for (const row of trace?.el.querySelectorAll(":scope > .step.tool.running") ?? []) {
    row.classList.remove("running"); row.classList.add("failed");
    row.querySelector(".pulse-dot").className = "pulse-dot fail";
    row.querySelector(".time").textContent = "실패" + (reason ? " · " + reason : "");
    row.querySelector(".time").title = reason;
  }
  if (trace) traceSummary(trace);
  if (sweepFx.running) sweepFx.end(null);
}
// The one hook the tool events drive besides the row: the rule check sweeps the 3D and lands its violations (their
// plan read back, since the tool's end carries no result), and the reviewer's plan card shows 검토 중 → its result.
async function toolMoment(tool, input, phase) {
  const planId = input.plan_id ?? null;
  if (tool === "validate") {
    if (phase === "start") return sweepFx.start();
    let plan = planId && state.plan?.plan_id === planId ? state.plan : null;
    if (!plan && planId) plan = await api("/api/plans/" + encodeURIComponent(planId)).catch(() => null);
    sweepFx.end(plan ? plan.violations ?? [] : null, planId);
  } else if (tool === "reviewer" && planId) {
    const row = state.planRows[planId];
    if (phase === "start") {
      if (row) { row.review = { ...(row.review ?? {}), status: "running" }; renderPlanList(); }
      else state.reviewPending.add(planId);   // a plan of this turn: its card comes with plan_selected
      return;
    }
    if (!row) return;
    const plan = await api("/api/plans/" + encodeURIComponent(planId)).catch(() => null);
    if (plan && state.planRows[planId]) { state.planRows[planId].review = plan.review; renderPlanList(); }
  }
}

// The agent's question card (#90): the question and two or three choices. A choice with a message is sent as the
// dentist's turn; a choice with `fill` only puts a sentence in the composer to edit.
function addQuestion(q) {
  if (q?.options) q = { ...q, options: withoutComparison(q.options) };
  if (!q?.question || !(q.options?.length >= 2)) return null;
  const div = document.createElement("div");
  div.className = "question";
  div.innerHTML = '<p></p><div class="opts"></div>';
  div.querySelector("p").textContent = q.question;
  for (const o of q.options) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = o.label; b.dataset.label = o.label;
    if (o.hint) { const s = document.createElement("small"); s.textContent = o.hint; b.append(s); div.querySelector(".opts").classList.add("stack"); }
    b.dataset.message = o.message ?? ""; b.dataset.fill = o.fill ?? ""; b.dataset.action = o.action ?? "";
    div.querySelector(".opts").appendChild(b);
  }
  div.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || state.streaming || state.loading) return;
    if (b.dataset.fill) { $("chatInput").value = b.dataset.fill; autosize(); $("chatInput").focus(); return; }
    const picked = document.createElement("span");
    picked.className = "picked"; picked.textContent = b.dataset.label;
    div.querySelector(".opts").replaceWith(picked);
    div.classList.add("done");
    if (b.dataset.action === "export") { $("exportBtn").disabled ? addMsg("system", "내보내기: " + $("exportWhy").textContent) : $("exportBtn").click(); return; }
    send(b.dataset.message);
  });
  $("transcript").appendChild(div);
  $("transcript").scrollTop = $("transcript").scrollHeight;
  return div;
}

export { addMsg, addReasons, addReviewQuestions, addStep, addThinking, failRows, foldThinking, newTrace,
  reasonForTool, reasonsForPlan, reasonsForSetup, reasonsForTarget, renderMd, reviewQuestions, setAnswer,
  setStreaming, setWorkNote, splitNote, toolKo, workNoteFailed };
