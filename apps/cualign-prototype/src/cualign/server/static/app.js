// cuAlign web UI — case gate → chat (NAT /chat/stream, inline tool trace) → three.js stage viewer → plan panel.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const $ = (id) => document.getElementById(id);
// Colours follow clinical software conventions (docs/research/2026-09-23-원내-얼라이너-SW-화면-역설계.md):
// teeth are ivory, movement is a heat tint, collisions red, limit breaches amber, locked teeth blue.
const IVORY = new THREE.Color(0xe9e3d6), HEAT = new THREE.Color(0x76b900);
const RED = 0xe23a3a, AMBER = 0xe0a52a, BLUE = 0x4f8fd6;

// ------------------------------------------------------------------ state
const state = {
  messages: [],          // full transcript sent to /chat/stream
  streaming: false,
  meshCase: null,        // case_id currently loaded in the viewer
  cases: [],             // /api/cases rows
  teeth: {},             // tooth_id -> THREE.Mesh
  center: {},            // tooth_id -> rest centroid (THREE.Vector3)
  archOrder: [],         // tooth ids along the arch (for IPR contact labels)
  plan: null,            // GET /api/plans/{id} payload
  stage: 0,
  playing: null,         // interval handle
  lastPlanId: null,
  lastAssistantText: "",
  trace: null,           // inline tool-call trace for the turn in progress
  labels: [],            // CSS2DObject IPR labels
};

// ------------------------------------------------------------------ three.js
const canvas = $("viewCanvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const labelRenderer = new CSS2DRenderer({ element: $("labels") });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
camera.up.set(0, 1, 0);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(30, 40, 120); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-50, -30, 60); scene.add(fill);
const group = new THREE.Group(); scene.add(group);
const raycaster = new THREE.Raycaster();

function resize() {
  const wrap = $("canvasWrap");
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($("canvasWrap"));
(function loop() { controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera); requestAnimationFrame(loop); })();

function buildTeeth(mesh) {
  group.clear(); state.teeth = {}; state.center = {}; clearLabels();
  for (const [id, t] of Object.entries(mesh.teeth)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(t.v.flat(), 3));
    geo.setIndex(t.f.flat());
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ color: IVORY.clone(), roughness: 0.45, metalness: 0.02, transparent: true, opacity: 1 });
    const m = new THREE.Mesh(geo, mat);
    m.userData.id = id;
    group.add(m);
    state.teeth[id] = m;
    state.center[id] = geo.boundingBox.getCenter(new THREE.Vector3());
  }
  if (mesh.gum) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.gum.v.flat(), 3));
    geo.setIndex(mesh.gum.f.flat());
    geo.computeVertexNormals();
    const gum = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd98b8f, roughness: 0.6, metalness: 0.0 }));
    gum.userData.gum = true;
    group.add(gum);
  }
  state.archOrder = (mesh.arch_order ?? mesh.ids ?? []).map(String);
  $("archLabel").textContent = `${mesh.arch === "upper" ? "상악" : mesh.arch ?? "?"} · 치아 ${Object.keys(mesh.teeth).length}개 · 교합면에서 본 모습`;
  setView("occlusal");
}

function setView(kind) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const dist = Math.max(size.x, size.y, size.z) / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.25;
  if (kind === "frontal") {            // look from the anterior (+y) side; upper arch → crowns hang down (occlusal z=0 at the bottom)
    camera.up.set(0, 0, -1);
    camera.position.set(c.x, c.y + dist, c.z - size.z * 0.3);
  } else {                             // occlusal: look down -z, anterior at larger y
    camera.up.set(0, 1, 0);
    camera.position.set(c.x, c.y, c.z + dist);
  }
  controls.target.copy(c);
  controls.update();
  const label = $("archLabel").textContent.replace(/(교합면|정면)에서 본 모습/, `${kind === "frontal" ? "정면" : "교합면"}에서 본 모습`);
  $("archLabel").textContent = label;
}

