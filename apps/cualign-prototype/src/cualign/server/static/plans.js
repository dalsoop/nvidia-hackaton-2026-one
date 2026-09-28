// app.js 에서 나눈 모듈: the rail, opening a case (activateCase · openCase · restoreProgress · loadMesh) and the plan list.
import { $, STRATEGY_KO, api, manualEdit, normSurfaces, state } from "./state.js";
import { STEPS, applyStage, buildTeeth, ghost, group, loadSetupCut, loadTargetCut, scanFx, setCut, setProgress,
  setStep, sweepFx } from "./viewer.js";
import { renderStageMarks } from "./pick.js";
import { fillConstraints, renderPlanFail, updateActions } from "./conditions.js";
import { REDUCE_MOTION, endCheck, leaveStart, renderCaseCard } from "./start.js";
// defined in later modules: app.js hands them in (wire) before any of them is called
let addMsg, addNextChips, caseHash, clearScanRx, renderLegend, renderResult, renderScanPane, renderSide, setHash,
  stopPlay;
export function wire(fns) { ({ addMsg, addNextChips, caseHash, clearScanRx, renderLegend, renderResult,
    renderScanPane, renderSide, setHash, stopPlay } = fns); }
// ---- rail: where the dentist is and where they can go next
function renderRail() {
  const start = document.body.classList.contains("start"), checking = document.body.classList.contains("checking");
  const patientsOpen = !$("caseGate").hidden;
  // three items (#13 polish): the patients modal and the input check belong to 「환자」; the routing by data-go stays
  const on = patientsOpen || start || checking ? "start" : "case";
  for (const b of document.querySelectorAll("#rail button")) {
    const go = b.dataset.go;
    b.classList.toggle("on", go === on);
    b.disabled = go === "check" ? !state.checkCase && !(state.patient?.scans?.length) : go === "case" ? !state.meshCase : go === "export" ? $("exportBtn").disabled : false;
    b.classList.toggle("done", go === "case" ? !!state.meshCase && on !== "case" : go === "export" ? !!$("stlLink").getAttribute("href") : false);
  }
}

function sameConstraints(a, b) {
  const keys = ["extraction", "lock", "ipr_exclude", "ipr_limit_mm", "stage_cap", "order"];
  return !!a && !!b && keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null))
    && JSON.stringify(normSurfaces(a.ipr_surfaces)) === JSON.stringify(normSurfaces(b.ipr_surfaces));
}

// With extraction teeth prescribed only the extraction plan is made (#56): an expansion/IPR comparison is not offered.
function withoutComparison(options) {
  const prescribed = ($("cExtract")?.value ?? "").trim() !== "";
  return prescribed ? options.filter((o) => !/확장안과 IPR안을 비교/.test(o.message ?? "")) : options;
}

function sampleOf(caseId) {
  return state.cases.find((c) => c.case_id === caseId && c.kind === "sample") ?? null;
}

