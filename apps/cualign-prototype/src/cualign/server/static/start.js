// app.js 에서 나눈 모듈: the start screen and the patient flow — screens, the column resizers, patients, scan upload,
// the input check, the case list and its detail.
import { CSS2DObject } from "./three-load.js";
import { $, STRATEGY_KO, api, fdi, fdiList, fmtDate, state } from "./state.js";
import { AMBER, BLUE, buildTeeth, group, resize } from "./viewer.js";
// defined in later modules: app.js hands them in (wire) before any of them is called
let activateCase, addMsg, fxOut, renderRail, resetPlanPanel, sampleOf, setHash;
export function wire(fns) { ({ activateCase, addMsg, fxOut, renderRail, resetPlanPanel, sampleOf, setHash } = fns); }

// ------------------------------------------------------------------ patient flow (start point)
// One modal (#90): new patient on top, existing patients below; a patient opens in place with its scans and an
// upload. The input check is a bar over the 3D (#53), not a screen. Samples sit outside the flow. The alias stays in
// the UI; the chat and tools only see the pseudonymous case id (P0001-S1).
// "patients" = the modal, "patient" = the modal with state.patient open, "check" = the scan in the 3D with the check bar.
function showScreen(name) {
  setHash(name === "patient" ? "#patient=" + state.patient.patient_id : name === "check" ? "#check=" + state.checkCase : "#" + name);
  const check = name === "check";
  // the modal sits over whatever was there: before a case is open that is the start screen, which stays (its
  // class is dropped only by a case opening, leaveStart). The check is the one exception: it shows its scan in
  // the viewer, which the start pane would cover
  if (check) document.body.classList.remove("start");
  else if (!state.activeCase) document.body.classList.add("start");
  if (!check) endCheck();
  $("checkBar").hidden = !check;
  document.body.classList.toggle("checking", check);
  $("caseGate").hidden = check;
  renderRail();
}
// Leave the input check: the bar and the tooth numbers go; the mesh stays until something else loads.
function endCheck() {
  $("checkBar").hidden = true;
  document.body.classList.remove("checking");
  for (const l of state.numLabels) l.parent?.remove(l);
  state.numLabels = [];
}
// Start state (#90): no modal. The work screen itself shows the intro on the left and the sample cards where the
// 3D goes; the conditions, chips, legend and result wait until a case is open.
async function showStart() {
  setHash("#start");
  await loadCases();
  await fxOut(document.body);   // the work screen goes first (style.css body.vanishing), then the start comes over it
  endCheck();
  $("caseGate").hidden = true;
  document.body.classList.remove("vanishing");
  document.body.classList.add("start");
  resize();
  lockComposer(true);
  renderRail();
}
// No case open (start, the patients modal from the start, the input check): the composer stays in place, locked
// (#20: it was hidden by body.no-case since #130; the original way is back)
function lockComposer(on) {
  $("chatInput").disabled = on; $("sendBtn").disabled = on;
  $("chatInput").placeholder = on ? "케이스를 열면 입력할 수 있습니다" : "처방과 우선순위를 적어 주세요";
  document.body.classList.toggle("no-case", on);
}
lockComposer(true);
function leaveStart() {
  document.body.classList.remove("start");
  resize();   // the 3D column just changed width: size the renderer now, not a frame later (no stretched frame, #15)
  lockComposer(false);
  renderRail();
}

