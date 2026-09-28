// cuAlign web UI — patient → scan upload → input check on the 3D → chat (NAT /chat/stream, inline tool trace) → three.js stage viewer → plan panel.
// 진입점: the modules in the one-file order (their top level runs as app.js's did), then the wiring, the address
// routing, 직접 이동 and init.
import { THREE } from "./three-load.js";
import { createManual } from "./manual.js";
import { $, api, fdi, manualEdit, state, setManualEdit } from "./state.js";
import { applyStage, camera, canvas, controls, cutKeyNow, ghost, loadSetupCut, loadTargetCut, renderSetupMarks,
  resize, scene, setProgress, setStep, setView, sweepFx, wire as wire_viewer } from "./viewer.js";
import { renderSelection, wire as wire_pick } from "./pick.js";
import { fillConstraints, readConstraints, wire as wire_conditions } from "./conditions.js";
import { REDUCE_MOTION, endCheck, leaveStart, loadCases, loadPatients, openCheck, openPatient, renderCaseList,
  showScreen, showStart, wire as wire_start } from "./start.js";
import { activateCase, fxOut, loadMesh, loadPlan, planNo, refreshPlans, renderPlanList, renderRail, resetPlanPanel,
  sampleOf, wire as wire_plans } from "./plans.js";
import { addMsg, addReviewQuestions, renderMd, reviewQuestions, setWorkNote, wire as wire_chat } from "./chat.js";
import { addNextChips, send, stopPlay, wire as wire_turns } from "./turns.js";
import { autosize, wire as wire_controls } from "./controls.js";
import { clearScanRx, followStep, markChartSelection, markScanRx, markStage, renderLegend, renderResult,
  renderRulesPane, renderScanPane, renderSide, showTab } from "./panes.js";
import { closeExportPop, exportPopKey, pollExportStatus, toast } from "./export.js";
// the later modules' functions to the earlier ones that call them (the one-file app.js had them all in scope)
wire_viewer({ caseHash, closeExportPop, followStep, markScanRx, markStage, renderPlanList, renderSelection, setHash,
  setWorkNote, stopPlay });
wire_pick({ REDUCE_MOTION, addMsg, loadPlan, markChartSelection, stopPlay });
wire_conditions({ addMsg, closeExportPop, exportPopKey, planNo, pollExportStatus, renderPlanList, renderRail,
  renderResult });
wire_start({ activateCase, addMsg, fxOut, renderRail, resetPlanPanel, sampleOf, setHash });
wire_plans({ addMsg, addNextChips, caseHash, clearScanRx, renderLegend, renderResult, renderScanPane, renderSide,
  setHash, stopPlay });
wire_chat({ autosize, send });
wire_turns({ autosize, markScanRx, renderRulesPane, showTab, toast });
wire_controls({ caseHash, setHash, showTab });
// Each screen gets an address (#start, #case=<id>[&plan=<planId>], #patients, #patient=<id>, #check=<case>) so the browser's back
// and forward buttons move between screens (#90). Moves made by back/forward replace instead of pushing.
let routing = false;
// the case's address: #case=<id>[&plan=<planId>][&step=setup|target|stages] (#15)
function caseHash() {
  return `#case=${state.activeCase}` + (state.plan ? `&plan=${state.plan.plan_id}` : "") + (state.step !== "initial" ? `&step=${state.step}` : "");
}
function setHash(h) {
  if (location.hash === h) return;
  if (routing) history.replaceState(null, "", h); else history.pushState(null, "", h);
}
async function route(hash) {
  // key=value pairs split by "&": #case=<id>&plan=<planId>; the first pair names the screen
  const pairs = decodeURIComponent(hash.slice(1)).split("&").map((kv) => { const i = kv.indexOf("="); return i < 0 ? [kv, ""] : [kv.slice(0, i), kv.slice(i + 1)]; });
  const [key, id] = pairs[0], { plan, step } = Object.fromEntries(pairs);
  routing = true;
  try {
    if (key === "case" && id) {
      if (id === state.activeCase) {
        $("caseGate").hidden = true; endCheck(); leaveStart();
        if (state.meshCase !== state.activeCase) { await loadMesh(state.activeCase); await refreshPlans(); }
      }
      else await activateCase(id);
      // a plan in the address opens once the case is on screen, if this case has it
      if (plan && state.activeCase === id && !state.streaming && plan !== state.plan?.plan_id
          && plan in state.planRows) await loadPlan(plan);
      // back/forward and reload keep the step; a case opened with no step in the address lands where the server's flow left it (#146)
      const land = step ?? state.restoredStep ?? "initial"; state.restoredStep = null;
      if (state.activeCase === id) setStep(land);
    } else if (key === "patients") { await loadPatients(); showScreen("patients"); }
    else if (key === "patient" && id) await openPatient(id);
    else if (key === "check" && id) {
      const m = /^(P\d{4,})-(S\d+)$/.exec(id);
      if (m && state.patient?.patient_id !== m[1]) await openPatient(m[1]);
      await openCheck(id);
    } else await showStart();
  } finally { routing = false; }
}
window.addEventListener("popstate", () => route(location.hash).catch((err) => addMsg("error", err.message)));