// ---- IPR labels: one per contact along the arch, mm number at the contact point (3/5 clinical SW do this)
function clearLabels() { for (const l of state.labels) l.parent?.remove(l); state.labels = []; }
function buildIprLabels() {
  clearLabels();
  const t = state.plan?.target;
  const per = t?.ipr_mm_per_surface ?? 0;
  if (!per) return;
  const excl = new Set((t.ipr_exclude ?? []).map(String));
  const removed = new Set((t.removed ?? []).map(String));
  const order = state.archOrder.filter((id) => state.teeth[id] && !removed.has(id));
  for (let k = 0; k + 1 < order.length; k++) {
    const a = order[k], b = order[k + 1];
    const mm = per * 0.5 * ((excl.has(a) ? 0 : 1) + (excl.has(b) ? 0 : 1));
    if (!mm) continue;
    const el = document.createElement("div");
    el.className = "ipr-label";
    el.textContent = mm.toFixed(2);
    const obj = new CSS2DObject(el);
    obj.userData = { a, b };
    group.add(obj);
    state.labels.push(obj);
  }
  placeLabels();
}
function placeLabels() {
  for (const l of state.labels) {
    const { a, b } = l.userData;
    const pa = state.center[a].clone().add(state.teeth[a].position);
    const pb = state.center[b].clone().add(state.teeth[b].position);
    l.position.copy(pa.add(pb).multiplyScalar(0.5));
    l.position.z += 2;
  }
}

function violationsAt(k) {
  const by = {};   // tooth -> Set(type)
  for (const v of state.plan?.violations ?? []) {
    if (v.stage !== k || !v.teeth) continue;
    for (const t of v.teeth) (by[String(t)] ??= new Set()).add(v.type);
  }
  return by;
}

function applyStage(k) {
  state.stage = k;
  const plan = state.plan;
  const st = plan?.stages?.[k] ?? {};
  const hasPlan = !!plan;
  const bad = violationsAt(k);
  const locked = new Set((plan?.target?.locked ?? []).map(String));
  const removed = new Set((plan?.target?.removed ?? []).map(String));
  const last = plan?.stages?.[plan.stages.length - 1] ?? {};
  const maxMove = Math.max(1e-6, ...Object.values(last).map((d) => Math.hypot(...d)));
  for (const [id, m] of Object.entries(state.teeth)) {
    const d = st[id];
    if (d) m.position.set(d[0], d[1], d[2]); else m.position.set(0, 0, 0);
    const gone = hasPlan && removed.has(id);
    m.visible = !gone || k === 0;
    m.material.opacity = gone ? 0.25 : 1;
    const moved = d ? Math.hypot(...d) : 0;
    m.userData.moved = moved;
    m.userData.viol = bad[id] ? [...bad[id]] : [];
    if (bad[id]?.has("collision")) m.material.color.setHex(RED);
    else if (bad[id]?.has("move_limit")) m.material.color.setHex(AMBER);
    else if (locked.has(id)) m.material.color.setHex(BLUE);
    else m.material.color.copy(IVORY).lerp(HEAT, hasPlan ? Math.min(1, moved / maxMove) * 0.75 : 0);
  }
  placeLabels();
  const n = hasPlan ? plan.stages.length - 1 : 0;
  const months = plan?.info?.months ?? "—";
  $("stageLabel").textContent = !hasPlan ? "계획 없음" : k === 0 ? `치료 전 · 총 ${n}단계 · 예상 ${months}개월` : `단계 ${k} / ${n} · 예상 ${months}개월`;
  $("stageSlider").value = k;
}

