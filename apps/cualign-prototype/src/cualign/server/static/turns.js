// app.js 에서 나눈 모듈: an agent turn — next-step chips, send and its stream, landing a step, recorded replays,
// the rule fallback, stage playback.
import { PlanStream, matchesSelection } from "./plan-stream.js";
import { $, api, fdi, isManualTarget, manualEdit, state } from "./state.js";
import { applyStage, loadSetupCut, loadTargetCut, scanFx, setProgress, setStep, stageGrow, sweepFx } from "./viewer.js";
import { addDecision, attachedTeeth, renderSelection } from "./pick.js";
import { fillConstraints, readConstraints, renderPlanFail, updateActions } from "./conditions.js";
import { showStart } from "./start.js";
import { planNo, refreshPlans, renderPlanList, sampleOf } from "./plans.js";
import { addMsg, addReasons, addReviewQuestions, addStep, addThinking, failRows, foldThinking, newTrace,
  reasonForTool, reasonsForPlan, reasonsForSetup, reasonsForTarget, setAnswer, setStreaming, setWorkNote, toolKo,
  workNoteFailed } from "./chat.js";
// defined in later modules: app.js hands them in (wire) before any of them is called
let autosize, markScanRx, renderRulesPane, showTab, toast;
export function wire(fns) { ({ autosize, markScanRx, renderRulesPane, showTab, toast } = fns); }
// The next moves, as chips right under the agent's bubble (#20): what the finished step allows. One row at a time;
// sending anything folds the open row.
const NEXT_STEP = { initial: "setup", setup: "target", target: "stages", stages: "stages" };
function nextChips() {
  const sample = sampleOf(state.meshCase);
  const extraction = state.setup ? (state.setup.extraction ?? []).length > 0 : ($("cExtract").value.trim() !== "");
  switch (state.progress) {
    case "initial": return sample ? [{ label: "이 케이스의 처방 넣기", message: sample.request, step: "setup", hint: sample.prescription }] : [];
    case "setup": return [{ label: "목표 배열 만들기", message: "이 조건으로 목표 배열을 만들어줘.", step: "target" }, { label: "조건 바꾸기", action: "cond" }];
    // a hand-edited target (직접 이동) is staged as it is: a condition change or a comparison would make new targets
    case "target": return isManualTarget()
      ? [{ label: "단계 만들기", message: "직접 옮긴 이 목표 배열 그대로 단계를 만들어줘.", step: "stages" },
         { label: "에이전트 없이 단계 계산", action: "manualStages", hint: "모델 없이 이 목표 배열을 단계로 나누고 규칙을 검사합니다" },
         { label: "다시 조정", action: "manual" }]
      : [{ label: "단계 만들기", message: "이 목표로 단계를 만들어줘.", step: "stages" },
         { label: "12개월 안에", message: "12개월 안에 끝나게 단계를 만들어줘.", step: "stages" },
         ...(extraction ? [] : [{ label: "비발치안과 비교", message: "확장안이랑 IPR안 둘 다 만들어서 비교해줘.", step: "stages" }]),
         { label: "수동으로 조정", action: "manual", hint: "목표 배열의 치아를 3D에서 직접 옮깁니다" }];
    default: return [{ label: "승인하고 내보내기", action: "export" }, { label: "조건 바꾸기", action: "cond" }];
  }
}
function addNextChips(after) {
  const chips = nextChips();
  if (!chips.length) return null;
  for (const old of document.querySelectorAll("#transcript .next:not(.done)")) old.remove();
  const div = document.createElement("div");
  div.className = "next";
  const opts = document.createElement("div"); opts.className = "opts"; div.append(opts);
  for (const c of chips) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = c.label; b.title = c.hint ?? c.message ?? "";
    b.dataset.message = c.message ?? ""; b.dataset.step = c.step ?? ""; b.dataset.action = c.action ?? "";
    opts.appendChild(b);
  }
  div.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || state.streaming || state.loading) return;
    if (b.dataset.action === "manual") { if (state.step !== "target") setStep("target"); manualEdit.open(); return; }
    if (manualEdit.active) { toast("직접 이동을 적용하거나 취소한 뒤 진행해 주세요."); return; }
    if (b.dataset.action === "manualStages") { stageManualTarget(); return; }
    if (b.dataset.action === "cond") { showTab("cond"); $("cAllowExt").focus(); return; }   // the form's first field (발치 치아 may be locked)
    if (b.dataset.action === "export") { $("exportBtn").disabled ? addMsg("system", "내보내기: " + $("exportWhy").textContent) : $("exportBtn").click(); return; }
    send(b.dataset.message, null, { step: b.dataset.step || undefined });
  });
  (after ?? $("transcript")).after ? after.after(div) : $("transcript").appendChild(div);
  $("transcript").scrollTop = $("transcript").scrollHeight;
  return div;
}
function foldNextChips() {
  for (const row of document.querySelectorAll("#transcript .next:not(.done)")) { row.classList.add("done"); row.querySelector(".opts")?.remove(); }
}
// The plan a turn produced, as a card in the transcript; 열기 shows it in the 3D and the result panel.