// Opening a case whose scan is not on screen yet shows the loading line over the 3D at once (the scan takes a moment
// to arrive and draw); it fades out when the case is open, or on a failure.
async function activateCase(caseId, opts) {
  if (state.streaming || state.loading) return;
  const fresh = caseId !== state.meshCase;
  if (fresh) meshLoading(true);
  try { return await openCase(caseId, opts); } finally { if (fresh) meshLoading(false); }
}
// the 「사라짐」 half of the one transition rule (style.css): `el` gets .vanishing and this resolves once its fade is
// through — 120 ms, and 80 ms more for the panels that follow the 3D; at once with reduced motion or nothing on screen.
// The caller takes .vanishing off in the same task that hides or empties it.
function fxOut(el) {
  const screen = el === document.body;
  if (screen ? el.classList.contains("start") : !el.childElementCount) return Promise.resolve();
  el.classList.add("vanishing");
  return new Promise((r) => setTimeout(r, REDUCE_MOTION.matches ? 0 : screen ? 120 + 2 * 40 : 120));
}
function meshLoading(on) {
  const el = $("meshLoading");
  clearTimeout(el.fade);
  if (on) { el.hidden = false; el.classList.remove("out"); return; }
  el.classList.add("out");
  el.fade = setTimeout(() => { el.hidden = true; }, REDUCE_MOTION.matches ? 0 : 140);   // the 120 ms fade (style.css), then off
}
async function openCase(caseId, { greet = true, restart = false } = {}) {
  ++state.selectionVersion;
  state.requestId = null;
  state.messages = [];
  state.followup = null;
  state.lastRequest = null; $("retryBar").hidden = true;   // 다시 보내기 replays the failed case's request, never into the case opened next
  stopPlay(); scanFx.cancel(); manualEdit.drop();
  if (caseId !== state.meshCase) { group.clear(); ghost.clear(); state.meshCase = null; }
  // plans saved before this opening fold as 지난 계획; the preview this opening makes (#92) is not one of them
  const before = await api("/api/plans?case_id=" + encodeURIComponent(caseId));
  state.oldPlans = new Set(before.plans.map((p) => p.plan_id));
  // 「처음부터」 (restart): the server forgets the case's step flow and conditions first, then answers like /activate
  const info = await api(`/api/cases/${encodeURIComponent(caseId)}/${restart ? "restart" : "activate"}`, { method: "POST" });
  await fxOut($("transcript"));
  $("transcript").classList.remove("vanishing");
  $("transcript").innerHTML = "";   // a conversation belongs to one patient scan
  state.planError = info.plan_error ?? null;   // the case opened but no plan could be made: the server's sentence
  state.setup = null; state.target = null; state.targetId = null; state.setupRed = false; state.caseInfo = info;
  clearScanRx();   // the 스캔 tab starts clean: the prescription marks come with the setup
  state.progress = "initial"; for (const s of STEPS) document.body.classList.toggle("prog-" + s, s === "initial");
  await loadMesh(caseId);
  resetPlanPanel();
  fillConstraints(info.constraints);
  await refreshPlans(null, false);   // the case's earlier plans as cards only (#20): nothing is computed or shown at open
  renderCaseCard(caseId, info);
  renderScanPane(info);
  await restoreProgress(info.flow ?? info.state);   // how far the step flow went, as the server keeps it (#146: flow {step, constraints, target_id, plan_id})
  state.activeCase = caseId;
  $("caseGate").hidden = true;
  endCheck();
  setStep("initial");   // the flow starts at the scan as it is (#15); the address follows
  leaveStart();
  if (greet) {
    // The agent opens the conversation (clinical SW: case first, then constraints). Kept in the transcript
    // the model sees, so it knows which case is on screen.
    const sample = sampleOf(caseId);
    const asPrescribed = sample && sameConstraints(info.constraints, sample.constraints);
    const text = `케이스 ${caseId} (상악 ${info.n_teeth}개 치아, 총생 ${info.crowding_mm} mm) 를 불러왔습니다. ` + (sample
      ? (restart   // 처음부터: the conditions are empty until the prescription chip's setup turn fills them
        ? `처음부터 다시 시작했습니다. 의사 처방(${sample.prescription})은 아직 계획 조건에 넣지 않았습니다.`
        : asPrescribed
        ? `의사 처방(${sample.prescription})을 계획 조건에 넣어 두었습니다.` + (sample.note ? ` ${sample.note}` : "")
        : `이 케이스에서 전에 바꾼 계획 조건이 남아 있습니다. 처방(${sample.prescription})과 다르니 조건 칸을 확인해 주세요.`)
      : `계획을 시작하려면 제약을 알려 주세요.`);
    // no bubble: the case card on the panel top already says it; only a changed prescription is worth a line
    if (sample && !asPrescribed && !restart) addMsg("system", "조건이 처방과 다릅니다 · 오른쪽 「조건」 탭을 확인해 주세요.");
    // the agent's first word (#20): the prescription; a sample offers its own as one chip that sends it. A case the
    // server restored further along says where it stands, and the chips continue from there.
    const ask = state.progress === "initial" ? "처방을 적어 주세요."
      : `이 케이스는 ${{ setup: "셋업", target: "목표 배열", stages: "단계" }[state.progress]}까지 되어 있습니다. 이어서 진행하세요.`;
    state.messages.push({ role: "assistant", content: text + " " + ask });
    const bubble = addMsg("assistant", ask);
    if (state.progress !== "initial") {   // the restored case can start over from the prescription chip (the demo again)
      const again = document.createElement("button");
      again.type = "button"; again.className = "link-btn restart-link"; again.textContent = "처음부터 다시";
      again.addEventListener("click", restartCase);
      bubble.append(again);
    }
    addNextChips(bubble);
  }
}