// Agent panel width: drag the splitter, arrow keys move it, double click resets. Kept per browser.
const CHAT_MIN = 300, VIEWER_MIN = 420, SIDE_MIN = 320, SIDE_MAX = 640;
const sideWidth = () => document.querySelector(".side").getBoundingClientRect().width;
function setChatWidth(px) {
  const layout = document.querySelector(".layout");
  if (px == null) { layout.style.removeProperty("--chat-w"); localStorage.removeItem("cualign.chatWidth"); return; }
  px = Math.round(Math.max(CHAT_MIN, Math.min(px, layout.clientWidth - 64 - 12 - sideWidth() - VIEWER_MIN)));   // rail, two splitters, sidebar, 3D
  layout.style.setProperty("--chat-w", px + "px");
  localStorage.setItem("cualign.chatWidth", px);
}
// Sidebar width (#14): the same splitter on the sidebar's left; 320–640, the 3D keeps its 420
function setSideWidth(px) {
  const layout = document.querySelector(".layout");
  if (px == null) { layout.style.removeProperty("--side-w"); localStorage.removeItem("cualign.sideWidth"); return; }
  const chat = document.querySelector(".chat").getBoundingClientRect().width;
  px = Math.round(Math.max(SIDE_MIN, Math.min(px, SIDE_MAX, layout.clientWidth - 64 - 12 - chat - VIEWER_MIN)));
  layout.style.setProperty("--side-w", px + "px");
  localStorage.setItem("cualign.sideWidth", px);
}
{
  const sp = $("sideSplitter");
  const saved = +localStorage.getItem("cualign.sideWidth");
  if (saved) setSideWidth(saved);
  sp.addEventListener("pointerdown", (e) => { e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add("dragging"); document.body.classList.add("resizing"); });
  sp.addEventListener("pointermove", (e) => {
    if (!sp.hasPointerCapture(e.pointerId)) return;
    setSideWidth(document.querySelector(".layout").getBoundingClientRect().right - e.clientX - 3);   // the pointer sits on the 6px splitter
  });
  sp.addEventListener("pointerup", (e) => { sp.releasePointerCapture(e.pointerId); sp.classList.remove("dragging"); document.body.classList.remove("resizing"); });
  sp.addEventListener("dblclick", () => setSideWidth(null));
  sp.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setSideWidth(sideWidth() + (e.key === "ArrowLeft" ? 16 : -16));
  });
}
{
  const sp = $("splitter");
  const saved = +localStorage.getItem("cualign.chatWidth");
  if (saved) setChatWidth(saved);
  sp.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sp.setPointerCapture(e.pointerId);
    sp.classList.add("dragging"); document.body.classList.add("resizing");
  });
  sp.addEventListener("pointermove", (e) => {
    if (!sp.hasPointerCapture(e.pointerId)) return;
    setChatWidth(e.clientX - document.querySelector(".layout").getBoundingClientRect().left - 64);   // minus the rail
  });
  sp.addEventListener("pointerup", (e) => {
    sp.releasePointerCapture(e.pointerId);
    sp.classList.remove("dragging"); document.body.classList.remove("resizing");
  });
  sp.addEventListener("dblclick", () => setChatWidth(null));
  sp.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setChatWidth(document.querySelector(".chat").getBoundingClientRect().width + (e.key === "ArrowLeft" ? -16 : 16));
  });
}

// The patient list of the modal. `open` (a GET /api/patients/{id} payload) is shown expanded with its scans.
async function loadPatients(open = null) {
  const { patients } = await api("/api/patients");
  const wrap = $("patientCards"), body = $("patientBody");
  body.hidden = true; $("screenPatients").append(body);   // keep the shared body out of the list being rebuilt
  wrap.innerHTML = "";
  if (!patients.length) wrap.innerHTML = '<p class="empty">등록된 환자가 없습니다.</p>';
  for (const p of patients) {
    const item = document.createElement("div");
    item.className = "patient";
    item.dataset.pid = p.patient_id;
    item.innerHTML = `<button class="p-head" type="button" aria-expanded="false"><span class="alias"></span><span class="pid"></span><span class="meta"></span></button>`;
    item.querySelector(".alias").textContent = p.alias;
    item.querySelector(".pid").textContent = p.patient_id + (p.memo ? " · " + p.memo : "");
    item.querySelector(".meta").textContent = `스캔 ${p.n_scans}개 · 등록 ${fmtDate(p.created_at)}`;
    if (open?.patient_id === p.patient_id) {
      item.classList.add("open");
      item.querySelector(".p-head").setAttribute("aria-expanded", "true");
      renderScans(open);
      item.append(body); body.hidden = false;
    }
    wrap.appendChild(item);
  }
}