// `constraints` and `resend` come from the 다시 보내기 button: the same text and form values as the failed request,
// a fresh request id, and the failed turn's user message replaced rather than repeated in the transcript the model sees.
async function send(text, constraints = null, { resend = false, step = null } = {}) {
  text = (text ?? "").trim();
  if (!text || state.streaming || state.loading) return;
  if (manualEdit.active) { toast("직접 이동을 적용하거나 취소한 뒤 보내 주세요."); return; }
  if (!state.meshCase) { showStart(); return; }
  if (constraints === null) {
    try { constraints = readConstraints(); } catch (e) { addMsg("error", e.message); return; }
  }
  if (attachedTeeth().length && !resend) {
    text = `[선택한 치아: ${attachedTeeth().map(fdi).sort((a, b) => a - b).join(", ")}번] ` + text;
    state.selected.clear(); state.ruleMarked.clear(); renderSelection();
  }
  const requestId = crypto.randomUUID(), caseId = state.meshCase, prevPlanId = state.plan?.plan_id ?? null;
  // the step this turn asks for (#20): the next one after the progress, or the one the chip/button names
  const turnStep = step ?? (resend ? state.lastRequest?.step : null) ?? NEXT_STEP[state.progress] ?? "stages";
  state.requestId = requestId; state.stageTouched = false;
  setStreaming(true); updateActions();
  foldNextChips();
  $("retryBar").hidden = true;
  $("planNotice").textContent = turnStep === "setup" ? "처방을 조건으로 옮기는 중" : turnStep === "target" ? "목표 배열 만드는 중"
    : state.plan ? "재계획 중 · 현재 3D는 이전 계획입니다." : "단계 계획 만드는 중";
  $("chatInput").value = ""; autosize();
  if (resend && state.messages.at(-1)?.role === "user" && state.messages.at(-1).content === text) state.messages.pop();
  state.messages.push({ role: "user", content: text });
  state.lastRequest = { text, constraints, step: turnStep };
  const userBubble = addMsg("user", text);
  state.trace = newTrace();
  const bubble = addMsg("assistant", "");
  // the setup's 3D reading goes with the agent's first line; the prescription goes on with the reasoning (landSetup)
  const firstLine = turnStep === "setup" ? onFirstAgentLine(state.trace, bubble, () => scanFx.startNumbers(caseId)) : null;
  // a sample case may skip the agent (#15): a waiting line under the answer counts the seconds; its 건너뛰기 shows after
  // 5 s while nothing has come (a 429 sends not even a tool event), after 8 s once the turn is moving (a tool event or an
  // answer token — a working turn is not nudged to be skipped), at once on the server's overload / key error. A failed
  // turn offers it too.
  const sample = !!sampleOf(caseId), ac = new AbortController();
  state.abort = ac; state.skippedTurn = null;
  state.turnStep = stepOf(text, turnStep);   // which recorded answer 건너뛰기 would play for this turn
  let progressed = false;
  const skipRow = addSkipRow(bubble, requestId);
  const showSkip = () => { if (sample && state.requestId === requestId) skipRow.querySelector("button").hidden = false; };
  const skipTimers = [setTimeout(() => { if (!progressed) showSkip(); }, 5000), setTimeout(showSkip, 8000)];
  $("retryFallback").hidden = sample; $("skipBtn").hidden = !sample;
  let answer = "", selected = null, streamError = false, overload = null, stepDone = null, refusedPii = null;
  const handle = ({type, data: obj}) => {
    if ((type === "intermediate_data" && !/llm|thought|reason|nim_/i.test(obj.name ?? "")) || (type === "data" && obj.choices?.[0]?.delta?.content)) progressed = true;
    if (type === "plan_selected") {
      if (matchesSelection(obj, state.requestId, state.meshCase)) selected = obj;
    } else if (type === "step_done") {
      if (!obj.request_id || obj.request_id === state.requestId) stepDone = obj;   // setup: constraints · target: target_id + summary · stages: nothing more
    } else if (type === "turn_refused") {
      if (obj.request_id === state.requestId && obj.kind === "pii") refusedPii = { text: obj.text ?? "" };
    } else if (type === "plan_context") {
      if (obj.request_id === state.requestId && obj.case_id === state.meshCase) fillConstraints(obj.constraints);
    } else if (type === "plan_error" || type === "error" || obj.code) {
      streamError = true; addStep("error", obj, "fallback");
      failRows(state.trace, obj.message ?? "");
      // the server's own sentence, worth a 다시 보내기: NIM overload, or a final answer with no Korean in it (no_answer)
      if ((obj.kind === "nim_overload" || obj.kind === "no_answer" || obj.kind === "nim_auth") && (obj.request_id ?? state.requestId) === state.requestId) overload = obj;
      if (overload && overload.kind !== "no_answer") showSkip();   // 429 / 401·403: no reason to wait the stream out
    } else if (type === "intermediate_data" && obj.type === "reasoning") {
      addThinking(obj.payload ?? "");
      if (turnStep === "setup") setWorkNote(true, "처방 읽는 중");
    } else if (type === "intermediate_data") {
      addStep(obj.name ?? "step", obj.payload ?? "", "", state.trace, obj.id ?? null);
    } else if (type === "data") {
      const ch = obj.choices?.[0], delta = ch?.delta?.content ?? ch?.message?.content ?? obj.value ?? "";
      if (typeof delta === "string") { answer += delta; setAnswer(bubble, answer); if (delta) foldThinking(); }
    }
  };
  try {
    const r = await fetch("/chat/stream", { method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages: state.messages, step: turnStep, step_source: step ? "chip" : undefined, cualign: { request_id: requestId,
        case_id: caseId, base_plan_id: state.plan?.plan_id ?? null, constraints } }), signal: ac.signal });
    if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
    // the step the server runs: a free sentence's words may name another than the one sent (step-intent), and 건너뛰기
    // plays that step's recording — a hand-edited target is staged by the screen only on a stages turn (replayOrAdopt)
    const ran = r.headers.get("X-Cualign-Step");
    if (ran && ran !== turnStep && state.requestId === requestId) state.turnStep = stepOf(text, ran);
    const reader = r.body.getReader(), parser = new PlanStream();
    for (;;) {
      const {value, done} = await reader.read();
      for (const event of parser.push(value, done)) handle(event);
      if (done) break;
    }
    if (state.requestId !== requestId || state.meshCase !== caseId) return;
    if (refusedPii) {
      // The server refused a personal identifier in this message (#157). It checks every message of the chat this
      // screen resends each turn, so the message leaves the chat (and goes back to the box to be edited), or every
      // later turn would be refused too. The refusal is shown but not kept in the chat either.
      // The box and the bubble get the sentence with the identifiers taken out (the server's, it holds none of them).
      const i = state.messages.findLastIndex((m) => m.role === "user" && m.content === text);
      if (i >= 0) state.messages.splice(i, 1);
      userBubble.textContent = refusedPii.text || "(개인정보를 지운 메시지)";
      $("chatInput").value = refusedPii.text; autosize();
      $("planNotice").textContent = "";
      addNextChips(bubble);
      return;
    }
    if (answer) state.messages.push({ role: "assistant", content: answer });
    state.lastAssistantText = answer;
    if (stepDone && !streamError) {
      if (stepDone.step === "setup") {   // the reasoning and the prescription on the 3D, together; the setup lands once the extracted crowns are away
        firstLine?.fire(); landSetup(stepDone);
        await scanFx.extracted();
        if (state.requestId !== requestId || state.meshCase !== caseId) return;
      }
      await landStep(stepDone);
      if (stepDone.step === "target") addReasons(reasonsForTarget(stepDone.summary));
    }
    if (selected && !streamError) {
      if (selected.reviewed_by_server) state.reviewPending.add(selected.plan_id);   // reviewed after the stream: its card lands the result
      await refreshPlans(selected.plan_id);
      setStep("stages"); showPlanEnd();
      if (state.plan?.plan_id === selected.plan_id) addReasons(reasonsForPlan(state.plan));
      if (state.plan?.plan_id === selected.plan_id && state.plan.review?.status === "passed") addReviewQuestions(bubble, state.plan.review.message);
      addDecision(prevPlanId, selected.plan_id);
      if (!answer) bubble.textContent = "계획은 생성됐지만 모델의 최종 설명은 비어 있습니다.";
      if (selected.reviewed_by_server) addMsg("system", "에이전트가 검토를 호출하지 않아 서버가 같은 조건으로 검토를 실행했습니다.");
      if (selected.review.status === "failed") addMsg("error", selected.review.message + " (" + selected.review.error + ")");
    } else if (streamError || !answer) {
      throw new Error(overload?.message || "모델 실행 또는 최종 계획 선택 실패");
    } else if (stepDone) {
      $("planNotice").textContent = "";
    } else {
      $("planNotice").textContent = turnStep === "stages" ? "새 계획 선택 없음 · 대화 내용을 확인하세요." : "";
    }
    addNextChips(bubble);
  } catch (e) {
    if (state.skippedTurn === requestId) { await replayOrAdopt(bubble, caseId, prevPlanId); return; }   // 건너뛰기 stopped the stream
    if (answer) setAnswer(bubble, answer); else bubble.remove();
    failRows(state.trace, overload?.message ?? "");
    workNoteFailed();   // the chip's X goes as the failure card below shows
    $("planNotice").textContent = Object.keys(state.planRows).length ? "재계획 실패 · 현재 3D는 이전 계획입니다." : "";
    if (turnStep === "stages" && !Object.keys(state.planRows).length) { state.planError = overload?.message || e.message; renderPlanFail(); }
    // the way out the bar really offers: a sample has 건너뛰기 (the recorded answer), a patient has 에이전트 없이 계산
    const alt = sample ? "「건너뛰기」로 녹화된 답을 볼 수 있습니다." : "「에이전트 없이 계산」할 수 있습니다.";
    const when = overload?.kind === "nim_overload" ? " 잠시 뒤 " : overload?.kind === "nim_auth" ? " 키를 고쳐 서버를 다시 시작한 뒤 " : " ";
    addMsg("error", overload
      ? overload.message + when + "「다시 보내기」를 누르거나, " + alt
      : "답을 받지 못했습니다 (" + e.message + "). 같은 요청을 다시 보내거나, " + alt);
    if (state.requestId === requestId) $("retryBar").hidden = false;
  } finally {
    skipTimers.forEach(clearTimeout); clearInterval(skipRow.tick); skipRow.remove(); firstLine?.stop(); scanFx.release(); foldThinking();
    if (sweepFx.running) sweepFx.end(null);   // a turn cut while the rule check ran
    if (state.requestId === requestId) { setStreaming(false); updateActions(); }
  }
}
// The setup turn's 3D reading (scan-reveal ①) starts as the transcript gets the agent's first line — a reasoning line, a
// tool row or the answer, whichever comes first — so the 3D does not run ahead of an empty conversation. With no line
// in FIRST_LINE_WAIT (the answer held by the output rails) it starts anyway: the 3D is not left still for long.
const FIRST_LINE_WAIT = 8000;
function onFirstAgentLine(trace, bubble, go) {
  let done = false;
  const obs = new MutationObserver(() => {
    if ([...trace.el.children].some((c) => !c.classList.contains("fallback")) || bubble.textContent.trim()) fire();
  });
  const timer = setTimeout(() => fire(), FIRST_LINE_WAIT);
  const stop = () => { done = true; obs.disconnect(); clearTimeout(timer); };
  function fire() { if (done) return; stop(); go(); }
  obs.observe(trace.el, { childList: true });
  obs.observe(bubble, { childList: true, subtree: true, characterData: true });
  return { fire, stop };
}
// step_done (#20): the agent finished a step. setup → its constraints go to the form and the 3D marks them; target →
// the target state comes from /targets and the 3D shows it; stages → plan_selected does the rest.
async function landStep(done) {
  if (done.step === "setup" && done.constraints) {
    state.setup = done.constraints; state.target = null; state.targetId = null;
    fillConstraints(done.constraints);
    setProgress("setup", true);
    loadSetupCut();   // the cut follows; the setup shows at once
    scanFx.landed(done.constraints);
    markScanRx({ ...done.constraints, conditions_ko: done.conditions_ko ?? undefined });   // the chart with the 3D (at once without a reveal)
    state.setupRed = !scanFx.busy();   // the scan reveal already lifted the extracted crowns away
    setStep("setup");
    setTimeout(() => { state.setupRed = false; if (state.step === "setup") applyStage(0); }, 1200);
  } else if (done.step === "target" && done.target_id) {
    state.target = await api(`/api/cases/${encodeURIComponent(state.meshCase)}/targets/${encodeURIComponent(done.target_id)}`);
    state.targetId = done.target_id; state.targetSummary = done.summary ?? null;
    setProgress("target", true);
    setStep("target");
    loadTargetCut(done.target_id);   // the cut follows; the target shows at once
  } else if (done.step === "stages") {
    setProgress("stages");
  }
}
// The setup's reasoning lands in the transcript and its prescription on the 3D at the same moment (scan-reveal ②).
// A live setup turn often calls no tool — the form already carries the prescription and the server applied it to the
// case before the agent ran (plan_events.open_run) — so the trace had no row, no summary and no dot. The screen then
// writes the one step that did happen, 조건 설정 with the conditions step_done carries, as a tool row like any other.
function landSetup(done, trace = state.trace) {
  const told = trace && [...trace.el.querySelectorAll(":scope > .step .name")].some((n) => n.textContent === toolKo("set_constraints"));
  if (trace && !told)
    addStep("cualign__set_constraints", "**Input:**\n```json\n" + JSON.stringify(done.constraints ?? {}) + "\n```\n\n**Output:**\n서버가 처방을 조건으로 옮김", "", trace);
  addReasons(reasonsForSetup(done), trace);
  scanFx.applyPrescription(done.constraints);
}
// 건너뛰기 (#15): the rule plan on screen is the plan; a running turn is cut, its answer dropped
function addSkipRow(bubble, requestId) {
  const row = document.createElement("div");
  row.className = "skip-row";
  row.innerHTML = '<span>에이전트가 답하는 중입니다 · 0초</span><button class="btn ghost small" type="button" hidden>건너뛰기</button>';
  row.querySelector("button").addEventListener("click", () => skipTurn(requestId));
  const t0 = Date.now();
  row.tick = setInterval(() => { row.querySelector("span").textContent = `에이전트가 답하는 중입니다 · ${Math.floor((Date.now() - t0) / 1000)}초`; }, 1000);
  bubble.after(row);
  $("transcript").scrollTop = $("transcript").scrollHeight;
  return row;
}
function skipTurn(requestId) {
  if (state.requestId !== requestId || !state.streaming) return;
  state.skippedTurn = requestId;
  state.abort?.abort();
}
// the turn's kind for the recorded answers (#20): the step it asks for, or a time cap / a strategy comparison on the stages
const stepOf = (text, step) => step === "stages" && /개월|기간/.test(text) ? "cap" : step === "stages" && /비교|둘 ?다/.test(text) ? "compare" : step;
const REPLAY_REASONING_MS = 1200;   // one recorded reasoning event per 1.2 s, about a live turn's pace (one a second or slower)
// A recording lands at once; its tool rows are told one after another, each 도는 중 for 0.4 s and then 완료, so a replayed
// turn keeps a live turn's rhythm — and the chip, the rule-check sweep and the review badge follow the rows as they
// would. Each row's reasoning line shows as it starts.
const REPLAY_GAP = 400;
async function playTools(trace, tools) {
  for (const { name, input = {}, reasons = [] } of tools) {
    const id = "replay-" + crypto.randomUUID(), args = "**Input:**\n```json\n" + JSON.stringify(input) + "\n```";
    addStep("cualign__" + name, args, "", trace, id, { quiet: true });
    addReasons(reasons, trace);
    await new Promise((r) => setTimeout(r, REPLAY_GAP));
    if (!trace.box.isConnected) return;
    addStep("cualign__" + name, args + "\n\n**Output:**\n완료", "", trace, id, { quiet: true });
  }
}
// 건너뛰기 plays the recorded answer for this step (contract 12-replay.md); with none recorded (404) the rule plan on
// screen is adopted. The recorded answer sits where the agent's would, marked grey with its date.
async function replayOrAdopt(bubble, caseId, prevPlanId) {
  $("retryBar").hidden = true;
  // a recorded answer makes its own targets; a hand-edited target is staged as it is instead
  if (isManualTarget() && state.progress === "target" && !["setup", "target"].includes(state.turnStep)) { bubble.remove(); return stageManualTarget(); }
  if (state.turnStep === "setup") scanFx.startNumbers(caseId);   // a no-op when the cut turn already started it
  if (sweepFx.running) sweepFx.end(null);   // the cut turn's rule check
  let trace = null;
  try {
    // the server recomputes the recording's plans (seconds on 000001: #212), so the POST goes first and the recording's
    // head (step, date, reasoning: nothing computed) draws the trace at once while it runs
    const step = state.turnStep ?? "stages";
    const recP = fetch(`/api/cases/${encodeURIComponent(caseId)}/replay`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, base_plan_id: state.plan?.plan_id ?? null }) });
    recP.catch(() => {});   // awaited below; a head 404 leaves it unread
    const h = await fetch(`/api/cases/${encodeURIComponent(caseId)}/replay/${encodeURIComponent(step)}`);
    if (h.status === 404) { bubble.remove(); adoptCurrentPlan(); return; }
    if (!h.ok) throw new Error("HTTP " + h.status);
    const head = await h.json();
    // the cut turn's trace goes; the recording's steps are told again from the recomputed values, as a live turn tells them
    if (bubble.previousElementSibling?.classList.contains("trace")) bubble.previousElementSibling.remove();
    trace = newTrace(bubble);
    trace.box.classList.add("recorded");
    trace.box.querySelector(".text").textContent = "녹화된 답 · 계산은 지금 다시 했습니다";
    // the recorded turn's reasoning events (000097 setup), at the pace a live turn sends them; none recorded, none made up
    if (head.reasoning?.length) {
      setStreaming(true);
      if (head.step === "setup") setWorkNote(true, "처방 읽는 중");
      for (const line of head.reasoning) {
        addThinking(line, trace);
        await new Promise((r) => setTimeout(r, REPLAY_REASONING_MS));
        if (state.meshCase !== caseId) { setStreaming(false); return; }
      }
      foldThinking(trace); setStreaming(false);
    }
    const r = await recP;
    if (r.status === 404) { bubble.remove(); trace.box.remove(); adoptCurrentPlan(); return; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const rec = await r.json();
    if (state.meshCase !== caseId) return;
    setAnswer(bubble, rec.answer_md ?? "");
    bubble.classList.add("recorded");
    const tag = document.createElement("small"); tag.className = "recorded-tag"; tag.textContent = "녹화된 답 · " + (rec.recorded_at ?? "").slice(0, 10);
    tag.title = "녹화 시각 " + (rec.recorded_at ?? "");   // the full stamp in the badge's tooltip
    bubble.prepend(tag);
    state.messages.push({ role: "assistant", content: rec.answer_md ?? "" });
    addMsg("system", "에이전트 답을 건너뛰고 녹화된 답을 보였습니다.");
    // a recorded setup or target lands like the agent's step_done (#20); a plan like its plan_selected
    if (rec.constraints) {
      // the recording lands at once: its reasoning and the prescription wait for the scan numbers, then go on together
      await scanFx.numbersDone();
      if (state.meshCase !== caseId) return;
      await playTools(trace, [{ name: "set_constraints", input: rec.constraints, reasons: [reasonForTool("set_constraints")] }]);
      if (state.meshCase !== caseId) return;
      addReasons(reasonsForSetup(rec), trace);
      scanFx.applyPrescription(rec.constraints);
      await scanFx.extracted();
      if (state.meshCase !== caseId) return;
      await landStep({ step: "setup", constraints: rec.constraints });
    } else if (rec.target_id) {
      await landStep({ step: "target", target_id: rec.target_id, summary: rec.summary });
      const strategy = { strategy: rec.summary?.strategy };
      await playTools(trace, [{ name: "propose_target", input: strategy, reasons: [reasonForTool("propose_target", JSON.stringify(strategy))] }]);
      if (state.meshCase !== caseId) return;
      addReasons(reasonsForTarget(rec.summary), trace);
    }
    const sel = rec.plan_selected;   // null on a compare of an extraction case (the answer only asks back): the bubble alone, cards and 3D stay
    if (!sel?.plan_id) $("planNotice").textContent = "";
    if (sel?.plan_id) {
      await refreshPlans(sel.plan_id);
      setStep("stages"); if (!(await stageGrow.play())) showPlanEnd();   // the recorded stage turn grows, then lands at 0 (stage-grow.js)
      // the server recomputed the plans now (compare → stages · check), then the recorded pick and its recorded review
      const made = rec.step === "compare" ? "compare_strategies" : "plan_stages", pick = { plan_id: sel.plan_id };
      await playTools(trace, [{ name: made, reasons: [reasonForTool(made)] }, { name: "validate", input: pick },
        { name: "select_plan", input: pick, reasons: [reasonForTool("select_plan")] }, { name: "reviewer", input: pick, reasons: [reasonForTool("reviewer")] }]);
      if (state.meshCase !== caseId) return;
      addReasons(state.plan?.plan_id === sel.plan_id ? reasonsForPlan(state.plan) : [], trace);
      addDecision(prevPlanId, sel.plan_id);
      if (state.plan?.plan_id === sel.plan_id && state.plan.review?.status === "passed") addReviewQuestions(bubble, state.plan.review.message);
    }
    addNextChips(bubble);
  } catch (e) {
    bubble.remove(); trace?.box.remove();
    addMsg("error", "녹화된 답을 불러오지 못했습니다 (" + e.message + ").");
    adoptCurrentPlan();
  } finally { scanFx.release(); }
}
function adoptCurrentPlan() {
  $("retryBar").hidden = true;
  $("planNotice").textContent = "";
  if (!state.plan) { addMsg("system", "녹화된 답이 없어 건너뛸 수 없습니다 · 다시 보내거나 에이전트 없이 계산해 주세요."); $("retryBar").hidden = false; return; }
  state.skippedPlans.add(state.plan.plan_id);
  renderPlanList();
  addMsg("system", "에이전트 답을 건너뛰었습니다 · 지금 화면의 계획을 그대로 씁니다.");
  setStep("stages");
  addNextChips($("transcript").lastElementChild);
}
$("skipBtn").addEventListener("click", () => {
  if (state.streaming) skipTurn(state.requestId);
  else replayOrAdopt(addMsg("assistant", ""), state.meshCase, state.plan?.plan_id ?? null).catch((e) => addMsg("error", e.message));
});