// 「처음부터」 (case header, and 「처음부터 다시」 beside the restored case's line): one click, no confirmation (it is
// clicked mid-demo). The case opens again from 초기 — no conversation, no plan on screen, the scan without cuts or marks,
// the prescription chip back; its plans stay, folded as 지난 계획. The address keeps only #case=….
// Opening a case from the start screen still restores where it stood; only this click starts over.
async function restartCase() {
  const id = state.activeCase;
  if (!id || state.streaming || state.loading) return;
  try { await activateCase(id, { restart: true }); } catch (e) { addMsg("error", "처음부터 다시 열지 못했습니다 (" + e.message + ")."); }
}
$("restartBtn").addEventListener("click", restartCase);

// The server may send the case's current step state with /activate (#20 decision 1): `state: {setup: constraints|null,
// target_id: str|null, plan_id: str|null}`. Each field opens the strip that far; without it the case opens at 초기.
async function restoreProgress(st) {
  state.restoredStep = null;
  if (!st) return;
  state.restoredStep = STEPS.includes(st.step) ? st.step : null;   // where the case stands: the router lands there when the address names no step
  const setup = st.constraints ?? st.setup;
  if (setup) { state.setup = setup; state.scanRx = setup; fillConstraints(setup); setProgress("setup", true); loadSetupCut(); }
  if (st.target_id) {
    try {
      state.target = await api(`/api/cases/${encodeURIComponent(state.meshCase)}/targets/${encodeURIComponent(st.target_id)}`);
      state.targetId = st.target_id; setProgress("target", true);
      loadTargetCut(st.target_id);   // the cut follows; the target shows at once
    } catch (e) { addMsg("system", "저장된 목표 배열을 불러오지 못했습니다 (" + e.message + ")."); }
  }
  if (st.plan_id && st.plan_id in state.planRows) await loadPlan(st.plan_id);   // a plan on screen opens the stages
}
function resetPlanPanel() {
  stopPlay();
  state.plan = null;
  document.body.classList.remove("has-plan");
  applyStage(0);
  state.planRows = {}; state.planRowsCase = null;
  renderPlanList();
  $("viewCanvas").dataset.planId = "";
  $("reviewMemo").textContent = "";
  $("reviewLine").textContent = "검토"; $("planReview").hidden = true;
  renderLegend(null);
  $("planNotice").textContent = "";
  $("stageSlider").disabled = true;
  $("stageMarks").innerHTML = "";
  renderSide(null);
  updateActions();
}