function renderScans(p) {
  const list = $("scanList");
  list.innerHTML = "";
  if (!p.scans.length) list.innerHTML = '<p class="empty">아직 스캔이 없습니다.</p>';
  for (const sc of [...p.scans].reverse()) {
    const row = document.createElement("div");
    row.className = "scan-row";
    const ok = sc.confirmed_revision != null && sc.confirmed_revision === (sc.revision ?? 1);   // confirmed this revision
    row.innerHTML = `<span class="sid"></span><span class="meta"></span>
      <button class="btn ghost small" data-act="${ok ? "plan" : "check"}" type="button">열기</button>
      <button class="btn ghost small del" data-act="delete" type="button" title="스캔 삭제">삭제</button>`;
    row.querySelector(".sid").textContent = sc.scan_id + " · 상악";
    row.querySelector(".meta").textContent = `치아 ${sc.teeth.length}개 · ${sc.gingiva ? "잇몸 포함" : "잇몸 없음"} · ${fmtDate(sc.uploaded_at)} · ` +
      `계획 ${sc.plans ?? 0}개` + (ok ? "" : " · 입력 확인 전");
    row.dataset.case = sc.case_id;
    list.appendChild(row);
  }
  $("uploadStatus").textContent = "";
}

async function openPatient(pid) {
  const v = ++state.gateVersion;
  const p = await api("/api/patients/" + encodeURIComponent(pid));
  if (v !== state.gateVersion) return;
  state.patient = p;
  await loadPatients(p);
  if (v !== state.gateVersion) return;
  if (!state.meshCase) $("caseName").textContent = p.alias;
  showScreen("patient");
}

async function uploadScan(files) {
  if (!files?.length || !state.patient) return;
  const fd = new FormData();
  for (const f of files) fd.append("files", f, f.name);
  $("uploadStatus").textContent = `${files.length}개 파일 올리는 중 — 치아를 읽고 있습니다`;
  const pid = state.patient.patient_id;          // the patient this upload belongs to, whatever is on screen later
  try {
    const res = await api("/api/patients/" + encodeURIComponent(pid) + "/scans", { method: "POST", body: fd });
    if (state.patient?.patient_id !== pid) return;   // the dentist moved to another patient meanwhile
    const p = await api("/api/patients/" + encodeURIComponent(pid));   // now lists the new scan
    if (state.patient?.patient_id !== pid) return;
    state.patient = p;
    await openCheck(res.case_id, res.check);
  } catch (e) {
    if (state.patient?.patient_id === pid) showUploadFail(files, e.message);
  }
}
// a 413 can come back without a JSON body (the proxy answers first): the same sentence the server would have sent
const UPLOAD_TOO_BIG = "파일이 너무 큽니다(파일당 60MB, 한 번에 400MB까지).";
function showUploadFail(files, message) {
  const box = $("uploadStatus");
  const names = [...files].map((f) => f.name), shown = names.slice(0, 3).join(", ") + (names.length > 3 ? " …" : "");
  box.innerHTML = '<div class="upload-fail"><span class="files"></span><p class="why"></p><button class="btn ghost small" type="button" data-act="repick">다시 고르기</button></div>';
  box.querySelector(".files").textContent = `올린 파일 · ${names.length}개 (${shown})`;
  box.querySelector(".why").textContent = /^HTTP 413$/.test(message) ? UPLOAD_TOO_BIG : message;
}
$("uploadStatus").addEventListener("click", (e) => { if (e.target.closest("[data-act=repick]")) $("scanInput").click(); });

