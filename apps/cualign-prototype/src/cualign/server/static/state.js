// app.js 에서 나눈 모듈: the screen's shared state, the FDI ↔ Universal helpers, api(), the 조건 form's field readers
// and the label tables. Imports nothing.

const $ = (id) => document.getElementById(id);
// 직접 이동 (manual.js): created once the screen's functions exist (end of file); until then nothing is being edited
let manualEdit = { active: false, open() {}, leave() { return false; }, drop() {} };
const isManualTarget = () => state.target?.info?.source === "manual";
// FDI ↔ Universal (upper arch only, #113): the dentist reads and writes FDI on screen; the core, planner and API
// keep Universal. Convert at the screen boundary only — never show Universal alongside FDI (decision 2026-09-27).
const fdi = (u) => { u = Number(u); return u <= 8 ? 19 - u : 12 + u; };
const universal = (f) => { f = Number(f); return f <= 18 ? 19 - f : f - 12; };
const fdiList = (ids) => [...(ids ?? [])].map(fdi).join("·");

// ------------------------------------------------------------------ state
const state = {
  messages: [],          // full transcript sent to /chat/stream
  streaming: false,
  step: "initial",       // the step on screen: initial · setup · target · stages (#15)
  progress: "initial",   // the furthest step the agent has finished (#20): the strip only opens up to here
  setup: null,           // step_done setup: the constraints the agent read from the prescription
  setupRed: false,       // the extracted crowns flash red right after the setup lands, then they go
  target: null, targetId: null,   // step_done target: GET /api/cases/{id}/targets/{target_id}, plan-shaped with one stage
  caseInfo: null,        // /activate payload: the scan facts on the 스캔 tab
  skippedPlans: new Set(),   // plans adopted with 건너뛰기: the card says 건너뜀 instead of a review state (#15)
  abort: null, skippedTurn: null,
  stlBusy: null,         // the plan id whose STL zip a download is waiting for (#119)
  exportPopFor: null,    // "plan id|step" the open export confirm card is about; null when closed
  exportStatus: {},      // plan id -> GET /api/plans/{id}/export-status: {building, done, total, ready, stl?, error?}
  meshCase: null,        // case_id currently loaded in the viewer
  activeCase: null,      // case_id being planned (the input-check screen can show another scan in the viewer)
  cases: [],             // /api/cases rows
  teeth: {},             // tooth_id -> THREE.Mesh
  center: {},            // tooth_id -> rest centroid (THREE.Vector3)
  archOrder: [],         // tooth ids along the arch (for IPR contact labels)
  cutSets: {},           // IPR-cut crowns per source (#22): "plan:<id>" / "target:<id>" → {tooth: {geo, faces, mm}}; cutKeyNow() picks
  plan: null,            // GET /api/plans/{id} payload
  stage: 0,
  playing: null,         // interval handle
  loading: false,
  selectionVersion: 0,
  requestId: null,
  lastAssistantText: "",
  trace: null,           // inline tool-call trace for the turn in progress
  patient: null,         // GET /api/patients/{id} payload of the patient on screen
  caseList: [], clSelected: null, clPreset: false,   // 케이스 목록 (#109): 샘플 카드 + 환자 표, 선택한 것 아래 상세 (③-b)
  checkCase: null,       // case id shown on the input-check screen
  checkRevision: null,   // scan revision shown there; the confirmation names it
  gateVersion: 0,        // bumped on every patient/scan navigation: a late response for an earlier choice is dropped
  lastRequest: null,     // {text, constraints} of the last /chat/stream request, replayed by 다시 보내기 (#51)
  selected: new Set(),   // teeth the dentist clicked in the 3D; named in the next chat message (#90)
  ruleMarked: new Set(), // of those, the ones a 규칙 tab violation lit: highlighted in the 3D, never sent with a message
  openTries: new Set(),  // plan cards whose 「시도한 전략」 fold the dentist opened (kept over a re-render)
  overlay: false,        // 전후 겹쳐 보기: the untreated arch drawn as a white ghost (#90)
  violLabels: [],        // CSS2DObject collision labels of the stage on screen
  numLabels: [],         // CSS2DObject tooth numbers shown during the input check
  planRows: {},          // plan_id -> /api/plans row of the case on screen (the decision bar names plans by these)
  planRowsCase: null,
  reviewSeen: {},        // plan id → the review status its card last showed (running → passed/failed lights the card)
  reviewLand: {},        // plan id → { ok, t }: a review this screen watched land; its badge keeps the check / X
  reviewPending: new Set(),   // plans whose review ran in this turn before their card existed
  newPlans: 0,           // plans added by the last refreshPlans: more than one means the turn compared strategies
  oldPlans: new Set(),   // plans that already existed when the case was opened: folded as 지난 계획 (#105, #111)
  tab: "stages",         // the open sidebar tab: stages | rules | cond (#111)
  tabPin: null,          // {caseId, step} when the dentist picked a tab by hand: the step flow leaves it until the next step
  planError: null,       // the server's sentence when a case has no plan and the calculation failed (#112)
  stageTouched: false,   // the dentist moved the stage (slider, ends, play, a stage row or violation) since the turn began: the new plan does not jump to its end
};

// ------------------------------------------------------------------ API helpers
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.detail || ("HTTP " + r.status)); }
  return r.json();
}