async function loadMesh(caseId) {
  if (!caseId || caseId === state.meshCase) return;
  const pre = meshPrefetch.case === caseId ? meshPrefetch.promise : null;   // a sample card hovered on the start screen
  meshPrefetch.drop();
  const mesh = (pre && await pre) || await api(`/api/cases/${encodeURIComponent(caseId)}/mesh`);
  state.meshCase = caseId;
  state.plan = null;
  buildTeeth(mesh);
  applyStage(0);
}
// Hovering a sample card fetches its scan ahead (it also warms the server's copy): only the last hovered card, kept 30 s,
// so a dozen hovers hold one scan, not a dozen. A failed prefetch is nothing: the opening fetches again.
const meshPrefetch = {
  case: null, promise: null, timer: 0,
  start(caseId) {
    if (this.case === caseId) return;
    this.drop();
    this.case = caseId;
    this.promise = api(`/api/cases/${encodeURIComponent(caseId)}/mesh`).catch(() => null);
    this.timer = setTimeout(() => this.drop(), 30000);
  },
  drop() { clearTimeout(this.timer); this.case = null; this.promise = null; },
};
$("sampleCards").addEventListener("pointerover", (e) => {
  const id = e.target.closest(".case-card")?.dataset.id;
  if (id && id !== state.meshCase) meshPrefetch.start(id);
});


const STRATEGY_ORDER = ["expansion", "ipr", "expansion_ipr", "extraction"];

function preferredPlanId(plans) {
  if (!plans.length) return null;
  const parent = plans[0].parent_plan_id ?? null;
  const batch = plans.filter((p) => (p.parent_plan_id ?? null) === parent);
  const ranked = [...batch].sort((a, b) => STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy));
  return (ranked.find((p) => p.passed) ?? ranked[0] ?? plans[0]).plan_id;
}


async function refreshPlans(selectId, select = true) {
  const caseId = state.meshCase, generation = state.selectionVersion;
  const { plans } = await api("/api/plans?case_id=" + encodeURIComponent(caseId));
  if (caseId !== state.meshCase || generation !== state.selectionVersion) return;
  // how many plans are new since the last refresh of this case: a turn that made several compared strategies
  const known = state.planRowsCase === caseId ? state.planRows : null;
  state.newPlans = known ? plans.filter((p) => !(p.plan_id in known)).length : 0;
  // /api/plans lists newest first; the cards read oldest first, so 계획 1 is the first plan of the case
  state.planRows = Object.fromEntries([...plans].reverse().map((p) => [p.plan_id, p]));
  state.planRowsCase = caseId;
  renderPlanList();
  const id = selectId ?? state.plan?.plan_id ?? (select ? preferredPlanId(plans) : null);
  if (id) await loadPlan(id);
}