setManualEdit(createManual({ THREE, scene, camera, canvas, ghost, state, $, fdi, api, applyStage, showTab, followStep, setStep, addMsg, toast, loadTargetCut,
  afterApply: () => addNextChips($("transcript").lastElementChild),
  // a 셋업 edit, stored: the scan-position target it made is the 목표 now
  enterTarget: (t) => { state.target = t; state.targetId = t.target_id; state.targetSummary = null; setProgress("target", true); setStep("target"); loadTargetCut(t.target_id); },
  // the 셋업 right-click changed the prescription (POST …/setup/conditions answers as step_done setup): the setup is
  // redrawn from it as a landed setup is — the form, the marks, the cut crowns, the 스캔 tab's chart; later steps are stale
  setupChanged: (done) => {
    state.setup = done.constraints; state.targetId = null;
    fillConstraints(done.constraints);
    setProgress("setup", true);
    loadSetupCut();
    renderSetupMarks();
    renderScanPane(state.caseInfo);
    applyStage(state.stage);
  } }));

(async function init() {
  try {
  resize();
  let active = null;
  try { active = await loadCases(); } catch (e) { addMsg("error", `케이스 목록 로드 실패: ${e.message}`); }
  const params = new URLSearchParams(location.search);
  try {
  if (params.get("plan")) {
    const linkedPlan = await api("/api/plans/" + encodeURIComponent(params.get("plan")));
    const m = /^(P\d{4,})-(S\d+)$/.exec(linkedPlan.case_id);
    if (m && linkedPlan.input_stale) {
      await openPatient(m[1]);
      await openCheck(linkedPlan.case_id);
      alert("이 계획은 확인 전이거나 번호가 바뀐 이전 입력으로 만든 것입니다. 입력을 확인한 뒤 다시 계획하세요.");
      return;
    }
    if (m) { try { state.patient = await api("/api/patients/" + m[1]); } catch { /* deleted patient: show the plan read-only */ } }
    await activateCase(linkedPlan.case_id, { greet: false });
    await refreshPlans(params.get("plan"));
    setStep("stages");   // a plan link lands on the stages
    return;
  }
  } catch (e) { addMsg("error", "계획 링크를 불러오지 못했습니다: " + e.message); }
  // ?case=<id> opens a case directly (development and tests; e.g. the synthetic "moderate"). When the address already
  // names a case (a reload after the plan joined the hash), the hash route below opens it with that plan.
  if (params.get("case") && !/^#case=/.test(location.hash)) {
    try { await activateCase(params.get("case")); return; }
    catch (e) { addMsg("error", `케이스 로드 실패: ${e.message}`); }
  }
  // The page opens in the start state; "내 스캔 올리기" leads to the patient flow (patient → scan → plan).
  if (active) { state.clSelected = active; state.clPreset = true; renderCaseList(); }   // the list opens on the case the server has active
  // a reload or a shared address opens the same screen; otherwise this is the start state
  if (location.hash && location.hash !== "#start") {
    routing = true;
    try { await route(location.hash); } catch (e) { addMsg("error", e.message); }
    routing = false;
  } else { history.replaceState(null, "", "#start"); renderRail(); }   // the rail lights 「환자」 on the very first paint too
  } finally { document.documentElement.classList.remove("booting"); }   // the address's screen is on: show it (#15)
})();
window.__cualign = { sweepFx, renderMd, reviewQuestions, addReviewQuestions, loadPlan, state, camera, controls, setView, cutKeyNow, readConstraints };   // test hook (scratch browser checks)

export { caseHash, setHash };