async function openCheck(caseId, check) {
  const v = ++state.gateVersion;
  $("startPlan").disabled = true;
  const [c, mesh] = await Promise.all([check ?? api("/api/cases/" + encodeURIComponent(caseId) + "/check"),
                                       api(`/api/cases/${encodeURIComponent(caseId)}/mesh`)]);
  if (v !== state.gateVersion) return;          // another scan was opened meanwhile: never mix its mesh and this check
  check = c;
  // mesh, check list and the confirm target change together, only for the latest choice
  state.checkCase = caseId;
  state.checkRevision = check.revision ?? null;
  state.messages = [];            // a conversation belongs to one case; planning restarts from 계획 시작
  $("transcript").innerHTML = "";
  state.meshCase = caseId;
  state.plan = null;
  buildTeeth(mesh);
  resetPlanPanel();
  const rot = check.rotation_deg ?? {}, vert = check.vertical_mm ?? {};
  for (const [id, m] of Object.entries(state.teeth)) {
    if (id in rot) m.material.color.setHex(AMBER);
    else if (id in vert) m.material.color.setHex(BLUE);
  }
  const sid = caseId.split("-")[1] ?? caseId;
  // tooth numbers on the 3D: what the dentist confirms with 이 스캔으로 계획
  for (const l of state.numLabels) l.parent?.remove(l);
  state.numLabels = [];
  for (const [id, m] of Object.entries(state.teeth)) {
    const el = document.createElement("div");
    el.className = "num-label";
    el.textContent = fdi(id);
    const obj = new CSS2DObject(el);
    obj.position.copy(state.center[id]);
    obj.position.z = m.geometry.boundingBox.max.z + 1.5;
    group.add(obj);
    state.numLabels.push(obj);
  }
  // the check facts in one line, in the dentist's words. No 「입력 확인」 label: the case line above already says it.
  // No parentheses: each fact is its own short item
  const o = check.orientation;
  const facts = [[`치아 ${check.n_teeth}개`]];
  if (check.missing.length) facts.push([`빠진 치아 ${check.missing.map(fdi).join(", ")}번`]);
  facts.push([check.scanned_gingiva ? "잇몸 포함" : "잇몸 없음 · 표시용 잇몸"]);
  if (check.outside.length) facts.push([`스캔에 없는 끝 치아 ${check.outside.map(fdi).join(", ")}번`]);
  if (Object.keys(rot).length) facts.push([`회전 보정 ${fdiList(Object.keys(rot))}번 · 주황`]);
  if (Object.keys(vert).length) facts.push([`높이 보정 ${fdiList(Object.keys(vert))}번 · 파랑`]);
  if (o?.basis === "none") facts.push([o.note || `치아 ${check.n_teeth}개 — 방향을 정할 수 없어 입력 방향 그대로 둠`, "warn"]);
  if (o?.side === "reversed") facts.push(["치아 번호가 좌우 반대로 보임", "warn"]);
  if (check.confirmed) facts.push([`번호 확인됨 ${fmtDate(check.confirmed_at)}`]);
  for (const why of check.unsupported) facts.push([why, "bad"]);
  if (check.ready && !check.unsupported.length && o?.basis !== "none" && o?.side !== "reversed") facts.push(["문제 없음"]);
  const box = $("checkFacts");
  box.innerHTML = "";
  facts.forEach(([text, cls], k) => {
    if (k) box.append(" · ");
    const span = document.createElement("span");
    span.textContent = text;
    if (cls) span.className = cls;
    box.append(span);
  });
  $("checkBar").classList.toggle("fail", !check.ready);
  $("mirrorBtn").hidden = o?.side !== "reversed";
  $("startPlan").disabled = !check.ready;
  // the state's title and its one way out: a blocked scan can only be deleted; an unoriented one is planned after
  // the dentist has looked at the numbers (보드 09-a·b·c)
  const title = !check.ready ? "계획할 수 없는 스캔입니다" : o?.basis === "none" ? "방향을 정하지 못했습니다" : "";
  $("checkTitle").textContent = title; $("checkTitle").hidden = !title;
  $("startPlan").hidden = !check.ready;
  $("startPlan").textContent = o?.basis === "none" ? "번호 확인 — 계획 시작" : "이 스캔으로 계획";
  $("deleteScan").hidden = check.ready || !(state.patient && /^P\d{4,}-S\d+$/.test(caseId));
  $("deleteScanPop").hidden = true;
  $("caseName").textContent = (state.patient ? state.patient.alias + " · " : "") + sid + " · 입력 확인 중";
  showScreen("check");
}

// The case head on the panel top: the title and 바꾸기 (#13 polish — the finding and prescription live in the 조건 tab).
function renderCaseCard(caseId, info) {
  const s = sampleOf(caseId);
  $("caseName").textContent = s ? s.title : caseTitle(caseId, info.crowding_mm);
  $("caseName").title = s ? "처방 · " + s.prescription : "";
}
// the sample's short facts (총생 7.9 mm, 발치 …) as small outlined chips
function badgeTags(badges) {
  return (badges ?? []).map((t) => { const c = document.createElement("span"); c.className = "tag"; c.textContent = t; return c; });
}
function caseTitle(caseId, crowding) {
  const sc = state.patient?.scans?.find((x) => x.case_id === caseId);
  return (sc ? `${state.patient.alias} · ${sc.scan_id}` : caseId) + ` · 총생 ${crowding} mm`;
}