// FDI valid range on this upper-arch-only app (Universal 2..15, third molars excluded): quadrant 1 11..17, quadrant 2 21..27.
const isFdiTooth = (f) => (f >= 11 && f <= 17) || (f >= 21 && f <= 27);
// IPR per contact (#57): constraints/plans carry Universal [a, b, mm]; the dentist reads and types FDI 「12-11 0.4」
const surfacesKo = (s) => (s ?? []).map(([a, b, mm]) => `${fdi(a)}-${fdi(b)} ${+mm}`).join(", ");
function parseSurfaces(raw) {   // 「12-11 0.4, 11-21 0.4」 → [[12, 11, 0.4], …] (FDI, as the patch takes it); "" → []
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d{2})\s*[-–~]\s*(\d{2})\s+([\d.]+)\s*(?:mm)?$/i);
    if (!m || !isFdiTooth(+m[1]) || !isFdiTooth(+m[2]) || !(+m[3] > 0)) throw new Error("IPR 처방은 「12-11 0.4, 11-21 0.4」 처럼 접촉면(FDI 두 치아)과 mm 로 적어 주세요.");
    return [+m[1], +m[2], +m[3]];
  });
}
// the same list whichever numbering and order it came in, for comparing (Universal, a < b, sorted)
const normSurfaces = (s, fromFdi = false) => (s ?? []).map(([a, b, mm]) => { if (fromFdi) { a = universal(a); b = universal(b); } return [Math.min(a, b), Math.max(a, b), +mm]; }).sort((x, y) => x[0] - y[0]);
// the contacts a target/plan strips: target.ipr_surfaces (info.ipr_surfaces on older plans), Universal
const surfacesOf = (t, info) => t?.ipr_surfaces ?? info?.ipr_surfaces ?? [];
// one reader per form field; each throws its own sentence, which the 조건 tab shows under that field
const FIELD_READ = {
  cExtract: () => {
    const ids = FIELD_READ.teeth("cExtract");
    if ($("cAllowExt").checked && !ids.length) throw new Error("발치를 허용했으면 발치 치아를 적어 주세요 (FDI).");
    return ids;
  },
  cLock: () => FIELD_READ.teeth("cLock"),
  cExclude: () => FIELD_READ.teeth("cExclude"),
  cSurf: () => parseSurfaces($("cSurf").value),
  cIpr: () => {
    const ipr = Number($("cIpr").value);
    if ($("cIpr").value === "" || !Number.isFinite(ipr) || ipr < 0 || ipr > 0.25) throw new Error("면당 IPR은 0~0.25 mm입니다.");
    return ipr;
  },
  cCap: () => {
    const cap = $("cCap").value === "" ? null : Number($("cCap").value);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) throw new Error("장수 상한은 1 이상의 정수입니다.");
    return cap;
  },
  teeth: (id) => {
    const raw = $(id).value.trim();
    const values = raw ? raw.split(/[ ,]+/).map(Number) : [];
    if (values.some(v => !Number.isInteger(v) || !isFdiTooth(v))) throw new Error("치아 번호는 FDI로 입력하세요 (11~17, 21~27).");
    return [...new Set(values.map(universal))].sort((a,b) => a-b);
  },
};
function fieldErrors() {
  const errs = {};
  for (const id of ["cExtract", "cLock", "cSurf", "cExclude", "cIpr", "cCap"]) try { FIELD_READ[id](); } catch (e) { errs[id] = e.message; }
  return errs;
}
// 기간(개월) ↔ 단계 상한: the same formula as the server's limits.py (30.4 days a month, 14 days an aligner)
const capOfMonths = (m) => Math.round((m * 30.4) / 14);
const monthsOfCap = (cap) => Math.round(((cap * 14) / 30.4) * 10) / 10;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";   // server sends UTC (+00:00); show the viewer's local time
const RULE_KO = { collision: "충돌", move_limit: "장당 이동 한계", stage_cap: "장수 상한", space_deficit: "공간 부족",
  extraction_mismatch: "발치 처방 불일치", extraction_space_open: "발치 공간 미폐쇄", ipr_unprescribed: "처방에 없는 IPR",
  // the kinds main had no word for, in v2's vocabulary (sidebar.js)
  rotation_limit: "회전 한도 초과", locked_tooth: "고정 치아 이동", extraction_forbidden: "비발치 규칙 위반",
  ipr_limit: "IPR 한도 초과", ipr_excluded: "IPR 제외 치아 절제" };
const REVIEW_KO = { passed: "검토 통과", failed: "검토 실패", running: "검토 중" };   // not_requested · skipped: 검토 전
const STRATEGY_KO = { expansion: "확장", ipr: "IPR", expansion_ipr: "확장 + IPR", extraction: "발치", manual: "수동 배치" };

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// app.js sets it once the screen's functions exist (an imported binding is read-only in the other modules)
function setManualEdit(m) { manualEdit = m; }

export { $, FIELD_READ, REVIEW_KO, RULE_KO, STRATEGY_KO, api, capOfMonths, esc, fdi, fdiList, fieldErrors, fmtDate,
  isManualTarget, manualEdit, monthsOfCap, normSurfaces, setManualEdit, state, surfacesKo, surfacesOf, universal };
