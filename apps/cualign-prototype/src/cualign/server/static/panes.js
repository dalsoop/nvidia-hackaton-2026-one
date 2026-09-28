// app.js 에서 나눈 모듈: the plan on screen and the sidebar's panes — result, legend, 단계 · 규칙 · 조건 tabs, the tab
// switch, the 스캔 tab's tooth chart.
import { $, REVIEW_KO, RULE_KO, STRATEGY_KO, esc, fdi, fdiList, fmtDate, state, surfacesKo, surfacesOf, universal } from "./state.js";
import { applyStage, scanFx, setStep, stepIndex } from "./viewer.js";
import { renderSelection } from "./pick.js";
import { readConstraints, renderCondState, updateActions } from "./conditions.js";
import { planNo, renderPlanList, sampleOf } from "./plans.js";
import { addMsg, splitNote } from "./chat.js";
import { runFallback, send, stopPlay, togglePlay } from "./turns.js";

// ------------------------------------------------------------------ plan on screen: cards, review line, sidebar (#111)
function renderResult(plan) {
  // the /api/plans row of this plan follows what the detail says (approval, review), so the card is right at once
  const row = state.planRows[plan.plan_id];
  if (row) Object.assign(row, { passed: plan.passed, violations: (plan.violations ?? []).length, approval: plan.approval, input_stale: plan.input_stale, review: plan.review });
  renderPlanList();
  const review = plan.review ?? {};
  const memo = splitNote((review.message ?? "") + (review.error ? " (" + review.error + ")" : ""));
  $("reviewMemo").innerHTML = esc(memo.body.trim()) + (memo.note ? `<small class="note">${esc(memo.note)}</small>` : "");
  if (plan.approval) $("reviewMemo").prepend(Object.assign(document.createElement("div"), { textContent: "승인됨 · " + fmtDate(plan.approval.approved_at) }));
  // the 규칙 tab's fold under the verdict: a memo, an approval (승인 취소) or a failed review (검토 다시 요청); open
  // on a failed review or when every allowed strategy broke a rule, else folded; nothing of those, no line
  $("reviewLine").textContent = memo.body.trim() ? "검토 메모" : "검토";
  const fold = $("planReview"), failed = review.status === "failed" || !!plan.rule_run?.all_failed;
  fold.hidden = !memo.body.trim() && !plan.approval && review.status !== "failed";
  if (failed) fold.open = true; else if (fold.dataset.plan !== plan.plan_id) fold.open = false;   // another plan starts folded
  fold.dataset.plan = plan.plan_id;
  renderSide(plan);
  renderLegend(plan);
}
// the 3D legend shows only what this plan has (#13 polish); 선택한 치아 appears once a tooth was picked
function renderLegend(plan) {
  const viol = plan?.violations ?? [], t = plan?.target ?? {};
  const show = { collision: viol.some((v) => v.type === "collision"), move_limit: viol.some((v) => v.type === "move_limit"),
                 locked: (t.locked ?? []).length > 0 };
  for (const el of document.querySelectorAll(".legend [data-key]")) el.hidden = !show[el.dataset.key];
  $("pickedLegend").hidden = !state.pickedOnce;
}