// 계획 N: the plan's place in the case's creation order (the address and tooltips keep the id)
function planNo(planId) {
  const i = Object.keys(state.planRows).indexOf(planId);
  return i < 0 ? "?" : i + 1;
}
const REVIEW_SHORT = { not_requested: "검토 전", skipped: "검토 전", running: "검토 중", passed: "검토 완료", failed: "검토 실패" };
function planPill(row) {
  const viol = typeof row.violations === "number" ? row.violations : (row.violations ?? []).length;
  if (row.input_stale) return ["이전 스캔 기준", "warn"];
  if (row.approval || row.approved) return ["승인됨", "ok"];
  const review = state.skippedPlans.has(row.plan_id) ? "건너뜀" : REVIEW_SHORT[row.review?.status] ?? "검토 전";   // rules and review in one line (#14)
  return viol ? [`위반 ${viol}건 · ${review}`, "fail"] : [`규칙 통과 · ${review}`, "pass"];
}
// The review badge on a card: a pulse dot while the review runs. When a review this screen watched lands (the card was
// 검토 중, or the turn's reviewer / the server reviewed a new plan: state.reviewPending), the dot settles as a check or an
// X, the badge turns red on a failure (review failed, or every allowed plan broke a rule), and the card's frame lights
// once for 300 ms — the flash is timed from the first render the dentist can see, so a re-render continues it.
const FLASH_MS = 300;
const planViolations = (row) => (typeof row.violations === "number" ? row.violations : (row.violations ?? []).length);
function reviewBadge(row, pl) {
  const id = row.plan_id, status = state.skippedPlans.has(id) ? "skipped" : row.review?.status, landed = ["passed", "failed"].includes(status);
  if (landed && (state.reviewSeen[id] === "running" || state.reviewPending.has(id))) state.reviewLand[id] = { ok: status === "passed" && !planViolations(row), t: null };
  if (!landed) delete state.reviewLand[id];
  state.reviewSeen[id] = status;
  state.reviewPending.delete(id);
  if (status === "running") { pl.prepend(Object.assign(document.createElement("i"), { className: "pulse-dot" })); return null; }
  const land = state.reviewLand[id];
  if (!land || row.approval || row.approved || row.input_stale) return null;
  pl.prepend(Object.assign(document.createElement("i"), { className: "pulse-dot " + (land.ok ? "ok" : "fail") }));
  if (!land.ok) { pl.classList.remove("pass", "ok"); pl.classList.add("fail"); }
  if (!$("planPick").hidden) land.t ??= performance.now();
  const age = land.t == null ? 0 : performance.now() - land.t;
  return age < FLASH_MS ? { ok: land.ok, age } : null;
}
function flashCard(el, flash) {
  if (flash) { el.classList.add(flash.ok ? "flash-ok" : "flash-fail"); el.style.animationDelay = `-${Math.round(flash.age)}ms`; }
  return el;
}
// The plan picker over the right panel's tabs: the plan on screen in one line (계획 N · strategy · stages · months ·
// the rules/review/approval badge), with two plans or more a ▾ opening the list (the one on screen marked .current);
// a row picked there goes on screen. Plans that existed before the case was opened sit folded under 지난 계획 (#105)
// at the list's foot. Only on the stages step; the line fades in as the first plan lands.
function renderPlanList() {
  const rows = Object.values(state.planRows), cur = state.plan?.plan_id;
  if (rows.length) state.planError = null;
  renderPlanFail();
  const pick = $("planPick"), show = !!rows.length && state.step === "stages";
  if (show && pick.hidden) { pick.classList.remove("fade-in"); void pick.offsetWidth; pick.classList.add("fade-in"); }
  pick.hidden = !show;
  if (!show) openPlanMenu(false);
  $("planMore").hidden = rows.length < 2;
  const old = rows.filter((r) => state.oldPlans.has(r.plan_id)), now = rows.filter((r) => !state.oldPlans.has(r.plan_id));
  const make = (row, line = false) => {
    const div = document.createElement("div");
    const n = planNo(row.plan_id), months = row.months ?? row.info?.months, [pill, cls] = planPill(row);
    div.className = "plan-row" + (row.plan_id === cur ? " current" : "");
    div.dataset.plan = row.plan_id;
    div.title = row.plan_id + (row.parent_plan_id ? " ← " + row.parent_plan_id : " · 최초 계획");
    div.innerHTML = `<span class="n"></span><span class="what"></span><span class="pill"></span>`;
    div.querySelector(".n").textContent = `계획 ${n}`;
    div.querySelector(".what").textContent = `${STRATEGY_KO[row.strategy] ?? row.strategy}` + (row.manual && row.strategy !== "manual" ? " · 수동 조정" : "") + ` · ${row.n_stages}장` + (months != null ? ` · 약 ${months}개월` : "");
    const pl = div.querySelector(".pill"); pl.textContent = pill; pl.classList.add(cls);
    const flash = reviewBadge(row, pl);
    // the other strategies one 다시 계산 tried sit folded in its chosen plan's card: alternatives of one request,
    // not a time line like 지난 계획 (the server keeps every plan, so their ids and numbers stay)
    const alts = line ? [] : tries.get(row.plan_id) ?? [];
    if (alts.length) {
      const d = document.createElement("details"); d.className = "plan-tries";
      d.open = alts.some((r) => r.plan_id === cur) || state.openTries.has(row.plan_id);
      d.addEventListener("toggle", () => { if (d.open) state.openTries.add(row.plan_id); else state.openTries.delete(row.plan_id); });
      d.innerHTML = `<summary></summary><div class="plan-list"></div>`;
      d.querySelector("summary").textContent = `시도한 전략 ${row.rule_run.tried?.length ?? alts.length + 1}개 보기`;
      d.querySelector(".plan-list").replaceChildren(...alts.map((r) => make(r)));
      // card and fold in one frame, side by side in the DOM: a selector on the card (.plan-row.current .pill) never
      // reaches the rows in the fold
      const group = document.createElement("div"); group.className = "plan-group" + (row.plan_id === cur ? " current" : "");
      group.append(div, d);
      return flashCard(group, flash);
    }
    return flashCard(div, flash);
  };
  // a rule plan's run (rule_run): the plan it chose leads, the others it tried go under that card
  const tries = new Map(), folded = new Set();
  for (const r of rows) {
    const lead = r.rule_run?.chosen_plan_id;
    if (lead && lead !== r.plan_id && state.planRows[lead]) { (tries.get(lead) ?? tries.set(lead, []).get(lead)).push(r); folded.add(r.plan_id); }
  }
  const shown = (list) => list.filter((r) => !folded.has(r.plan_id));
  $("oldPlans").hidden = !shown(old).length;
  $("oldPlansN").textContent = shown(old).length;
  if (old.some((r) => r.plan_id === cur)) $("oldPlans").open = true;
  $("planCur").replaceChildren(state.planRows[cur] ? make(state.planRows[cur], true) : Object.assign(document.createElement("span"), { className: "none", textContent: "계획을 고르세요" }));
  $("oldPlanList").replaceChildren(...shown(old).map((r) => make(r)));
  $("planList").replaceChildren(...shown(now).map((r) => make(r)));
}
function openPlanMenu(open) {
  $("planMenu").hidden = !open;
  $("planMore").setAttribute("aria-expanded", String(open));
}