// ---- hover tooltip: tooth number · cumulative move · violations at this stage (number only on hover, as in 5/5 SW)
function onPointerMove(e) {
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(p, camera);
  const hit = raycaster.intersectObjects(group.children.filter((o) => o.isMesh && o.visible && !o.userData.gum))[0];
  const tip = $("tip");
  if (!hit) { tip.hidden = true; return; }
  const m = hit.object, id = m.userData.id;
  const parts = [`치아 ${id}`];
  if (state.plan) parts.push(`누적 이동 ${m.userData.moved.toFixed(2)} mm`);
  if (m.userData.viol?.length) parts.push(`위반: ${m.userData.viol.join(", ")}`);
  if ((state.plan?.target?.locked ?? []).map(String).includes(id)) parts.push("고정");
  if ((state.plan?.target?.removed ?? []).map(String).includes(id)) parts.push("발치");
  tip.textContent = parts.join(" · ");
  tip.style.left = `${e.clientX - r.left + 12}px`;
  tip.style.top = `${e.clientY - r.top + 12}px`;
  tip.hidden = false;
}

// ------------------------------------------------------------------ API helpers
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// ------------------------------------------------------------------ case gate (start point)
const SEVERITY = (mm) => mm == null ? "" : mm < 1 ? "정렬 상태" : mm <= 3 ? "경도 총생" : mm <= 6 ? "중등도 총생" : mm <= 8 ? "중증 총생" : "발치 임계";

async function loadCases() {
  const { cases, active } = await api("/api/cases");
  state.cases = cases;
  const wrap = $("caseCards");
  wrap.innerHTML = "";
  for (const c of cases) {
    const b = document.createElement("button");
    b.className = "case-card";
    b.dataset.id = c.case_id;
    b.innerHTML = `<span class="cid"></span><span class="sev"></span><span class="meta"></span>`;
    b.querySelector(".cid").textContent = c.case_id;
    b.querySelector(".sev").textContent = c.crowding_mm != null ? SEVERITY(c.crowding_mm) : c.kind;
    b.querySelector(".meta").textContent = c.crowding_mm != null ? `총생 ${c.crowding_mm} mm · 상악 · 합성` : `상악 · ${c.kind}`;
    wrap.appendChild(b);
  }
  return active;
}

async function activateCase(caseId, { greet = true } = {}) {
  const info = await api(`/api/cases/${encodeURIComponent(caseId)}/activate`, { method: "POST" });
  await loadMesh(caseId);
  $("caseName").textContent = `${caseId} · 총생 ${info.crowding_mm} mm`;
  $("caseGate").hidden = true;
  $("gateClose").hidden = false;
  if (greet) {
    // The agent opens the conversation (clinical SW: case first, then constraints). Kept in the transcript
    // the model sees, so it knows which case is on screen.
    const text = `케이스 ${caseId} (상악 ${info.n_teeth}개 치아, 총생 ${info.crowding_mm} mm) 를 불러왔습니다. ` +
      `계획을 시작하려면 제약을 말로 알려 주세요. 발치는 허용되나요? 치료 기간 상한은 몇 개월인가요? 먼저 풀고 싶은 부위가 있나요?`;
    addMsg("assistant", text);
    state.messages.push({ role: "assistant", content: text });
  }
}

async function loadMesh(caseId) {
  if (!caseId || caseId === state.meshCase) return;
  const mesh = await api(`/api/cases/${encodeURIComponent(caseId)}/mesh`);
  state.meshCase = caseId;
  state.plan = null;
  buildTeeth(mesh);
  applyStage(0);
}

async function refreshPlans(selectId) {
  const { plans } = await api("/api/plans");
  const sel = $("planSelect");
  sel.innerHTML = '<option value="">계획 선택…</option>';
  for (const p of plans) {
    const o = document.createElement("option");
    o.value = p.plan_id;
    o.textContent = `${p.plan_id} · ${p.strategy} · ${p.n_stages}장 · ${p.passed ? "통과" : `위반 ${p.violations}`}`;
    sel.appendChild(o);
  }
  const id = selectId ?? plans[0]?.plan_id;
  if (id) { sel.value = id; await loadPlan(id); }
}

async function loadPlan(planId) {
  if (!planId) return;
  const plan = await api(`/api/plans/${encodeURIComponent(planId)}`);
  if (plan.case_id && plan.case_id !== state.meshCase) {
    state.meshCase = null;
    await loadMesh(plan.case_id);
    $("caseName").textContent = plan.case_id;
  }
  state.plan = plan;
  stopPlay();
  const slider = $("stageSlider");
  slider.max = Math.max(plan.stages.length - 1, 0);
  slider.disabled = false;
  buildIprLabels();
  applyStage(0);
  renderResult(plan);
  const link = $("stlLink");
  link.href = `/api/plans/${encodeURIComponent(planId)}/stl.zip`;
  link.classList.remove("disabled");
}