// ---- the sidebar's three panes read the plan on screen; null empties them
function renderSide(plan) {
  renderStagePane(plan);
  renderRulesPane(rulesPlan(plan));
  renderCondPane(plan);
}
// 목표 checks the target the target turn made (space, prescribed IPR); the stage rules wait for the plan
const rulesPlan = (plan) => (state.step === "target" && state.target ? state.target : plan);
function renderStagePane(plan) {
  const facts = $("stageFacts"), grid = $("stageGrid");
  facts.innerHTML = ""; grid.innerHTML = "";
  if (!plan) { for (const el of document.querySelectorAll(".grid-legend [data-kind]")) el.hidden = true; return; }
  const n = plan.stages?.length ?? 0, t = plan.target ?? {}, info = plan.info ?? {};
  // two lines (#13 polish): 「확장 · 9단계 · 약 4.1개월」 / 「총생 1.6 mm → 확보 2.1 mm」; the movement notes are on the 규칙 tab
  const l1 = document.createElement("span"); l1.className = "l1";
  l1.textContent = [STRATEGY_KO[plan.strategy] ?? plan.strategy, `${n}단계`, info.months != null ? `약 ${info.months}개월` : null].filter(Boolean).join(" · ");
  const l2 = document.createElement("span"); l2.className = "l2";
  l2.textContent = t.crowding_mm != null ? `총생 ${t.crowding_mm} mm → 확보 ${t.space_gain_mm ?? "—"} mm` : "";
  facts.append(l1, l2);
  // the table: one row per stage, one column per tooth along the arch; a cell says what kind of move the stage adds.
  // A tooth that never moves keeps its column, blank (#13 polish)
  const teeth = (state.archOrder.length ? state.archOrder : Object.keys(state.teeth)).map(String);
  // sequencing (#144): the aligner the delayed crowns start in splits the table; those crowns wait in place before it
  const boundary = info.phase_boundary ?? 0, delays = info.delays ?? {};
  const at = (k, id) => (k > 0 ? plan.stages[k - 1]?.[id] : null) ?? [0, 0, 0];
  const yaw = (k, id) => (k > 0 ? plan.rotations?.[k - 1]?.[id] : null) ?? 0;
  const bad = {};
  for (const v of plan.violations ?? []) if (v.stage != null) for (const id of v.teeth ?? []) (bad[v.stage] ??= {})[String(id)] = v.type;
  const cells = {};   // [k][id] → { kinds, title }
  const moving = new Set(), used = new Set();
  for (let k = 1; k <= n; k++) for (const id of teeth) {
    const a = at(k - 1, id), b = at(k, id);
    const dxy = Math.hypot(b[0] - a[0], b[1] - a[1]), dz = Math.abs(b[2] - a[2]), dr = Math.abs(yaw(k, id) - yaw(k - 1, id));
    const kinds = [dxy > 0.02 && "move", dz > 0.02 && "vert", dr > 0.5 && "rot"].filter(Boolean);
    const parts = [dxy > 0.02 && `수평 ${dxy.toFixed(2)}mm`, dz > 0.02 && `수직 ${(b[2] - a[2]).toFixed(2)}mm`, dr > 0.5 && `회전 ${(yaw(k, id) - yaw(k - 1, id)).toFixed(1)}°`].filter(Boolean);
    (cells[k] ??= {})[id] = { kinds, title: `단계 ${k} · 치아 ${fdi(id)}` + (parts.length ? " · " + parts.join(" · ") : " · 이동 없음") + (bad[k]?.[id] ? " · " + RULE_KO[bad[k][id]] : "") };
    if (kinds.length || bad[k]?.[id]) moving.add(id);
    if (kinds.length) used.add(kinds.length > 1 ? "mixed" : kinds[0]);
    if (bad[k]?.[id] === "collision") used.add("coll");
  }
  for (const el of document.querySelectorAll(".grid-legend [data-kind]")) el.hidden = !used.has(el.dataset.kind);
  grid.style.gridTemplateColumns = `26px repeat(${teeth.length}, minmax(0, 1fr))`;
  const hd = document.createElement("span"); hd.className = "hd"; grid.append(hd);
  for (const id of teeth) { const h = document.createElement("span"); h.className = "hd" + (moving.has(id) ? "" : " nil"); h.textContent = fdi(id); grid.append(h); }
  for (let k = 0; k <= n; k++) {
    if (boundary > 0 && k === boundary) {   // a thin rule with the two phases named, between the last aligning and the first closing aligner
      const ph = document.createElement("div"); ph.className = "phase"; ph.dataset.boundary = boundary;
      ph.innerHTML = '<span class="a"></span><i></i><span class="b"></span>';
      ph.querySelector(".a").textContent = `먼저 이동 1–${boundary - 1}`; ph.querySelector(".b").textContent = `뒤따라 이동 ${boundary}–${n}`;
      grid.append(ph);
    }
    const row = document.createElement("div"); row.className = "row" + (k === state.stage ? " cur" : ""); row.dataset.stage = k;
    const kk = document.createElement("span"); kk.className = "k"; kk.textContent = k; row.append(kk);
    for (const id of teeth) {
      const c = document.createElement("span"); c.className = "c" + (moving.has(id) ? "" : " nil");
      const start = delays[id];
      if (start && k > 0 && k < start) { c.classList.add("wait"); c.title = `단계 ${k} · 치아 ${fdi(id)} · 제자리 (단계 ${start}부터 움직임)`; }
      const x = cells[k]?.[id];
      if (x) {
        if (x.kinds.length > 1) c.classList.add("mixed"); else if (x.kinds.length) c.classList.add(x.kinds[0]);
        if (bad[k]?.[id]) c.classList.add(bad[k][id] === "collision" ? "coll" : "warn");
        c.title = x.title;
      }
      row.append(c);
    }
    grid.append(row);
  }
}
function renderRulesPane(plan) {
  const cards = $("ruleCards"), groups = $("violGroups");
  cards.innerHTML = ""; groups.innerHTML = "";
  const pre = !!plan && !plan.plan_id;   // a target (GET /targets): no stages yet, nothing validated
  $("rulesFor").textContent = !plan ? "" : pre ? `목표 배열 · ${STRATEGY_KO[plan.strategy] ?? plan.strategy} · 단계 계획 전`
    : `계획 ${planNo(plan.plan_id)} · ${STRATEGY_KO[plan.strategy] ?? plan.strategy} · ${plan.stages?.length ?? 0}장`;
  // the planner's movement notes (from the 단계 표 head, #13 polish); they name Universal ids: 「치아 13 회전 …」 → FDI
  // …and a Universal list like [5, 12] → 14·24 until the server writes FDI itself (temporary, #14)
  const toFdi = (s) => s.replace(/치아 (\d+)/g, (_, u) => `치아 ${fdi(u)}`)
    .replace(/\[(\d{1,2}(?:,\s*\d{1,2})*)\]/g, (m, list) => { const ids = list.split(/,\s*/).map(Number); return ids.every((u) => u >= 1 && u <= 16) ? fdiList(ids) : m; });
  $("ruleNotes").textContent = plan ? (plan.target?.notes ?? []).map(toFdi).join(" · ") : "";
  const verdict = $("ruleVerdict");
  verdict.querySelector("b").textContent = ""; verdict.querySelector("span").textContent = "";
  if (!plan) return;
  const viol = plan.violations ?? [], by = (t) => viol.filter((v) => v.type === t);
  // at a glance: 규칙 통과 · 검토 통과 big, or the violation count; a rule plan whose every allowed strategy failed says
  // so from the run the server stored with it (rule_run, kept over a reload), with what was tried and which plan this is
  const allFailed = plan.rule_run?.all_failed ? plan.rule_run : null;
  verdict.classList.toggle("fail", viol.length > 0 || (pre && +(plan.target?.space_deficit_mm ?? 0) > 0));
  if (pre) { verdict.querySelector("b").textContent = "목표 배열 점검"; verdict.querySelector("span").textContent = "공간만 봅니다 · 단계 규칙은 단계를 만든 뒤 검증"; }
  else verdict.querySelector("b").textContent = allFailed ? "허용 전략 전부 규칙 위반"
    : viol.length ? `규칙 위반 ${viol.length}건` : `규칙 통과 · ${REVIEW_KO[plan.review?.status] ?? "검토 전"}`;
  if (!pre) verdict.querySelector("span").textContent = allFailed
    ? `시도한 전략 ${(allFailed.tried ?? []).map((s) => STRATEGY_KO[s] ?? s).join(" · ")} — ${allFailed.chosen_plan_id === plan.plan_id ? "가장 덜 틀린 " : "그중 "}${STRATEGY_KO[plan.strategy] ?? plan.strategy} 계획의 위반을 아래에 보입니다. 조건을 바꿔 다시 계산하세요.`
    : viol.length ? "아래 위반 항목을 누르면 그 단계로 가서 치아를 강조합니다." : "검사한 규칙";
  const coll = by("collision"), mv = by("move_limit"), cap = by("stage_cap"), sp = by("space_deficit");
  const maxOf = (arr, key) => arr.length ? Math.max(...arr.map((v) => +v[key] || 0)) : 0;
  const later = ["", "", "단계 계획 후 검증"], deficit = +(plan.target?.space_deficit_mm ?? 0);
  const rules = pre ? [
    ["충돌", "인접 치아 겹침이 치료 전 기준 이하", later],
    ["장당 이동 한계", "장마다 이동량이 한계 이하", later],
    ["장수 상한", "조건에 정한 최대 장수", later],
    ["공간 부족", "처방 안에서 확보할 공간", deficit > 0 ? ["부족", "fail", `${deficit} mm 부족`] : ["통과", "pass", "부족 0 mm"]],
  ] : [
    ["충돌", "인접 치아 겹침이 치료 전 기준 이하", coll.length ? ["위반", "fail", `${coll.length}건 · 최대 ${maxOf(coll, "overlap_mm3")} mm³`] : ["통과", "pass", "겹침 기준 이하"]],
    ["장당 이동 한계", "장마다 이동량이 한계 이하", mv.length ? ["위반", "fail", `${mv.length}건 · 최대 ${maxOf(mv, "mm")} mm`] : ["통과", "pass", plan.info?.per_stage_mm != null ? `장당 ${plan.info.per_stage_mm} mm` : ""]],
    ["장수 상한", cap.length ? `장당 이동 한계로 ${cap[0].n}장이 필요 — 상한 안에 넣으려면 이동량(처방)을 줄여야 함` : "조건에 정한 최대 장수", plan.constraints?.stage_cap == null ? ["", "", "상한 없음"] : cap.length ? ["위반", "fail", `${cap[0].n}장 > 상한 ${cap[0].limit}`] : ["통과", "pass", `${plan.stages?.length ?? 0}장 ≤ 상한 ${plan.constraints.stage_cap}`]],
    ["공간 부족", "처방 안에서 확보할 공간", sp.length ? ["위반", "fail", `${sp[0].mm} mm 부족 (허용 ${sp[0].limit})`] : ["통과", "pass", `부족 ${plan.target?.space_deficit_mm ?? 0} mm`]],
  ];
  if (plan.constraints?.ipr_surfaces?.length) {   // IPR prescribed per contact (#57): only those contacts, only that much
    const unp = by("ipr_unprescribed");
    rules.push(["처방에 없는 IPR", "처방한 접촉면에만 처방한 양만큼", unp.length ? ["위반", "fail", surfacesKo(unp[0].surfaces).replace(/, /g, " · ")]
      : ["통과", "pass", `처방 ${plan.constraints.ipr_surfaces.length}면`]]);
  }
  for (const v of viol.filter((x) => x.type.startsWith("extraction")))
    rules.push([RULE_KO[v.type], "발치 처방과 계획이 맞는지", ["위반", "fail", v.type === "extraction_mismatch"
      ? `처방 ${fdiList(v.prescribed) || "없음"} · 뺀 치아 ${fdiList(v.removed) || "없음"}` : `닫지 못한 공간 ${v.mm} mm`]]);
  for (const [name, why, [st, cls, detail]] of rules) {
    const d = document.createElement("div"); d.className = "rule";
    d.innerHTML = `<div><span class="name"></span><span class="why"></span></div><div class="st"><span class="mark"></span><span class="detail"></span></div>`;
    d.querySelector(".name").textContent = name; d.querySelector(".why").textContent = why;
    const mark = d.querySelector(".mark");
    if (cls === "fail") { mark.className = "pill fail"; mark.textContent = st; }                                   // a violation is the only badge
    else if (cls === "pass") { mark.className = "mark ok"; mark.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg>'; mark.title = st; d.classList.add("passed"); }
    else { mark.className = "mark na"; mark.textContent = st; }
    d.querySelector(".detail").textContent = detail;
    cards.append(d);
  }
  // violations grouped by kind (충돌, 장당 이동 한계 …); each kind names its 발생 단계, then one item per tooth or pair.
  // An item jumps the slider to its first stage and selects its teeth in the 3D; a stage button jumps to that stage
  if (!viol.length) { groups.innerHTML = `<p class="empty">${pre ? "단계를 만든 뒤 확인" : "위반 없음"}</p>`; return; }
  const byType = new Map();
  for (const v of viol) {
    const items = byType.get(v.type) ?? byType.set(v.type, new Map()).get(v.type);
    const key = [...(v.teeth ?? [])].sort((a, b) => a - b).join(",");
    (items.get(key) ?? items.set(key, []).get(key)).push(v);
  }
  const span = (ks) => !ks.length ? "" : ks.length > 2 && ks.at(-1) - ks[0] === ks.length - 1 ? `${ks[0]}–${ks.at(-1)}` : ks.join(", ");
  for (const [type, items] of byType) {
    const all = [...items.values()].flat(), stages = [...new Set(all.filter((v) => v.stage != null).map((v) => v.stage))].sort((a, b) => a - b);
    const g = document.createElement("div"); g.className = "vg" + (type === "collision" ? "" : " warn"); g.dataset.type = type;
    g.innerHTML = `<div class="t"><b></b><span></span></div><div class="when"></div>`;
    g.querySelector("b").textContent = RULE_KO[type] ?? type;
    g.querySelector(".t span").textContent = `${all.length}건`;
    g.querySelector(".when").textContent = stages.length ? `발생 단계: ${span(stages)}` : "발생 단계: 계획 전체";
    for (const list of items.values()) {
      const v0 = list[0], teeth = [...(v0.teeth ?? [])].sort((a, b) => fdi(a) - fdi(b));
      const ks = [...new Set(list.filter((v) => v.stage != null).map((v) => v.stage))].sort((a, b) => a - b);
      const it = document.createElement("div"); it.className = "vi";
      it.innerHTML = `<button class="go" type="button"></button><div class="trend"></div><div class="stages"></div>`;
      const go = it.querySelector(".go");
      go.textContent = (teeth.length ? `치아 ${fdiList(teeth)}` : "계획 전체") + (ks.length ? ` · 단계 ${span(ks)}` : "");
      go.dataset.teeth = teeth.join(",");
      if (ks.length) go.dataset.stage = ks[0]; else go.disabled = go.hidden = !teeth.length;   // 공간 부족 · 장수 상한: the amount alone
      go.title = ks.length ? `단계 ${ks[0]}로 이동하고 ${teeth.length ? "치아를 선택" : ""}` : teeth.length ? "치아 선택" : "";
      it.querySelector(".trend").textContent = violAmount(v0.type, list);
      for (const k of ks) {
        const b = document.createElement("button"); b.type = "button"; b.dataset.stage = k; b.dataset.teeth = go.dataset.teeth;
        b.textContent = k; b.title = `단계 ${k}로 이동`; b.className = k === state.stage ? "cur" : ""; it.querySelector(".stages").append(b);
      }
      g.append(it);
    }
    groups.append(g);
  }
}
// an item's amount in words: the course over its stages for a collision / a move, the one number otherwise
function violAmount(type, list) {
  const v0 = list[0];
  if (type === "collision" || type === "move_limit" || type === "rotation_limit") {
    const key = type === "collision" ? "overlap_mm3" : type === "rotation_limit" ? "deg" : "mm";
    const unit = type === "collision" ? "mm³" : type === "rotation_limit" ? "°" : "mm";
    const vals = list.map((v) => +v[key]).filter(Number.isFinite);
    if (!vals.length) return "";
    const course = vals.length > 2 ? [vals[0], Math.max(...vals), vals.at(-1)] : vals;
    return `${type === "collision" ? "겹침" : type === "rotation_limit" ? "회전" : "이동"} ${course.join(" → ")} ${unit}`
      + (v0.baseline != null ? ` · 기준 ${v0.baseline}` : v0.limit != null ? ` · 한계 ${v0.limit}` : "");
  }
  if (type === "space_deficit") return `${v0.mm} mm 부족 (허용 ${v0.limit})`;
  if (type === "stage_cap") return `${v0.n}장 > 상한 ${v0.limit}`;
  if (type === "extraction_mismatch") return `처방 ${fdiList(v0.prescribed) || "없음"} · 뺀 치아 ${fdiList(v0.removed) || "없음"}`;
  if (type === "extraction_space_open") return `닫지 못한 공간 ${v0.mm} mm`;
  if (type === "ipr_unprescribed") return surfacesKo(v0.surfaces).replace(/, /g, " · ");
  return v0.mm != null ? `${v0.mm} mm` + (v0.limit != null ? ` · 한도 ${v0.limit}` : "") : "";
}
function renderCondPane(plan) {
  const sample = sampleOf(state.meshCase);
  $("condRx").textContent = sample ? sample.prescription : state.meshCase ? "처방은 대화로 입력합니다" : "";
  $("condRxNote").textContent = sample?.note ?? "";
  renderCondState();
}
// the stage on screen: the table's row and the violation groups' stage buttons follow the slider
function markStage(k) {
  for (const r of $("stageGrid").querySelectorAll(".row")) r.classList.toggle("cur", +r.dataset.stage === k);
  for (const b of $("violGroups").querySelectorAll("button[data-stage]")) b.classList.toggle("cur", +b.dataset.stage === k);
}
const PANES = { scan: "paneScan", stages: "paneStages", rules: "paneRules", cond: "paneCond", move: "paneMove" };
// A tab change, by hand or by the step: the pane going out fades 120 ms (kept over the panel as .leaving under
// #side.tab-leaving, already [hidden] for the code), the one coming in fades in 180 ms rising 6 px after it, the underline slides to the tab
// (--tab-i). Reduced motion: at once.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let paneLeaving = null;
function showTab(name) {
  state.tab = name;
  const tabs = [...document.querySelectorAll(".side-tab")];
  for (const b of tabs) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  document.querySelector(".side-tabs").style.setProperty("--tab-i", String(Math.max(0, tabs.findIndex((b) => b.dataset.tab === name))));
  if (paneLeaving) { clearTimeout(paneLeaving.timer); paneLeaving.pane.classList.remove("leaving"); $("side").classList.remove("tab-leaving"); paneLeaving = null; }
  const out = Object.entries(PANES).find(([tab, id]) => tab !== name && !$(id).hidden)?.[1];
  if (out && !reducedMotion.matches) {
    const pane = $(out);
    $("side").style.setProperty("--pane-top", pane.offsetTop + "px");
    pane.classList.add("leaving"); $("side").classList.add("tab-leaving");
    paneLeaving = { pane, timer: setTimeout(() => { pane.classList.remove("leaving"); $("side").classList.remove("tab-leaving"); paneLeaving = null; }, 120) };
  }
  for (const [tab, id] of Object.entries(PANES)) {
    const pane = $(id), was = pane.hidden;
    pane.hidden = tab !== name;
    if (was && !pane.hidden) { pane.classList.remove("fade-in"); void pane.offsetWidth; pane.classList.add("fade-in"); }
  }
}
// The one place the right panel follows the step (setStep: step_done, 건너뛰기's recorded answer, the strip's buttons):
// 초기 → 스캔, 셋업 → 조건, 목표 → 규칙, 단계 → 단계 표. The scan tab and the rules re-read the step's state first.
const STEP_TAB = { initial: "scan", setup: "cond", target: "rules", stages: "stages" };
function followStep(step) {
  renderScanPane(state.caseInfo);
  renderRulesPane(rulesPlan(state.plan));
  const pin = state.tabPin;
  if (pin && pin.caseId === state.meshCase && pin.step === step) return;
  state.tabPin = null;
  showTab(STEP_TAB[step] ?? "scan");
}
// the scan as it came (#20): the tooth chart, then the prescription, crowding, the space the target makes, what is
// missing and where the scan is from. A patient's own scan has no prescription: the chart and the scan's facts.
function renderScanPane(info) {
  renderToothChart(info);
  const sample = sampleOf(state.meshCase), rows = [];
  if (info) {
    const present = new Set(Object.keys(state.teeth).map((id) => fdi(id)));
    const missing = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27].filter((n) => !present.has(n));
    const t = stepIndex(state.progress) >= stepIndex("target") ? state.target?.target ?? state.plan?.target : null;
    const rx = state.scanRx && (state.scanRx.conditions_ko ?? sample?.prescription);   // only once the setup read it
    if (rx) rows.push(["처방", rx]);
    rows.push(["치아", `${info.n_teeth ?? Object.keys(state.teeth).length}개`], ["총생", info.crowding_mm != null ? `${info.crowding_mm} mm` : "—"]);
    if (t?.space_gain_mm != null) rows.push(["확보", `${t.space_gain_mm} mm` + (t.space_deficit_mm > 0 ? ` · 부족 ${t.space_deficit_mm} mm` : "")]);
    rows.push(["결손", missing.length ? missing.join(", ") + "번" : "없음"]);
    const row = state.cases.find((c) => c.case_id === state.meshCase);
    rows.push(["출처", sample ? "공개 데이터셋 Poseidon3D" : row?.patient ? `업로드한 스캔 · ${row.patient.alias} ${row.patient.scan_id}` : "업로드한 스캔"]);
  }
  $("scanFacts").replaceChildren(...rows.flatMap(([k, v]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; return [dt, dd]; }));
  $("scanFor").textContent = info ? sample?.title ?? "처방은 대화로" : "";
}