// ------------------------------------------------------------------ samples (the start screen, #46)
// Real scans with the dentist's prescription. The synthetic presets stay loadable by name (agent, tests, ?case=)
// but are not offered here.
async function loadCases() {
  const { cases, active } = await api("/api/cases");
  state.cases = cases;
  await loadCaseList();
  return active;
}

// ---- case list (#109, v2 보드 02): every case with a state the server computed; filters by state and kind, a detail
// panel for the chosen row, 「디자인 시작하기」 goes to the check (unconfirmed scan) or the workspace.
const CASE_STATUS = { scan_check: ["스캔 확인 필요", "amber"], plan_needed: ["계획 필요", "faint"], violation: ["위반 있음", "red"],
                      awaiting_approval: ["승인 대기", "green"], approved: ["승인됨", "green"] };
const CASE_KIND = { sample: "샘플", patient: "환자" };
const ORDER_KO = { simultaneous: "동시", anterior_first: "앞니 먼저", sequential: "순차" };
// Universal 1..16 (files, code) → FDI 18..11, 21..28 (what the dentist reads) — the screen shows FDI only (#113)
async function loadCaseList() {
  const { cases } = await api("/api/case-list");
  state.caseList = cases;
  renderCaseList();
}
function renderCaseList() {
  const rows = state.caseList ?? [];
  const samples = rows.filter((c) => c.kind === "sample"), patients = rows.filter((c) => c.kind !== "sample");
  // the detail is one element that lives under the pressed card or row: take it out before the containers are rebuilt
  const detail = $("clDetail");
  const was = !detail.hidden && detail.classList.contains("open") ? { id: detail.dataset.at, kind: detail.dataset.kind } : null;
  document.querySelector(".start-body").append(detail);
  const statusOf = (c) => CASE_STATUS[c.status] ?? [c.status_ko ?? c.status, "faint"];
  // sample cards (#46 → ③, #13 polish): full-width occlusal thumbnail, title, plain-words finding, the short facts as
  // one muted line. No status and no plan count: a sample always starts fresh
  const cards = $("sampleCards");
  cards.innerHTML = "";
  for (const c of samples) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "case-card" + (c.case_id === state.clSelected ? " on" : ""); b.dataset.id = c.case_id;
    b.innerHTML = '<img class="thumb" alt=""><span class="cid"></span><span class="rx"></span><span class="meta"></span>';
    b.querySelector("img").src = `samples/${encodeURIComponent(c.case_id)}.png`; b.querySelector("img").alt = `${c.title} 교합면`;
    b.querySelector(".cid").textContent = c.title;
    b.querySelector(".rx").textContent = c.subtitle ?? "";
    b.querySelector(".meta").textContent = (c.badges ?? []).join(" · ");
    cards.appendChild(b);
  }
  if (!samples.length) cards.innerHTML = '<p class="empty">샘플 파일이 설치되지 않았습니다.</p>';
  // patient rows: one per scan, four columns (환자 · 상태 · 처방 · 대표 계획 — the server's representative plan: latest approved, else latest). Violations and the plan count wait in
  // the detail under the row; the status column already says 위반 있음 / 통과
  const box = $("clRows");
  box.innerHTML = "";
  for (const c of patients) {
    const r = document.createElement("button");
    r.type = "button"; r.className = "cl-row case-row" + (c.case_id === state.clSelected ? " on" : ""); r.dataset.id = c.case_id;
    r.innerHTML = '<span class="c-case"><b></b><small></small></span><span class="c-st"><i class="dot"></i><span></span></span>' +
                  '<span class="c-rx"></span><span class="c-plan"></span>';
    const [label, dot] = statusOf(c);
    r.querySelector(".c-case b").textContent = c.title;
    // the server's subtitle is 「별칭 · S1」: the alias is the title one line up, so only the scan id stays
    const sub = c.subtitle ?? "";
    r.querySelector(".c-case small").textContent = sub.startsWith(c.title + " · ") ? sub.slice(c.title.length + 3) : sub;
    r.querySelector(".c-st .dot").classList.add(dot); r.querySelector(".c-st span").textContent = label;
    r.querySelector(".c-rx").textContent = c.prescription || "조건 기본값";
    r.querySelector(".c-plan").textContent = c.plan ? `${STRATEGY_KO[c.plan.strategy] ?? c.plan.strategy} · ${c.plan.n_stages}장` : "—";
    box.appendChild(r);
  }
  if (!patients.length) box.innerHTML = '<p class="empty">아직 등록한 환자가 없습니다. 위 샘플 케이스로 시작하거나 「새 환자」를 누르세요.</p>';
  // the detail opens right under what was pressed: one element, moved
  const sel = rows.find((c) => c.case_id === state.clSelected) ?? null;
  // a sample: after the card row (the three cards stay on one line, the detail spans under them); a patient: after its row
  const anchorOf = (kind, id) => kind === "sample" ? $("sampleCards").lastElementChild : document.querySelector(`#clRows .case-row[data-id="${CSS.escape(id)}"]`);
  if (sel) {
    anchorOf(sel.kind, sel.case_id)?.after(detail);
    detail.classList.toggle("in-cards", sel.kind === "sample");
    renderCaseDetail(sel);
    // another sample card: same place, the content changes in place; anything else opens from folded
    foldDetail(detail, true, !!was && (was.id === sel.case_id || (was.kind === "sample" && sel.kind === "sample")));
    detail.dataset.at = sel.case_id; detail.dataset.kind = sel.kind;
  } else {
    // folding: back under what it was open under, then run the closing
    const anchor = was && anchorOf(was.kind, was.id);
    if (anchor) anchor.after(detail);
    foldDetail(detail, false, !!anchor);
  }
}
// The detail's open/closed state as a transition: set the old state, make the browser take it (one forced layout, same
// frame), then the new one. Reattaching the element drops its old style, so the old state is set again on purpose.
const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)");
function foldDetail(detail, open, wasOpen) {
  detail.hidden = false;
  detail.classList.toggle("open", wasOpen);
  if (open !== wasOpen && !REDUCE_MOTION.matches) void detail.offsetHeight;
  detail.classList.toggle("open", open);
  if (!open && (!wasOpen || REDUCE_MOTION.matches)) detail.hidden = true;
}
$("clDetail").addEventListener("transitionend", (e) => {
  const d = e.currentTarget;
  if (e.target === d && e.propertyName === "grid-template-rows" && !d.classList.contains("open")) d.hidden = true;
});