// ------------------------------------------------------------------ result panel
function setBadge(text, cls) { const b = $("statusBadge"); b.textContent = text; b.className = `badge ${cls}`; }

function renderResult(plan) {
  const viol = plan.violations ?? [];
  const byType = {};
  for (const v of viol) byType[v.type] = (byType[v.type] ?? 0) + 1;
  $("rStrategy").textContent = plan.strategy ?? "—";
  $("rStages").textContent = plan.info?.n_stages != null ? `${plan.info.n_stages}장` : "—";
  $("rMonths").textContent = plan.info?.months != null ? `${plan.info.months}개월` : "—";
  $("rViol").textContent = viol.length ? Object.entries(byType).map(([k, n]) => `${k} ${n}`).join(" · ") : "0건";
  $("rPlan").textContent = plan.plan_id ?? "—";

  if (plan.passed || viol.length === 0) setBadge("규칙 통과 (의사 검토 전 초안)", "pass");
  else if (byType.space_deficit) setBadge("제약 모순 — 조건 완화 필요", "fail");
  else setBadge(`위반 ${viol.length}건 — 전략 전환 검토`, "warn");

  const tb = $("violTable").querySelector("tbody");
  tb.innerHTML = "";
  if (!viol.length) { tb.innerHTML = '<tr><td colspan="4" class="empty">위반 없음</td></tr>'; return; }
  for (const v of viol.slice(0, 200)) {
    const tr = document.createElement("tr");
    tr.className = v.type;
    const val = v.type === "collision" ? `${v.overlap_mm3} mm³ (기준 ${v.baseline})`
      : v.type === "move_limit" ? `${v.mm} mm > ${v.limit}`
      : v.type === "stage_cap" ? `${v.n}장 > 상한 ${v.limit}`
      : v.type === "space_deficit" ? `${v.mm} mm 부족 (허용 ${v.limit})` : JSON.stringify(v);
    tr.innerHTML = `<td>${v.stage ?? "전체"}</td><td>${(v.teeth ?? []).join(", ") || "—"}</td><td class="type">${v.type}</td><td>${val}</td>`;
    tb.appendChild(tr);
  }
}

// ------------------------------------------------------------------ chat
function addMsg(role, text = "") {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  $("transcript").appendChild(div);
  $("transcript").scrollTop = $("transcript").scrollHeight;
  return div;
}

// Inline trace (Claude Code style): one row per tool/LLM event, keyed by NAT step id, rendered
// inside the transcript right before the assistant bubble. Click a row to expand the raw payload.
function newTrace() {
  const div = document.createElement("div");
  div.className = "trace";
  $("transcript").appendChild(div);
  return { el: div, rows: new Map() };
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

function addStep(name, payload, cls = "", trace = state.trace, id = null) {
  if (!trace) trace = state.trace = newTrace();
  const isLlm = /llm|thought|reason|nim_/i.test(name ?? "") || cls === "llm";
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 1);
  const { input, output } = isLlm || cls ? { input: "", output: text } : splitPayload(text);
  const label = (name ?? "step").replace(/^Function (Start|End): /, "");
  let row = id && trace.rows.get(id);
  if (!row) {
    row = document.createElement("details");
    row.className = `step ${isLlm ? "llm" : cls}`;
    row.innerHTML = `<summary><span class="dot"></span><span class="name"></span><span class="args"></span><span class="arrow">→</span><span class="out"></span></summary><pre></pre>`;
    trace.el.appendChild(row);
    if (id) trace.rows.set(id, row);
  }
  row.querySelector(".name").textContent = isLlm ? "모델 추론" : label;
  row.querySelector(".args").textContent = isLlm ? ` (${label})` : (input ? `(${argsSummary(input)})` : "");
  const done = !!output;
  row.querySelector(".arrow").style.visibility = done ? "visible" : "hidden";
  row.querySelector(".out").textContent = done ? (isLlm ? output.replace(/\s+/g, " ").slice(0, 110) : outSummary(label, output)) : "";
  row.classList.toggle("running", !done);
  row.querySelector("pre").textContent = text ?? "";
  $("transcript").scrollTop = $("transcript").scrollHeight;
}