// ---- the tooth chart on the 스캔 tab: the upper arch laid flat, one crown per FDI number (the state keeps Universal).
// The crowns sit along a half-ellipse by their usual mesiodistal width (mm), so the chart reads like the start screen's
// arch mark, the patient's right on the left as dental charts go. States: 있음 · 결손 (an empty outline) · 발치 처방
// (red dashes and an X) · IPR contact (a yellow dot + mm inside the arch); the selected crowns are green like the 3D,
// and a click on the chart selects in the 3D too.
const CROWN = { 1: [8.5, 7], 2: [6.5, 6], 3: [7.5, 8], 4: [7, 9], 5: [6.5, 9], 6: [10, 11], 7: [9, 11], 8: [8.5, 10] };   // unit digit → [width, depth] mm
const SVGNS = "http://www.w3.org/2000/svg";
function chartLayout(fdis) {
  const A = 33, B = 44, GAP = 0.5, pts = [[0, 0, 0]];   // x, y, arc length from the midline along x = A sin t, y = B (1 − cos t)
  for (let i = 1, s = 0; i <= 600; i++) {
    const t = (i / 600) * 2.2, x = A * Math.sin(t), y = B * (1 - Math.cos(t)), [px, py] = pts[i - 1];
    s += Math.hypot(x - px, y - py); pts.push([x, y, s]);
  }
  const at = (s) => {
    let i = pts.findIndex((p) => p[2] >= s);
    if (i < 1) i = i === 0 ? 1 : pts.length - 1;
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    return { x: x1, y: y1, a: Math.atan2(y1 - y0, x1 - x0) };
  };
  const out = {};
  for (const quad of [1, 2]) {   // 1 = the patient's right (drawn on the left), 2 = the patient's left
    const side = quad === 1 ? -1 : 1;
    let s = GAP / 2;
    for (let unit = 1; unit <= 8; unit++) {
      const n = quad * 10 + unit, [w, d] = CROWN[unit];
      s += w / 2;
      if (fdis.has(n)) { const p = at(s); out[n] = { x: side * p.x, y: p.y, deg: (side === 1 ? p.a : Math.PI - p.a) * 180 / Math.PI, w, d }; }
      s += w / 2 + GAP;
    }
  }
  return out;
}
// what the chart marks: the target's (or the plan's) once the flow is past 셋업, else the prescription the setup read
// (state.scanRx). A case just opened marks nothing, a sample's prescription included, until its setup lands.
function chartMarks() {
  const t = stepIndex(state.progress) >= stepIndex("target") ? state.target?.target ?? state.plan?.target : null;
  if (t) return { removed: t.removed ?? [], surfaces: surfacesOf(t, state.target?.target === t ? state.target.info : state.plan?.info) };
  return { removed: state.scanRx?.extraction ?? [], surfaces: state.scanRx?.ipr_surfaces ?? [] };
}
// The setup's prescription goes on the chart as it goes on the 3D: scan-reveal ② starts once the scan numbers are
// through, so the marks wait for that too (at once when no reveal runs). A case opened again meanwhile drops them.
let scanRxGen = 0;
function markScanRx(rx) {
  const gen = scanRxGen;
  scanFx.numbersDone().then(() => {
    if (gen !== scanRxGen || !rx) return;
    state.scanRx = { ...state.scanRx, ...rx };
    renderScanPane(state.caseInfo);
  });
}
function clearScanRx() { scanRxGen++; state.scanRx = null; }
function renderToothChart(info) {
  const box = $("toothChart");
  box.replaceChildren();
  box.hidden = !info || !Object.keys(state.teeth).length;
  if (box.hidden) return;
  const present = new Set(Object.keys(state.teeth).map((id) => fdi(id)));
  const shown = new Set([17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, ...present]);   // 18·28 only when scanned
  const lay = chartLayout(shown), marks = chartMarks(), removed = new Set(marks.removed.map((u) => fdi(u)));
  const svg = document.createElementNS(SVGNS, "svg");
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.append(e); return e;
  };
  const xs = Object.values(lay).map((p) => p.x), ys = Object.values(lay).map((p) => p.y);
  const x0 = Math.min(...xs) - 8, y0 = Math.min(...ys) - 7, cy = (Math.min(...ys) + Math.max(...ys)) / 2 + 4;
  svg.setAttribute("viewBox", `${x0.toFixed(1)} ${y0.toFixed(1)} ${(Math.max(...xs) + 8 - x0).toFixed(1)} ${(Math.max(...ys) + 8 - y0).toFixed(1)}`);
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "상악 치아 차트");
  const used = new Set();
  for (const n of [...shown].sort((a, b) => a - b)) {
    const p = lay[n], u = String(universal(n)), has = present.has(n);
    const kind = !has ? "missing" : removed.has(n) ? "ext" : "ok";
    if (kind !== "ok") used.add(kind);
    const g = el("g", { class: `tooth ${kind}`, "data-id": u, "data-fdi": n }, svg);
    const body = el("g", { transform: `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.deg.toFixed(1)})` }, g);
    el("rect", { x: -p.w / 2 + 0.3, y: -p.d / 2, width: p.w - 0.6, height: p.d, rx: Math.min(p.w, p.d) * 0.38 }, body);
    if (kind === "ext") el("path", { class: "x", d: `M${-p.w / 4} ${-p.d / 4}L${p.w / 4} ${p.d / 4}M${p.w / 4} ${-p.d / 4}L${-p.w / 4} ${p.d / 4}` }, body);
    el("text", { x: p.x.toFixed(2), y: (p.y + 1.1).toFixed(2) }, g).textContent = n;
    el("title", {}, g).textContent = `${n}번` + (kind === "missing" ? " · 결손" : kind === "ext" ? " · 발치 처방" : "");
    if (has) { g.classList.toggle("sel", state.selected.has(u)); g.classList.toggle("pending", revealPending(u)); }
  }
  // IPR: a dot at the contact, the mm just inside the arch
  for (const [a, b, mm] of marks.surfaces ?? []) {
    const pa = lay[fdi(a)], pb = lay[fdi(b)];
    if (!pa || !pb) continue;
    used.add("ipr");
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    let nx = -Math.sin(ang), ny = Math.cos(ang);
    if (nx * -mx + ny * (cy - my) < 0) { nx = -nx; ny = -ny; }   // the normal that points into the arch
    const k = el("g", { class: "ipr" }, svg);
    el("circle", { cx: mx.toFixed(2), cy: my.toFixed(2), r: 1.3 }, k);
    el("text", { x: (mx + nx * 6.2).toFixed(2), y: (my + ny * 6.2 + 0.9).toFixed(2) }, k).textContent = String(+mm);
    el("title", {}, k).textContent = `IPR ${fdi(a)}-${fdi(b)} ${+mm} mm`;
  }
  el("text", { class: "center", x: 0, y: cy.toFixed(1) }, svg).textContent = "상악";
  el("text", { class: "center sub", x: 0, y: (cy + 5).toFixed(1) }, svg).textContent = `${present.size}개`;
  box.append(svg);
  const legend = document.createElement("div"); legend.className = "chart-legend";
  for (const [key, label] of [["ext", "발치 처방"], ["missing", "결손"], ["ipr", "IPR (mm)"]]) {
    if (!used.has(key)) continue;
    const s = document.createElement("span"); s.innerHTML = `<i class="${key}"></i>`; s.append(label); legend.append(s);
  }
  if (legend.childElementCount) box.append(legend);
}
// the chart's green follows the 3D selection (renderSelection calls this) without drawing the chart again
function markChartSelection() {
  for (const g of $("toothChart").querySelectorAll("g.tooth:not(.missing)")) g.classList.toggle("sel", state.selected.has(g.dataset.id));
}
// a crown clicked on the chart is picked like one clicked in the 3D
$("toothChart").addEventListener("click", (e) => {
  const id = e.target.closest("g.tooth:not(.missing)")?.dataset.id;
  if (!id || !state.teeth[id]) return;
  if (state.ruleMarked.has(id)) state.ruleMarked.delete(id);   // a violation's tooth becomes the dentist's, as in the 3D
  else if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  state.pickedOnce = true; $("pickedLegend").hidden = false; $("pickHint").hidden = true;
  renderSelection();
});
// Scan reveal: the 3D's scan recognition on the setup turn (scan-reveal.js start(), 17 → 27 at 0.1 s) fills the chart in
// the same order — window.dispatchEvent(new CustomEvent("cualign:scan-reveal", {detail: {ids: [Universal…], ms: 100}})).
// With no ids the chart fills from the molars to the incisors.
window.addEventListener("cualign:scan-reveal", (e) => {
  const chart = $("toothChart"), teeth = [...chart.querySelectorAll("g.tooth:not(.missing)")], ms = e.detail?.ms ?? 100;
  const order = e.detail?.ids?.map(String) ?? [...new Set(teeth.map((g) => g.dataset.fdi % 10))].sort((a, b) => b - a)
    .flatMap((unit) => teeth.filter((g) => g.dataset.fdi % 10 === unit).map((g) => g.dataset.id));
  // when each crown shows, kept so a chart drawn again meanwhile (the setup landing) stays in the sequence
  const t0 = performance.now();
  chartReveal = { due: new Map(order.map((id, i) => [id, t0 + i * ms])), end: t0 + order.length * ms + 50 };
  for (const g of teeth) g.classList.add("pending");
  order.forEach((id, i) => setTimeout(() => chart.querySelector(`g.tooth[data-id="${id}"]`)?.classList.remove("pending"), i * ms));
  setTimeout(() => { chartReveal = null; for (const g of chart.querySelectorAll("g.tooth.pending")) g.classList.remove("pending"); }, order.length * ms + 50);
});
let chartReveal = null;
const revealPending = (id) => !!chartReveal && performance.now() < (chartReveal.due.get(id) ?? chartReveal.end);
$("condApply").addEventListener("click", () => {
  let constraints;
  try { constraints = readConstraints(); } catch (e) { addMsg("error", e.message); return; }
  send("조건을 이렇게 바꿔서 다시 셋업해줘.", constraints, { step: "setup" });
});
// a row of the stage table moves the 3D to that stage
$("stageGrid").addEventListener("click", (e) => {
  const k = e.target.closest("[data-stage]")?.dataset.stage;
  if (k == null || !state.plan) return;
  state.stageTouched = true; stopPlay(); applyStage(+k);
});
// a violation item (or one of its stage buttons): playback stops, the slider goes to the stage, its teeth are selected
$("violGroups").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-teeth]");
  if (!b || b.disabled || !state.plan) return;
  state.stageTouched = true; stopPlay();
  if (state.step !== "stages") setStep("stages");
  const ids = b.dataset.teeth.split(",").filter(Boolean);
  if (ids.length) {   // the last violation's teeth replace the previous violation's; the dentist's own picks stay
    for (const id of state.ruleMarked) state.selected.delete(id);
    state.ruleMarked.clear();
    for (const id of ids) if (!state.selected.has(id)) { state.selected.add(id); state.ruleMarked.add(id); }
    state.pickedOnce = true; $("pickedLegend").hidden = false;
    renderSelection();
  }
  applyStage(b.dataset.stage != null ? +b.dataset.stage : state.stage);   // after the selection: it paints the highlight with the stage's marks
});
$("stageSlider").addEventListener("input", (e) => { state.stageTouched = true; stopPlay(); applyStage(+e.target.value); });
$("playBtn").addEventListener("click", () => { state.stageTouched = true; togglePlay(); });
$("retryFallback").addEventListener("click", () => { $("retryBar").hidden = true; runFallback(); });
$("planFailRetry").addEventListener("click", () => { showTab("cond"); runFallback(); });
$("condRecalc").addEventListener("click", () => runFallback({ fromCond: true }));
// 발치 허용 off = non-extraction: the teeth field empties and locks; on opens it for the prescribed teeth
$("cAllowExt").addEventListener("change", () => {
  const on = $("cAllowExt").checked;
  $("cExtract").disabled = !on;
  if (on) $("cExtract").focus(); else $("cExtract").value = "";
  updateActions();
});
// a popover that fades and slides in and out (#20): hidden toggles display, .in drives the transition
function showPop(pop, on) {
  if (on) { pop.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add("in"))); }
  else { pop.classList.remove("in"); setTimeout(() => { if (!pop.classList.contains("in")) pop.hidden = true; }, 160); }
}

export { clearScanRx, followStep, markChartSelection, markScanRx, markStage, renderLegend, renderResult,
  renderRulesPane, renderScanPane, renderSide, showPop, showTab };