function renderCaseDetail(c) {
  const cons = state.cases.find((x) => x.case_id === c.case_id)?.constraints ?? null;
  const extract = new Set(cons?.extraction ?? []), iprOff = new Set((cons?.ipr_exclude ?? []).map(Number));
  // IPR happens between two teeth: a blue line on each contact whose both crowns are allowed. Extraction prescriptions
  // make room by the extraction, not by IPR, so they draw none.
  const iprOn = !extract.size && (cons?.ipr_limit_mm ?? 0) > 0;
  // a prescription names the contacts (#57, Universal pairs); without one the even rule applies to every allowed contact
  const rx = new Set((cons?.ipr_surfaces ?? []).map(([a, b]) => Math.min(a, b) + "-" + Math.max(a, b)));
  const iprAt = (u) => rx.size ? rx.has(u + "-" + (u + 1)) : iprOn && !iprOff.has(u) && !iprOff.has(u + 1);
  // 14 crowns on an arch, FDI 17…11 · 21…27 (Universal 2…15 from the patient's right)
  const svg = $("dArch"); svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  const at = (k) => { const a = Math.PI - (Math.PI * (k + 0.5)) / 14; return [160 + 140 * Math.cos(a), 130 - 118 * Math.sin(a)]; };
  let iprCount = 0;
  for (let k = 0; k < 14; k++) {
    const u = k + 2, [x, y] = at(k);
    if (k < 13 && iprAt(u)) {
      const [x2, y2] = at(k + 1), mx = (x + x2) / 2, my = (y + y2) / 2, nx = -(y2 - y), ny = x2 - x, n = Math.hypot(nx, ny);
      const line = document.createElementNS(ns, "line");   // across the contact, perpendicular to the arch
      line.setAttribute("x1", mx + (nx / n) * 9); line.setAttribute("y1", my + (ny / n) * 9);
      line.setAttribute("x2", mx - (nx / n) * 9); line.setAttribute("y2", my - (ny / n) * 9);
      line.classList.add("ipr"); svg.append(line); iprCount++;
    }
    const circle = document.createElementNS(ns, "circle"); circle.setAttribute("cx", x); circle.setAttribute("cy", y); circle.setAttribute("r", 11);
    if (extract.has(u)) circle.classList.add("extract");
    const t = document.createElementNS(ns, "text"); t.setAttribute("x", x); t.setAttribute("y", y); t.textContent = fdi(u);
    svg.append(circle, t);
  }
  const keys = [extract.size && "빨간 테두리 · 발치 대상", iprCount && "파란 선 · IPR 접촉면"].filter(Boolean);
  if (keys.length) { const l = document.createElementNS(ns, "text"); l.setAttribute("x", 160); l.setAttribute("y", 142); l.classList.add("key"); l.textContent = keys.join(" · "); svg.append(l); }
  // the scan in one line. A sample's 총생 is already on its card (.meta) so it is not repeated here; a patient row has
  // no 총생 column, so the detail carries it, with the plan count and the violations the table leaves out
  const patient = c.kind === "patient";
  const facts = [c.n_teeth != null ? `치아 ${c.n_teeth}개` : null,
                 patient && c.crowding_mm != null ? `총생 ${c.crowding_mm} mm` : null];
  if (patient) facts.push(c.confirmed ? "번호 확인됨" : "번호 확인 전");
  if (patient && c.n_plans) facts.push(`계획 ${c.n_plans}개`, c.plan?.violations ? `위반 ${c.plan.violations}건` : "위반 없음");
  if (c.unsupported?.length) facts.push("계획 불가 · " + c.unsupported[0]);
  $("dFacts").textContent = facts.filter(Boolean).join(" · ");
  // the prescription sentence: a sample shows it here (its card has only the finding); a patient row already has the
  // 처방 column right above, so the block is hidden
  $("dRxLabel").hidden = $("dRx").hidden = patient;
  $("dRx").textContent = c.prescription || "처방 없음 · 조건 기본값";
  $("dReason").textContent = c.reason ?? "";   // samples only; :empty hides the line
  // chips only for what differs from the prescription (a patient: from the defaults); 비발치 repeats the sentence, IPR
  // exclusions are the grey dots above
  const base = sampleOf(c.case_id)?.constraints ?? { extraction: [], lock: [], ipr_exclude: [], ipr_limit_mm: 0.25, stage_cap: null, order: "simultaneous" };
  const differs = (k) => JSON.stringify(cons?.[k] ?? null) !== JSON.stringify(base[k] ?? null);
  const chips = [];
  if (cons) {
    if (differs("extraction") && extract.size) chips.push("발치 " + fdiList([...extract]));
    if (differs("lock") && cons.lock?.length) chips.push("고정 " + fdiList(cons.lock));
    if (differs("ipr_limit_mm")) chips.push(`IPR 면당 ${cons.ipr_limit_mm} mm`);
    if (differs("stage_cap") && cons.stage_cap) chips.push(`단계 상한 ${cons.stage_cap}`);
    if (differs("order") && cons.order && cons.order !== "simultaneous") chips.push("이동 " + (ORDER_KO[cons.order] ?? cons.order));
  }
  $("dChips").textContent = chips.join(" · ");   // one muted line, not outlined chips
  $("dOpen").textContent = c.kind === "patient" && !c.confirmed ? "입력 확인 열기" : "디자인 시작하기";
}
async function openFromList(c) {
  if (!c || state.streaming || state.loading) return;
  document.body.classList.add("leaving");
  try {
    if (c.kind === "patient") {
      state.patient = await api("/api/patients/" + encodeURIComponent(c.patient.patient_id));
      if (!c.confirmed) { await openCheck(c.case_id); return; }
    } else state.patient = null;
    await activateCase(c.case_id);
  } catch (err) { addMsg("error", `케이스 로드 실패: ${err.message}`); }
  finally { document.body.classList.remove("leaving"); }
}

export { REDUCE_MOTION, badgeTags, endCheck, leaveStart, loadCases, loadPatients, openCheck, openFromList,
  openPatient, renderCaseCard, renderCaseList, showScreen, showStart, uploadScan };