async function loadPlan(planId) {
  if (!planId) return;
  const version = ++state.selectionVersion, caseId = state.meshCase;
  state.loading = true; updateActions();
  $("planNotice").textContent = "계획 불러오는 중 — 다운로드 잠김";
  try {
    const [plan, cut] = await Promise.all([api("/api/plans/" + encodeURIComponent(planId)),
      state.cutSets["plan:" + planId] ? null : api(`/api/plans/${encodeURIComponent(planId)}/cut`)]);   // #22, #146: the cut crowns alone
    if (version !== state.selectionVersion || caseId !== state.meshCase) return;
    if (plan.case_id !== caseId) throw new Error("선택 케이스와 계획이 다릅니다.");
    stopPlay();
    if (sweepFx.planId && sweepFx.planId !== planId) sweepFx.clear();   // another plan: the rule check's red was another plan's
    state.plan = plan;
    if (cut && cut.plan_id === planId) setCut(cut, "plan:" + planId);
    fillConstraints(plan.constraints);
    const slider = $("stageSlider");
    slider.max = plan.stages.length;
    slider.disabled = false;
    applyStage(0); renderResult(plan); renderStageMarks();
    document.body.classList.add("has-plan");
    setProgress("stages");   // a plan on screen means the stages are done (also on reload, #20)
    $("viewCanvas").dataset.planId = planId;
    $("planNotice").textContent = "";
    // the plan joins the address: a new plan pushes, so back/forward walk through plans; while routing it replaces
    if (state.activeCase === caseId) setHash(caseHash());
  } catch (e) {
    if (version === state.selectionVersion) {
      $("planNotice").textContent = "계획 로드 실패 — 이전 결과를 유지합니다.";
      throw e;
    }
  } finally {
    if (version === state.selectionVersion) { state.loading = false; updateActions(); }
  }
}

export { activateCase, fxOut, loadMesh, loadPlan, openPlanMenu, planNo, refreshPlans, renderPlanList, renderRail,
  resetPlanPanel, sampleOf, withoutComparison };