const PLAN_RE = /["']?plan_id["']?\s*[:=]\s*["']?(p\d+)/g;
function scanPlanId(text) {
  let m, last = null;
  while ((m = PLAN_RE.exec(text ?? "")) !== null) last = m[1];
  if (last) state.lastPlanId = last;
}

async function send(text) {
  text = (text ?? "").trim();
  if (!text || state.streaming) return;
  if (!state.meshCase) { $("caseGate").hidden = false; return; }
  state.streaming = true;
  $("sendBtn").disabled = true;
  $("chatInput").value = "";
  state.messages.push({ role: "user", content: text });
  addMsg("user", text);
  state.trace = newTrace();
  const bubble = addMsg("assistant", "");
  const cursor = document.createElement("span"); cursor.className = "cursor"; bubble.appendChild(cursor);
  let answer = "";
  state.lastPlanId = null;

  try {
    const r = await fetch("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages: state.messages }),
    });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split(/\r?\n\r?\n/);
      buf = events.pop();
      for (const ev of events) {
        for (const line of ev.split(/\r?\n/)) {
          const i = line.indexOf(": ");
          if (i < 0) continue;
          const kind = line.slice(0, i), raw = line.slice(i + 2);
          let obj; try { obj = JSON.parse(raw); } catch { continue; }
          if (kind === "intermediate_data") {
            const payload = obj.payload ?? "";
            addStep(obj.name ?? "step", payload, "", state.trace, obj.id ?? null);
            scanPlanId(typeof payload === "string" ? payload : JSON.stringify(payload));
          } else if (kind === "data") {
            const ch = obj.choices?.[0];
            const delta = ch?.delta?.content ?? ch?.message?.content ?? obj.value ?? "";
            if (delta) { answer += delta; bubble.textContent = answer; bubble.appendChild(cursor); scanPlanId(answer); }
            $("transcript").scrollTop = $("transcript").scrollHeight;
          } else if (kind === "error") {
            addStep("error", obj, "fallback");
          }
        }
      }
    }
    cursor.remove();
    if (!answer && !state.lastPlanId) {
      bubble.textContent = "모델 응답 없음 — 서버 로그(NVIDIA_API_KEY)를 확인하거나 규칙 기반 폴백을 눌러 확인할 수 있습니다";
      bubble.classList.add("error");
    } else if (!answer) bubble.textContent = "(빈 응답)";
    state.messages.push({ role: "assistant", content: answer });
    state.lastAssistantText = answer;
    if (state.lastPlanId) await refreshPlans(state.lastPlanId);
    else if (/\?|？/.test(answer)) setBadge("의사 판단 필요", "ask");
  } catch (e) {
    cursor.remove();
    if (!answer) bubble.remove();
    addMsg("error", "모델 호출 실패 — 규칙 기반 폴백을 눌러 확인할 수 있습니다");
    addStep("error", String(e), "fallback");
    state.messages.pop();   // keep transcript consistent with what the model saw
  } finally {
    state.streaming = false;
    $("sendBtn").disabled = false;
  }
}