// ------------------------------------------------------------------ fallback / upload

// fromCond: the 조건 tab's 다시 계산 — the same rule plan, announced as a condition change once it lands
async function runFallback({ fromCond = false } = {}) {
  const caseId = state.meshCase;
  if (!caseId || state.streaming || state.loading) return;
  if (isManualTarget() && state.progress === "target") return stageManualTarget();   // /api/plan would make new targets
  let constraints;
  try { constraints = readConstraints(); } catch (e) { addMsg("error", e.message); return; }
  setStreaming(true); updateActions();
  if (!fromCond) addMsg("system", "에이전트 없이 계산 — 화면의 조건으로 계산합니다. 검토는 하지 않습니다.");
  $("planNotice").textContent = "조건을 반영해 새 계획 계산 중";
  state.trace = newTrace();
  try {
    const res = await api("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: caseId, parent_plan_id: state.plan?.plan_id ?? null, ...constraints }) });
    for (const t of res.tried ?? []) addStep("fallback: " + t.strategy, t, "fallback");
    const selected = res.chosen || res.best_failed, prevPlanId = state.plan?.plan_id ?? null;
    if (selected) {
      await refreshPlans(selected.plan_id); setStep("stages");
      if (fromCond) addMsg("system", `조건을 바꿔 규칙으로 다시 계산했습니다 — 계획 ${planNo(selected.plan_id)}`);
      addDecision(prevPlanId, selected.plan_id); addNextChips($("transcript").lastElementChild);
    }
    if (!res.chosen) { addMsg("system", "허용 전략 전부 규칙 위반 — 의사 승인이 제한됩니다."); if (selected) { renderRulesPane(state.plan); showTab("rules"); } }
  } catch (e) {
    workNoteFailed();
    addMsg("error", "계산 실패: " + e.message);
    $("planNotice").textContent = Object.keys(state.planRows).length ? "재계획 실패 — 이전 결과를 유지합니다." : "";
    if (!Object.keys(state.planRows).length) { state.planError = e.message; renderPlanFail(); }
  } finally { setStreaming(false); updateActions(); }
}

// 직접 이동 then 「에이전트 없이 단계 계산」: the hand-edited target staged and validated as it is (POST …/targets/{id}/stages),
// review not run, like the fallback
async function stageManualTarget() {
  const caseId = state.meshCase, targetId = state.targetId;
  if (!caseId || !targetId || state.streaming || state.loading) return;
  setStreaming(true); updateActions();
  addMsg("system", "에이전트 없이 계산 — 직접 옮긴 목표 배열을 그대로 단계로 나눕니다. 검토는 하지 않습니다.");
  $("planNotice").textContent = "직접 옮긴 목표 배열을 단계로 나누는 중";
  const prevPlanId = state.plan?.plan_id ?? null;
  try {
    const row = await api(`/api/cases/${encodeURIComponent(caseId)}/targets/${encodeURIComponent(targetId)}/stages`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent_plan_id: prevPlanId }) });
    $("planNotice").textContent = "";
    await refreshPlans(row.plan_id);
    setStep("stages"); addDecision(prevPlanId, row.plan_id);
    addMsg("system", `직접 옮긴 목표 배열 · ${row.n_stages}단계(약 ${row.months}개월) · ` + (row.passed ? "규칙 통과" : `규칙 위반 ${row.violations}건 — 의사 승인이 제한됩니다`) + ".");
    addNextChips($("transcript").lastElementChild);
  } catch (e) {
    $("planNotice").textContent = "";
    workNoteFailed();
    addMsg("error", "단계를 만들지 못했습니다: " + e.message);
  } finally { setStreaming(false); updateActions(); }
}

// ------------------------------------------------------------------ stage playback
// a plan the turn selected opens at its last stage, the target reached (▶ from there starts over at 치료 전), unless
// the dentist was already moving the stage
function showPlanEnd() { if (state.plan && !state.stageTouched) applyStage(state.plan.stages.length); }
function stopPlay() { if (state.playing) { clearInterval(state.playing); state.playing = null; $("playBtn").setAttribute("aria-pressed", "false"); } }
function togglePlay() {
  if (!state.plan) return;
  if (state.playing) return stopPlay();
  $("playBtn").setAttribute("aria-pressed", "true");   // the pause icon shows while playing
  state.playing = setInterval(() => {
    const n = state.plan.stages.length;
    applyStage(state.stage >= n ? 0 : state.stage + 1);
  }, 350);
}

export { addNextChips, runFallback, send, stopPlay, togglePlay };
