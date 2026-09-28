// app.js 에서 나눈 모듈: the chat form, header and 3D controls' listeners (the one-file app.js's 「wiring」 section).
import { $, api, manualEdit, state } from "./state.js";
import { ghost, group } from "./viewer.js";
import { badgeTags, endCheck, leaveStart, loadPatients, openCheck, openFromList, openPatient, renderCaseList,
  showScreen, showStart, uploadScan } from "./start.js";
import { activateCase, loadMesh, loadPlan, openPlanMenu, refreshPlans } from "./plans.js";
import { addMsg } from "./chat.js";
import { send } from "./turns.js";
// defined in later modules: app.js hands them in (wire) before any of them is called
let caseHash, setHash, showTab;
export function wire(fns) { ({ caseHash, setHash, showTab } = fns); }

// ------------------------------------------------------------------ wiring
$("chatForm").addEventListener("submit", (e) => { e.preventDefault(); send($("chatInput").value); });
function autosize() {
  const ta = $("chatInput");
  ta.style.height = "auto";
  const max = innerHeight * 0.4;
  ta.style.height = Math.min(ta.scrollHeight, max) + "px";
  ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
}
$("chatInput").addEventListener("input", autosize);
// the logo: back to the start screen from anywhere — detail folded, list scrolled to the top (the href is #start
// for the browser; the click does the reset even when the address already is #start)
$("homeBtn").addEventListener("click", (e) => {
  e.preventDefault();
  state.clSelected = null;
  showStart().then(() => { $("screenStart").scrollTop = 0; }).catch((err) => addMsg("error", err.message));
});
// Enter while an IME (Hangul) is still composing only ends the composition: sending then would clear the box, and
// the composed last syllable would land in the empty box after it (keyCode 229 for browsers without isComposing).
$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send($("chatInput").value); }
});
$("resendBtn").addEventListener("click", () => {
  const last = state.lastRequest;
  if (last) send(last.text, last.constraints, { resend: true });
});
// a card or a row: one press opens its detail underneath (press again to fold), a double press opens the case
for (const id of ["sampleCards", "clRows"]) {
  $(id).addEventListener("click", (e) => {
    const el = e.target.closest(".case-card, .case-row");
    if (!el || e.target.closest("#clDetail")) return;
    // the detail the page opened on the server's active case: the first press on that card keeps it open, not folds it
    state.clSelected = state.clSelected === el.dataset.id && !state.clPreset ? null : el.dataset.id;
    state.clPreset = false;
    renderCaseList();
  });
  $(id).addEventListener("dblclick", (e) => { const el = e.target.closest(".case-card, .case-row"); if (el) openFromList(state.caseList.find((c) => c.case_id === el.dataset.id)); });
}
$("dOpen").addEventListener("click", () => openFromList(state.caseList.find((c) => c.case_id === state.clSelected)));
$("dClose").addEventListener("click", () => { state.clSelected = null; renderCaseList(); });
$("rail").addEventListener("click", async (e) => {
  const go = e.target.closest("button")?.dataset.go;
  if (!go || state.streaming || state.loading) return;
  if (go === "start") await showStart();
  else if (go === "patients") await loadPatients().then(() => showScreen("patients"));
  else if (go === "check") await openCheck(state.checkCase ?? state.patient.scans[state.patient.scans.length - 1].case_id);
  else if (go === "case") { $("caseGate").hidden = true; endCheck(); leaveStart(); setHash("#case=" + state.meshCase + (state.plan ? "&plan=" + state.plan.plan_id : "")); }
  else if (go === "export") $("exportBtn").click();
});
$("patientCards").addEventListener("click", (e) => {
  const head = e.target.closest(".p-head");
  if (!head) return;
  const item = head.closest(".patient");
  if (item.classList.contains("open")) {   // fold it again; the list stays
    ++state.gateVersion;
    loadPatients().then(() => showScreen("patients")).catch((err) => addMsg("error", err.message));
    return;
  }
  openPatient(item.dataset.pid).catch((err) => addMsg("error", "환자 불러오기 실패: " + err.message));
});
$("patientForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const p = await api("/api/patients", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias: $("pAlias").value, memo: $("pMemo").value }) });
    const files = [...$("pScans").files];
    $("pAlias").value = ""; $("pMemo").value = ""; $("pScans").value = "";
    $("pScansName").textContent = "";
    await openPatient(p.patient_id);
    if (files.length) await uploadScan(files);   // registered with its scan: go straight to 입력 확인
  } catch (err) { alert(err.message); }
});
$("scanList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]"), caseId = btn?.closest(".scan-row")?.dataset.case;
  if (!caseId) return;
  if (btn.dataset.act === "delete") {
    const sid = caseId.split("-")[1];
    if (!confirm(`스캔 ${sid}와 그 파일을 지웁니다. 되돌릴 수 없습니다.`)) return;
    api(`/api/patients/${encodeURIComponent(state.patient.patient_id)}/scans/${encodeURIComponent(sid)}`, { method: "DELETE" })
      .then(() => openPatient(state.patient.patient_id)).catch((err) => alert("삭제 실패: " + err.message));
    return;
  }
  const go = btn.dataset.act === "check" ? openCheck(caseId) : activateCase(caseId);
  go.catch((err) => addMsg("error", "스캔 열기 실패: " + err.message));
});
function showPicked() {
  const n = $("pScans").files.length;
  $("pScansName").textContent = n ? `${n}개 파일 · 등록하면 바로 올라갑니다` : "";
}
$("pScans").addEventListener("change", showPicked);
$("scanInput").addEventListener("change", (e) => { uploadScan([...e.target.files]); e.target.value = ""; });
// both drop boxes take dragged files. The new-patient box puts them into #pScans so 등록 uploads them the same way
// a pressed-and-chosen set goes; the open patient's box uploads at once
for (const id of ["pDrop", "dropZone"]) {
  for (const ev of ["dragenter", "dragover"]) $(id).addEventListener(ev, (e) => { e.preventDefault(); $(id).classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) $(id).addEventListener(ev, (e) => { e.preventDefault(); $(id).classList.remove("over"); });
}
$("pDrop").addEventListener("drop", (e) => { $("pScans").files = e.dataTransfer.files; showPicked(); });
$("dropZone").addEventListener("drop", (e) => uploadScan([...e.dataTransfer.files]));
$("startPlan").addEventListener("click", async () => {
  const caseId = state.checkCase, revision = state.checkRevision;   // exactly what is on screen now
  const [pid, sid] = (caseId ?? "").split("-");
  $("startPlan").disabled = true;
  try {
    // the confirmation is recorded on the server for this revision; planning tools refuse anything else
    if (state.patient && sid) {
      await api(`/api/patients/${encodeURIComponent(pid)}/scans/${encodeURIComponent(sid)}/confirm`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
      state.patient = await api("/api/patients/" + encodeURIComponent(pid));
    }
    if (state.checkCase === caseId) await activateCase(caseId);
  } catch (err) { alert("계획 시작 실패: " + err.message); $("startPlan").disabled = false; }
});
// 스캔 삭제 on the input check: one confirmation in place, then back to the patient's scans (#112)
$("deleteScan").addEventListener("click", () => { $("deleteScanPop").hidden = !$("deleteScanPop").hidden; });
$("deleteScanCancel").addEventListener("click", () => { $("deleteScanPop").hidden = true; });
$("deleteScanGo").addEventListener("click", async () => {
  const caseId = state.checkCase, [pid, sid] = (caseId ?? "").split("-");
  $("deleteScanPop").hidden = true;
  if (!pid || !sid) return;
  try {
    await api(`/api/patients/${encodeURIComponent(pid)}/scans/${encodeURIComponent(sid)}`, { method: "DELETE" });
    if (state.meshCase === caseId) { group.clear(); ghost.clear(); state.meshCase = null; }
    state.checkCase = null;
    await openPatient(pid);
  } catch (err) { addMsg("error", "스캔 삭제 실패: " + err.message); }
});
$("mirrorBtn").addEventListener("click", async () => {
  const caseId = state.checkCase;
  const [pid, sid] = (caseId ?? "").split("-");
  if (!confirm("치아 파일 번호를 좌우로 뒤집습니다 (17↔27, 16↔26 …). 계속할까요?")) return;
  try {
    const check = await api(`/api/patients/${encodeURIComponent(pid)}/scans/${encodeURIComponent(sid)}/mirror`, { method: "POST" });
    if (state.checkCase === caseId) await openCheck(caseId, check);
  } catch (err) { alert("번호 뒤집기 실패: " + err.message); }
});
$("deletePatient").addEventListener("click", async () => {
  const p = state.patient;
  if (!p || !confirm(`환자 ${p.alias} (${p.patient_id})와 스캔 ${p.scans.length}개를 이 컴퓨터에서 지웁니다. 되돌릴 수 없습니다.`)) return;
  try {
    await api("/api/patients/" + encodeURIComponent(p.patient_id), { method: "DELETE" });
    state.patient = null;
    await loadPatients(); showScreen("patients");
  } catch (err) { alert("삭제 실패: " + err.message); }
});
$("toPatients").addEventListener("click", () => loadPatients().then(() => showScreen("patients")).catch((err) => addMsg("error", "환자 목록 로드 실패: " + err.message)));
// 다른 스캔: back to the modal with this patient open
$("otherScan").addEventListener("click", () => {
  const go = state.patient ? openPatient(state.patient.patient_id) : loadPatients().then(() => showScreen("patients"));
  go.catch((err) => addMsg("error", err.message));
});
function renderCasePop() {
  const wrap = $("popCases");
  wrap.innerHTML = "";
  for (const c of state.cases.filter((x) => x.kind === "sample" && x.available)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "item" + (c.case_id === state.activeCase ? " current" : ""); b.dataset.id = c.case_id;
    b.innerHTML = '<img alt=""><span><b></b><small></small><span class="badges"></span></span>';
    b.querySelector("img").src = `samples/${encodeURIComponent(c.case_id)}.png`;
    b.querySelector("b").textContent = c.title;
    b.querySelector("small").textContent = c.summary;
    b.querySelector(".badges").replaceChildren(...badgeTags(c.badges));
    b.title = "처방 · " + c.prescription;
    wrap.appendChild(b);
  }
}
$("caseBtn").addEventListener("click", () => {
  if (state.patient) { openPatient(state.patient.patient_id).catch((err) => addMsg("error", err.message)); return; }
  const pop = $("casePop");
  if (pop.hidden) renderCasePop();
  pop.hidden = !pop.hidden;
});
$("popCases").addEventListener("click", (e) => {
  const wrap = $("popCases"), act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "cancel") { renderCasePop(); return; }
  const item = e.target.closest(".item");
  const id = act === "go" ? wrap.dataset.pending : item?.dataset.id;
  if (!id || state.streaming || state.loading) return;
  // switching clears the conversation: once the dentist has said something, ask first (inline, in the popover)
  if (!act && id !== state.activeCase && state.messages.some((m) => m.role === "user")) {
    wrap.dataset.pending = id;
    wrap.innerHTML = '<div class="pop-confirm"><p>대화와 계획 보기가 비워집니다. 계속할까요?</p><div>' +
      '<button class="btn primary small" type="button" data-act="go">계속</button>' +
      '<button class="btn ghost small" type="button" data-act="cancel">취소</button></div></div>';
    return;
  }
  $("casePop").hidden = true;
  if (id !== state.activeCase) { state.patient = null; activateCase(id).catch((err) => addMsg("error", `케이스 로드 실패: ${err.message}`)); }
});
$("popPatients").addEventListener("click", () => { $("casePop").hidden = true; loadPatients().then(() => showScreen("patients")).catch((err) => addMsg("error", err.message)); });
document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".case-head")) $("casePop").hidden = true; });
$("gateClose").addEventListener("click", async () => {
  // no case open yet: the start state (the sample cards) is where the modal came from
  if (!state.activeCase) { showStart().catch((err) => addMsg("error", err.message)); return; }
  $("caseGate").hidden = true;
  setHash(caseHash());
  // the input check may have put another scan in the viewer: go back to the case being planned, whose
  // constraints and chips are still on screen (#70 review)
  if (state.meshCase !== state.activeCase) {
    try { await loadMesh(state.activeCase); await refreshPlans(); } catch (err) { addMsg("error", err.message); }
  }
});
// the plan picker: ▾ (or the line itself, with two plans or more) opens the list; a row picked there puts that plan in
// the 3D and the sidebar (#111) and the list closes
$("planPick").querySelector(".plan-line").addEventListener("click", () => { if (!$("planMore").hidden) openPlanMenu($("planMenu").hidden); });
$("planMenu").addEventListener("click", (e) => {
  const id = e.target.closest(".plan-row")?.dataset.plan;
  if (!id || state.streaming || state.loading) return;
  openPlanMenu(false);
  if (id !== state.plan?.plan_id) loadPlan(id).catch((err) => addMsg("error", `계획 로드 실패: ${err.message}`));
});
// sidebar tabs: a tab picked by hand holds while the step stays (the turn in progress); the next step takes the panel again
for (const b of document.querySelectorAll(".side-tab")) b.addEventListener("click", () => {
  if (b.dataset.tab === "move") { manualEdit.open(); return; }   // 직접 이동: the tab opens the edit, which shows its pane
  state.tabPin = { caseId: state.meshCase, step: state.step };
  showTab(b.dataset.tab);
});

export { autosize };