// ------------------------------------------------------------------ fallback / upload
async function runFallback() {
  const caseId = state.meshCase;
  if (!caseId) { $("caseGate").hidden = false; return; }
  const last = [...state.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const allow = !/발치[^.。\n]{0,8}(없이|안\s*돼|안돼|하지\s*마|절대|금지|빼고|싫|피)/.test(last);
  const mm = last.match(/(\d+)\s*개월/);
  const stage_cap = mm ? Math.round((+mm[1] * 30.4) / 7) : null;
  addMsg("system", `규칙 기반 폴백 실행 · 케이스 ${caseId} · 발치 ${allow ? "허용" : "금지"} · 상한 ${stage_cap ?? "없음"}장`);
  state.trace = newTrace();
  try {
    const res = await api("/api/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: caseId, allow_extraction: allow, stage_cap, order: "simultaneous" }),
    });
    for (const t of res.tried ?? []) addStep(`fallback: ${t.strategy}`, `${t.n_stages}장 · ${t.months}개월 · ${t.passed ? "통과" : `위반 ${t.violations}`} · ${t.plan_id}`, "fallback");
    if (res.chosen) await refreshPlans(res.chosen.plan_id);
    else { await refreshPlans(res.tried?.[0]?.plan_id); addMsg("system", "허용된 전략으로는 규칙을 통과하는 계획이 없습니다 — 조건 완화가 필요합니다"); }
  } catch (e) {
    addMsg("error", `폴백 실패: ${e.message}`);
  }
}

async function upload(files) {
  if (!files?.length) return;
  const fd = new FormData();
  for (const f of files) fd.append("files", f, f.name);
  try {
    const res = await api("/api/cases/upload", { method: "POST", body: fd });
    await loadCases();
    await activateCase(res.case_id);
  } catch (e) {
    addMsg("error", `업로드 실패: ${e.message} — 파일명은 <치아번호>.stl (Universal, 상악) 이어야 합니다`);
  }
}

// ------------------------------------------------------------------ stage playback
function stopPlay() { if (state.playing) { clearInterval(state.playing); state.playing = null; $("playBtn").textContent = "▶"; } }
function togglePlay() {
  if (!state.plan) return;
  if (state.playing) return stopPlay();
  $("playBtn").textContent = "⏸";
  state.playing = setInterval(() => {
    const n = state.plan.stages.length - 1;
    applyStage(state.stage >= n ? 0 : state.stage + 1);
  }, 350);
}

// ------------------------------------------------------------------ wiring
$("chatForm").addEventListener("submit", (e) => { e.preventDefault(); send($("chatInput").value); });
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("chatInput").value); } });
$("chips").addEventListener("click", (e) => { if (e.target.classList.contains("chip")) send(e.target.textContent); });
$("caseCards").addEventListener("click", (e) => {
  const card = e.target.closest(".case-card");
  if (card) activateCase(card.dataset.id).catch((err) => addMsg("error", `케이스 로드 실패: ${err.message}`));
});
$("caseBtn").addEventListener("click", () => { $("caseGate").hidden = false; });
$("gateClose").addEventListener("click", () => { $("caseGate").hidden = true; });
$("planSelect").addEventListener("change", (e) => loadPlan(e.target.value).catch((err) => addMsg("error", `계획 로드 실패: ${err.message}`)));
$("stageSlider").addEventListener("input", (e) => { stopPlay(); applyStage(+e.target.value); });
$("playBtn").addEventListener("click", togglePlay);
$("fallbackBtn").addEventListener("click", runFallback);
$("uploadInput").addEventListener("change", (e) => { upload(e.target.files); e.target.value = ""; });
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerleave", () => { $("tip").hidden = true; });
for (const b of document.querySelectorAll(".view-btns button")) b.addEventListener("click", () => setView(b.dataset.view));

(async function init() {
  resize();
  let active = null;
  try { active = await loadCases(); } catch (e) { addMsg("error", `케이스 목록 로드 실패: ${e.message}`); }
  const params = new URLSearchParams(location.search);
  if (params.get("plan")) {
    await activateCase(active ?? "moderate", { greet: false }).catch(() => {});
    await refreshPlans(params.get("plan")).catch(() => {});
    return;
  }
  // The dentist picks a case every time the page opens (clinical SW: patient first). A case the server
  // already has active is marked on its card but not auto-selected.
  if (active) document.querySelector(`.case-card[data-id="${CSS.escape(active)}"]`)?.classList.add("current");
  $("caseGate").hidden = false;
})();
