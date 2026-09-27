// cuAlign web UI — patient → scan upload → input check on the 3D → chat (NAT /chat/stream, inline tool trace) → three.js stage viewer → plan panel.
import * as THREE from "three";
import { PlanStream, matchesSelection } from "./plan-stream.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const $ = (id) => document.getElementById(id);
// Colours follow clinical software conventions (docs/research/2026-09-23-원내-얼라이너-SW-화면-역설계.md):
// teeth are ivory, movement is a heat tint, collisions red, limit breaches amber, locked teeth blue.
const IVORY = new THREE.Color(0xe9e3d6), HEAT = new THREE.Color(0x76b900);
const RED = 0xe52020, AMBER = 0xef9100, BLUE = 0x4f8fd6;   // DESIGN.md colors.error, warning, locked
const GHOST_GREY = 0xb3b3b3;   // colors.text-mute, the legend's dashed 「발치」 outline

// ------------------------------------------------------------------ state
const state = {
  messages: [],          // full transcript sent to /chat/stream
  streaming: false,
  meshCase: null,        // case_id currently loaded in the viewer
  activeCase: null,      // case_id being planned (the input-check screen can show another scan in the viewer)
  cases: [],             // /api/cases rows
  teeth: {},             // tooth_id -> THREE.Mesh
  center: {},            // tooth_id -> rest centroid (THREE.Vector3)
  archOrder: [],         // tooth ids along the arch (for IPR contact labels)
  plan: null,            // GET /api/plans/{id} payload
  stage: 0,
  playing: null,         // interval handle
  loading: false,
  selectionVersion: 0,
  requestId: null,
  lastAssistantText: "",
  trace: null,           // inline tool-call trace for the turn in progress
  labels: [],            // CSS2DObject IPR labels
  patient: null,         // GET /api/patients/{id} payload of the patient on screen
  checkCase: null,       // case id shown on the input-check screen
  checkRevision: null,   // scan revision shown there; the confirmation names it
  gateVersion: 0,        // bumped on every patient/scan navigation: a late response for an earlier choice is dropped
  lastRequest: null,     // {text, constraints} of the last /chat/stream request, replayed by 다시 보내기 (#51)
  selected: new Set(),   // teeth the dentist clicked in the 3D; named in the next chat message (#90)
  overlay: false,        // 전후 겹쳐 보기: the untreated arch drawn as a white ghost (#90)
  violLabels: [],        // CSS2DObject collision labels of the stage on screen
  numLabels: [],         // CSS2DObject tooth numbers shown during the input check
  planRows: {},          // plan_id -> /api/plans row of the case on screen (the decision bar names plans by these)
  planRowsCase: null,
  newPlans: 0,           // plans added by the last refreshPlans: more than one means the turn compared strategies
};

// ------------------------------------------------------------------ three.js
const canvas = $("viewCanvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const labelRenderer = new CSS2DRenderer({ element: $("labels") });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
camera.up.set(0, 1, 0);
// Trackball, not orbit: the views set camera.up to +y or -z, and OrbitControls fixes its pole axis once at
// construction, so after a view change it blocked near the poles and turned the wrong way (#90).
const controls = new TrackballControls(camera, canvas);
controls.rotateSpeed = 3.5; controls.zoomSpeed = 1.2; controls.panSpeed = 0.6;
controls.dynamicDampingFactor = 0.18;
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
  controls.handleResize();
}
new ResizeObserver(resize).observe($("canvasWrap"));

// +x is the patient's left (tooth 15 side), +y anterior, +z occlusal (see setView).
const VIEWS = { occlusal: "교합면", frontal: "정면", left: "환자 왼쪽", right: "환자 오른쪽", back: "뒤쪽", base: "바닥" };
(function loop() {
  controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera);
  requestAnimationFrame(loop);
})();

const ghost = new THREE.Group(); scene.add(ghost);
const GHOST_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false });
function buildTeeth(mesh) {
  group.clear(); ghost.clear(); state.teeth = {}; state.center = {}; state.gum = null; clearLabels();
  state.violLabels = []; state.selected.clear(); renderSelection();
  for (const [id, t] of Object.entries(mesh.teeth)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(t.v.flat(), 3));
    geo.setIndex(t.f.flat());
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ color: IVORY.clone(), roughness: 0.45, metalness: 0.02, transparent: true, opacity: 1, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.userData.id = id;
    group.add(m);
    ghost.add(new THREE.Mesh(geo, GHOST_MAT));   // the untreated position, shown by 전후 겹쳐 보기
    state.teeth[id] = m;
    state.center[id] = geo.boundingBox.getCenter(new THREE.Vector3());
  }
  if (mesh.gum) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.gum.v.flat(), 3));
    geo.setIndex(mesh.gum.f.flat());
    geo.computeVertexNormals();
    const gum = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd98b8f, roughness: 0.6, metalness: 0.0, transparent: true, opacity: 1, side: THREE.DoubleSide }));
    gum.userData.gum = true;
    state.gum = gum;
    group.add(gum);
  }
  state.archOrder = (mesh.arch_order ?? mesh.ids ?? []).map(String);
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
  } else if (kind === "back") {        // from the palate side, crowns down
    camera.up.set(0, 0, -1);
    camera.position.set(c.x, c.y - dist, c.z - size.z * 0.3);
  } else if (kind === "left" || kind === "right") {   // buccal side views; +x is the patient's left
    camera.up.set(0, 0, -1);
    camera.position.set(c.x + (kind === "left" ? dist : -dist), c.y, c.z - size.z * 0.3);
  } else if (kind === "base") {        // from above the base of the scan
    camera.up.set(0, 1, 0);
    camera.position.set(c.x, c.y, c.z - dist);
  } else {                             // occlusal: look down -z, anterior at larger y
    kind = "occlusal";
    camera.up.set(0, 1, 0);
    camera.position.set(c.x, c.y, c.z + dist);
  }
  controls.target.copy(c);
  controls.update();
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
  const st = k > 0 ? (plan?.stages?.[k - 1] ?? {}) : {};
  const rot = k > 0 ? plan?.rotations?.[k - 1] ?? {} : {};
  // the scanned gum does not move with the crowns: fade it once they do, so moved crowns are not hidden in it
  if (state.gum) { state.gum.material.opacity = k > 0 ? 0.35 : 1; state.gum.material.depthWrite = k === 0; }
  const hasPlan = !!plan;
  const bad = violationsAt(k);
  const locked = new Set((plan?.target?.locked ?? []).map(String));
  const removed = new Set((plan?.target?.removed ?? []).map(String));
  const last = plan?.stages?.[plan.stages.length - 1] ?? {};
  const maxMove = Math.max(1e-6, ...Object.values(last).map((d) => Math.hypot(...d)));
  for (const [id, m] of Object.entries(state.teeth)) {
    const d = st[id];
    // turn about the crown's own vertical axis through its centroid c: v' = R(v - c) + c + d  =>  position = d + c - R c
    const a = ((rot[id] ?? 0) * Math.PI) / 180, c = plan?.pivots?.[id] ?? [0, 0, 0], t = d ?? [0, 0, 0];
    m.rotation.set(0, 0, a);
    m.position.set(t[0] + c[0] - (Math.cos(a) * c[0] - Math.sin(a) * c[1]), t[1] + c[1] - (Math.sin(a) * c[0] + Math.cos(a) * c[1]), t[2]);
    const gone = hasPlan && removed.has(id);
    m.visible = !gone || k === 0;
    // extracted teeth at stage 0: a wireframe ghost like the legend's dashed swatch; materials are per tooth and
    // reused across plans, so every other tooth gets its solid look back
    m.material.opacity = gone ? 0.6 : 1;
    m.material.wireframe = gone;
    const moved = d ? Math.hypot(...d) : 0;
    m.userData.moved = moved;
    m.userData.viol = bad[id] ? [...bad[id]] : [];
    if (gone) m.material.color.setHex(GHOST_GREY);
    else if (bad[id]?.has("collision")) m.material.color.setHex(RED);
    else if (bad[id]?.has("move_limit")) m.material.color.setHex(AMBER);
    else if (locked.has(id)) m.material.color.setHex(BLUE);
    else m.material.color.copy(IVORY).lerp(HEAT, hasPlan ? Math.min(1, moved / maxMove) * 0.75 : 0);
    m.material.emissive.setHex(state.selected.has(id) ? 0x5a9400 : 0x000000);
  }
  placeLabels();
  // overlap amount at the contact itself, not only in the table (#90)
  for (const l of state.violLabels) l.parent?.remove(l);
  state.violLabels = [];
  for (const v of plan?.violations ?? []) {
    if (v.stage !== k || v.type !== "collision" || (v.teeth ?? []).length < 2) continue;
    const [a, b] = v.teeth.map(String);
    if (!state.teeth[a] || !state.teeth[b]) continue;
    const el = document.createElement("div");
    el.className = "coll-label";
    el.textContent = `${v.overlap_mm3} mm³`;
    const obj = new CSS2DObject(el);
    obj.position.copy(state.center[a].clone().add(state.teeth[a].position).add(state.center[b]).add(state.teeth[b].position).multiplyScalar(0.5));
    obj.position.z += 3;
    group.add(obj);
    state.violLabels.push(obj);
  }
  ghost.visible = state.overlay && k > 0;
  const n = hasPlan ? plan.stages.length : 0;
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
  if (parts.length === 1) { tip.hidden = true; return; }
  tip.textContent = parts.join(" · ");
  tip.style.left = `${e.clientX - r.left + 12}px`;
  tip.style.top = `${e.clientY - r.top + 12}px`;
  tip.hidden = false;
}

// ---- click a tooth to name it in the chat (#90): a click without a drag toggles it; drags still orbit
function toothAt(e) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return raycaster.intersectObjects(group.children.filter((o) => o.isMesh && o.visible && !o.userData.gum))[0]?.object.userData.id ?? null;
}
function renderSelection() {
  for (const [id, m] of Object.entries(state.teeth)) m.material.emissive.setHex(state.selected.has(id) ? 0x5a9400 : 0x000000);
  const box = $("selChips");
  box.innerHTML = "";
  box.hidden = !state.selected.size;
  if (!state.selected.size) return;
  box.append("선택한 치아 · 다음 메시지에 함께 보냅니다");
  for (const id of [...state.selected].sort((a, b) => a - b)) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.id = id; b.textContent = `${id}번 ✕`; b.title = "선택 해제";
    box.append(b);
  }
  const clear = document.createElement("button");
  clear.type = "button"; clear.className = "clear"; clear.textContent = "모두 해제";
  box.append(clear);
}
let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const id = toothAt(e);
  if (!id) return;
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  renderSelection();
});
$("selChips").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("clear")) state.selected.clear(); else state.selected.delete(b.dataset.id);
  renderSelection();
});

// ---- marks over the stage slider (#90): where the rules found a collision or a per-stage limit breach
function renderStageMarks() {
  const box = $("stageMarks");
  box.innerHTML = "";
  const n = state.plan?.stages?.length ?? 0;
  if (!n) return;
  const by = {};
  for (const v of state.plan.violations ?? []) {
    if (v.stage == null || !["collision", "move_limit"].includes(v.type)) continue;
    const s = (by[v.stage] ??= { collision: 0, move_limit: 0 }); s[v.type]++;
  }
  for (const [k, s] of Object.entries(by)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "stage-mark " + (s.collision ? "collision" : "move_limit");
    b.style.left = `${(+k / n) * 100}%`;
    b.title = `단계 ${k}: ` + [s.collision && `충돌 ${s.collision}`, s.move_limit && `장당 이동 한계 초과 ${s.move_limit}`].filter(Boolean).join(" · ");
    b.addEventListener("click", () => { stopPlay(); applyStage(+k); });
    box.append(b);
  }
}

// ---- keep or undo a new plan (#90): the previous plan stays one click away after every replanning
function addDecision(prevId, newId) {
  if (!prevId || !newId || prevId === newId) return;
  const bar = document.createElement("div");
  bar.className = "decision";
  bar.innerHTML = `<span></span><button class="btn primary small" type="button" data-act="keep">이 안 유지</button>
    <button class="btn ghost small" type="button" data-act="revert">이전 안으로 되돌리기</button>`;
  const say = (t) => { bar.querySelector("span").textContent = t; };
  // the dentist reads strategy and stages; the ids stay in the tooltip (DESIGN.md: no plan ids on screen)
  const newText = planWords(state.plan?.plan_id === newId ? { strategy: state.plan.strategy, n_stages: state.plan.info?.n_stages } : state.planRows[newId]);
  const prevText = planWords(state.planRows[prevId]);
  bar.title = `새 계획 ${newId} · 이전 계획 ${prevId}`;
  say(`새 계획(${newText}) · 이전 계획(${prevText})`);
  bar.addEventListener("click", async (e) => {
    const act = e.target.dataset?.act;
    if (!act || state.streaming || state.loading) return;
    if (act === "revert") {
      try {
        await loadPlan(prevId);
        say(`이전 계획(${prevText})으로 되돌렸습니다. 다음 요청은 이 계획에서 이어집니다.`);
        // the model hears about it too, so the next revision starts from the plan on screen
        state.messages.push({ role: "user", content: `[화면 조작] 새 계획을 버리고 이전 계획(${prevId})으로 되돌렸습니다. 다음 요청은 이 계획을 기준으로 해 주세요.` });
      } catch (err) { addMsg("error", "되돌리기 실패: " + err.message); return; }
    } else say(`새 계획(${newText})을 유지합니다.`);
    bar.querySelectorAll("button").forEach((b) => b.remove());
    bar.classList.add("done");
  });
  $("transcript").appendChild(bar);
  $("transcript").scrollTop = $("transcript").scrollHeight;
}

// 「발치 20단계」: a plan in the dentist's words, from a /api/plans row or the plan on screen
function planWords(p) {
  return p ? `${STRATEGY_KO[p.strategy] ?? p.strategy} ${p.n_stages}단계` : "—";
}

function toggle(btn, cls, on) {
  document.body.classList.toggle(cls, on);
  btn.setAttribute("aria-pressed", String(on));
}
$("focusBtn").addEventListener("click", (e) => {
  const on = !document.body.classList.contains("focus3d");
  toggle(e.currentTarget, "focus3d", on);
  e.currentTarget.textContent = on ? "대화" : "크게";
  e.currentTarget.title = on ? "대화 패널을 다시 엽니다" : "대화 패널을 접고 3D를 크게 봅니다";
});
$("overlayBtn").addEventListener("click", (e) => {
  state.overlay = !state.overlay;
  e.currentTarget.setAttribute("aria-pressed", String(state.overlay));
  $("overlayLegend").hidden = !state.overlay;
  ghost.visible = state.overlay && state.stage > 0;
});
$("firstBtn").addEventListener("click", () => { stopPlay(); applyStage(0); });
$("lastBtn").addEventListener("click", () => { if (state.plan) { stopPlay(); applyStage(state.plan.stages.length); } });

// ------------------------------------------------------------------ API helpers
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.detail || ("HTTP " + r.status)); }
  return r.json();
}


function readConstraints() {
  const teeth = (id) => {
    const raw = $(id).value.trim();
    const values = raw ? raw.split(/[ ,]+/).map(Number) : [];
    if (values.some(v => !Number.isInteger(v) || v < 2 || v > 15)) throw new Error("치아 번호는 2~15 정수로 입력하세요.");
    return [...new Set(values)].sort((a,b) => a-b);
  };
  const ipr = Number($("cIpr").value), cap = $("cCap").value === "" ? null : Number($("cCap").value);
  if (!Number.isFinite(ipr) || ipr < 0 || ipr > 0.25) throw new Error("IPR은 면당 0~0.25mm입니다.");
  if (cap !== null && (!Number.isInteger(cap) || cap < 1)) throw new Error("단계 상한은 양의 정수입니다.");
  return { allow_extraction: $("cExtraction").checked, lock: teeth("cLock"), ipr_exclude: teeth("cExclude"),
    ipr_limit_mm: ipr, stage_cap: cap, clear_stage_cap: cap === null, order: $("cOrder").value };
}
function fillConstraints(c) {
  $("cExtraction").checked = c.allow_extraction;
  $("cLock").value = (c.lock || []).join(", ");
  $("cExclude").value = (c.ipr_exclude || []).join(", ");
  $("cIpr").value = c.ipr_limit_mm;
  $("cCap").value = c.stage_cap ?? "";
  $("cOrder").value = c.order;
  renderCondSummary();
}
// The folded conditions line: what the form says, in the dentist's words.
function renderCondSummary() {
  const nums = (v) => v.split(/[,\s]+/).filter(Boolean);
  const parts = [$("cExtraction").checked ? "발치 허용" : "비발치"];
  const lock = nums($("cLock").value), excl = nums($("cExclude").value);
  if (lock.length) parts.push("고정 " + lock.join("·") + "번");
  if (excl.length) parts.push("IPR 제외 " + excl.join("·") + "번");
  parts.push("IPR 면당 " + ($("cIpr").value || "0") + "mm");
  if ($("cCap").value) parts.push("상한 " + $("cCap").value + "단계");
  parts.push($("cOrder").options[$("cOrder").selectedIndex]?.textContent ?? "");
  const text = parts.join(" · "), el = $("condSummary");
  if (el.title && el.title !== text) {
    $("condBox").classList.remove("changed"); void $("condBox").offsetWidth; $("condBox").classList.add("changed");
  }
  // folded over the 3D: one small chip per condition; the full line stays in the tooltip
  el.title = text;
  el.replaceChildren(...text.split(" · ").map((t) => { const c = document.createElement("span"); c.className = "tag"; c.textContent = t; return c; }));
}
function constraintsDirty() {
  if (!state.plan) return false;
  try {
    const c = readConstraints();
    delete c.clear_stage_cap;
    return Object.keys(c).some(k => JSON.stringify(c[k]) !== JSON.stringify(state.plan.constraints[k]));
  } catch { return true; }
}
function updateActions() {
  const p = state.plan, busy = state.streaming || state.loading;
  if (state.meshCase) renderChips();
  const dirty = constraintsDirty(), allowed = p && !busy && !dirty;
  for (const id of ["sendBtn", "fallbackBtn", "caseBtn", "planSelect"]) $(id).disabled = !!busy;
  $("constraints").disabled = !!busy;
  const exportable = allowed && p.passed && !p.input_stale && ["passed", "skipped"].includes(p.review.status);
  $("exportBtn").disabled = !exportable;
  $("exportBtn").textContent = p?.approval ? "STL 내려받기" : "내보내기";
  // why the button is off, in the same order as the gate above; nothing while a turn or a load is running
  $("exportWhy").textContent = exportable || busy ? "" : !p ? "계획이 없습니다" : p.input_stale ? "이전 입력의 계획"
    : dirty ? "조건이 바뀜 · 새 계획 뒤 승인" : !p.passed ? `규칙 위반 ${(p.violations ?? []).length}건 · 조건을 바꿔 다시 계획`
    : "검토 실패 · 검토 다시 요청";
  $("exportSkip").hidden = !["skipped", "not_requested"].includes(p?.review?.status);
  $("revokeBtn").hidden = !p?.approval;
  $("revokeBtn").disabled = !allowed;
  if (!exportable) $("exportPop").hidden = true;
  // Recovery when the agent skipped the reviewer or the review failed: the dentist asks for it on this plan.
  $("reviewBtn").hidden = !p || !["not_requested", "failed"].includes(p.review.status);
  $("reviewBtn").disabled = !allowed;
  const link = $("stlLink");
  if (allowed && p.approval) link.href = "/api/plans/" + encodeURIComponent(p.plan_id) + "/stl.zip";
  else link.removeAttribute("href");
  if (p && dirty) $("planNotice").textContent = "조건 변경됨 — 새 계획을 생성한 뒤 승인하세요. 현재 3D는 이전 계획입니다.";
}
async function approveCurrent() {
  const p = state.plan;
  if (!p || state.streaming || state.loading || constraintsDirty()) return;
  const revoke = !!p.approval;   // the 내보내기 popover asked the question; 승인 취소 needs none
  state.loading = true; updateActions();
  try {
    const result = await api("/api/plans/" + encodeURIComponent(p.plan_id) + "/approval",
      { method: revoke ? "DELETE" : "POST", headers: { "Content-Type": "application/json" },
        ...(revoke ? {} : { body: JSON.stringify({ confirmed: true }) }) });
    if (state.plan?.plan_id === p.plan_id) { state.plan = result; renderResult(result); }
  } catch (e) { addMsg("error", e.message); }
  finally { state.loading = false; updateActions(); }
}

async function reviewCurrent() {
  const p = state.plan;
  if (!p || state.streaming || state.loading || constraintsDirty()) return;
  state.loading = true; updateActions();
  $("rReview").textContent = "검토 중";
  try {
    const result = await api("/api/plans/" + encodeURIComponent(p.plan_id) + "/review", { method: "POST" });
    if (state.plan?.plan_id === p.plan_id) {
      state.plan = result; renderResult(result);
      if (result.review.status === "failed") addMsg("error", result.review.message + " (" + result.review.error + ")");
    }
  } catch (e) {
    addMsg("error", "검토 요청 실패: " + e.message);
    if (state.plan?.plan_id === p.plan_id) renderResult(state.plan);
  }
  finally { state.loading = false; updateActions(); }
}

// ------------------------------------------------------------------ patient flow (start point)
// One modal (#90): new patient on top, existing patients below; a patient opens in place with its scans and an
// upload. The input check is a bar over the 3D (#53), not a screen. Samples sit outside the flow. The alias stays in
// the UI; the chat and tools only see the pseudonymous case id (P0001-S1).
// "patients" = the modal, "patient" = the modal with state.patient open, "check" = the scan in the 3D with the check bar.
function showScreen(name) {
  setHash(name === "patient" ? "#patient=" + state.patient.patient_id : name === "check" ? "#check=" + state.checkCase : "#" + name);
  document.body.classList.remove("start");   // the check shows its scan in the viewer
  const check = name === "check";
  if (!check) endCheck();
  $("checkBar").hidden = !check;
  document.body.classList.toggle("checking", check);
  $("caseGate").hidden = check;
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
  endCheck();
  $("caseGate").hidden = true;
  document.body.classList.add("start");
  lockComposer(true);
}
function lockComposer(on) {
  $("chatInput").disabled = on;
  $("chatInput").placeholder = on ? "케이스를 열면 입력할 수 있습니다" : "처방과 우선순위를 적어 주세요";
}
lockComposer(true);
function leaveStart() {
  document.body.classList.remove("start");
  lockComposer(false);
}
// Each screen gets an address (#start, #case=<id>[&plan=<planId>], #patients, #patient=<id>, #check=<case>) so the browser's back
// and forward buttons move between screens (#90). Moves made by back/forward replace instead of pushing.
let routing = false;
function setHash(h) {
  if (location.hash === h) return;
  if (routing) history.replaceState(null, "", h); else history.pushState(null, "", h);
}
async function route(hash) {
  // key=value pairs split by "&": #case=<id>&plan=<planId>; the first pair names the screen
  const pairs = decodeURIComponent(hash.slice(1)).split("&").map((kv) => { const i = kv.indexOf("="); return i < 0 ? [kv, ""] : [kv.slice(0, i), kv.slice(i + 1)]; });
  const [key, id] = pairs[0], plan = Object.fromEntries(pairs).plan;
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
          && [...$("planSelect").options].some((o) => o.value === plan)) await loadPlan(plan);
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

// Agent panel width: drag the splitter, arrow keys move it, double click resets. Kept per browser.
const CHAT_MIN = 300, VIEWER_MIN = 420;
function setChatWidth(px) {
  const layout = document.querySelector(".layout");
  if (px == null) { layout.style.removeProperty("--chat-w"); localStorage.removeItem("cualign.chatWidth"); return; }
  px = Math.round(Math.max(CHAT_MIN, Math.min(px, layout.clientWidth - VIEWER_MIN - 6)));
  layout.style.setProperty("--chat-w", px + "px");
  localStorage.setItem("cualign.chatWidth", px);
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
    setChatWidth(e.clientX - document.querySelector(".layout").getBoundingClientRect().left);
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
const fmtDate = (iso) => (iso ?? "").slice(0, 16).replace("T", " ");

// The patient list of the modal. `open` (a GET /api/patients/{id} payload) is shown expanded with its scans.
async function loadPatients(open = null) {
  const { patients } = await api("/api/patients");
  const wrap = $("patientCards"), body = $("patientBody");
  body.hidden = true; $("screenPatients").append(body);   // keep the shared body out of the list being rebuilt
  wrap.innerHTML = "";
  if (!patients.length) wrap.innerHTML = '<p class="empty">등록된 환자가 없습니다. 위에서 새 환자를 등록하세요.</p>';
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
  if (!p.scans.length) list.innerHTML = '<p class="empty">아직 스캔이 없습니다. 아래에 상악 스캔을 올리세요.</p>';
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
    if (state.patient?.patient_id === pid) $("uploadStatus").textContent = "업로드 실패: " + e.message;
  }
}

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
    el.textContent = id;
    const obj = new CSS2DObject(el);
    obj.position.copy(state.center[id]);
    obj.position.z = m.geometry.boundingBox.max.z + 1.5;
    group.add(obj);
    state.numLabels.push(obj);
  }
  // the check facts in one line, in the dentist's words
  const o = check.orientation;
  const facts = [["입력 확인"], [`치아 ${check.n_teeth}개` + (check.missing.length ? ` (빠진 치아 ${check.missing.join(", ")}번)` : "")],
    [check.scanned_gingiva ? "잇몸 포함" : "잇몸 없음 · 표시용 잇몸"]];
  if (check.outside.length) facts.push([`스캔에 없는 끝 치아 ${check.outside.join(", ")}번`]);
  if (Object.keys(rot).length) facts.push([`회전 보정 ${Object.keys(rot).join("·")}번 (주황)`]);
  if (Object.keys(vert).length) facts.push([`높이 보정 ${Object.keys(vert).join("·")}번 (파랑)`]);
  if (o?.basis === "none") facts.push(["방향 근거 없음 — 교합면 방향 확인 필요", "warn"]);
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
  $("caseName").textContent = (state.patient ? state.patient.alias + " · " : "") + sid + " · 입력 확인 중";
  showScreen("check");
}

// The case card on the panel top: a sample shows its thumbnail, finding and prescription; a scan its alias.
function renderCaseCard(caseId, info) {
  const s = sampleOf(caseId), thumb = $("caseThumb");
  thumb.hidden = !s; $("caseKind").hidden = !s;
  if (s) thumb.src = `samples/${encodeURIComponent(caseId)}.png`;
  $("caseName").textContent = s ? s.title : caseTitle(caseId, info.crowding_mm);
  $("caseSub").textContent = s ? s.summary : `총생 ${info.crowding_mm} mm`;
  $("caseSub").title = s ? "처방 · " + s.prescription : "";
  $("caseBadges").replaceChildren(...(s ? badgeTags(s.badges) : []));
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
  const wrap = $("sampleCards");
  wrap.innerHTML = "";
  for (const c of cases.filter((x) => x.kind !== "synthetic")) {
    const b = document.createElement("button");
    b.className = "case-card";
    b.dataset.id = c.case_id;
    b.innerHTML = `<span class="cid"></span><span class="rx"></span><span class="badges"></span><span class="meta"></span>`;
    if (c.kind === "sample") {
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = `${c.case_id} 교합면`;
      img.src = `samples/${encodeURIComponent(c.case_id)}.png`;
      b.prepend(img);
      // the card shows the finding and the prescription only; the case number and tooth numbering come after it opens (#90)
      b.querySelector(".cid").textContent = c.title;
      b.querySelector(".rx").textContent = c.summary;
      b.querySelector(".badges").replaceChildren(...badgeTags(c.badges));
      b.title = "처방 · " + c.prescription;
      b.querySelector(".meta").textContent = c.available ? "" : "샘플 파일이 설치되지 않았습니다";
      b.disabled = !c.available;
    } else {
      b.querySelector(".cid").textContent = c.case_id;
      b.querySelector(".meta").textContent = `상악 · ${c.kind}`;
    }
    wrap.appendChild(b);
  }
  if (!wrap.children.length) wrap.innerHTML = '<p class="empty">샘플 케이스가 없습니다. 아래 «내 스캔 올리기»로 시작하세요.</p>';
  return active;
}

function sameConstraints(a, b) {
  const keys = ["allow_extraction", "lock", "ipr_exclude", "ipr_limit_mm", "stage_cap", "order"];
  return !!a && !!b && keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}

function sampleOf(caseId) {
  return state.cases.find((c) => c.case_id === caseId && c.kind === "sample") ?? null;
}

// Three example sentences for the situation (DESIGN.md 「칩」): the sample's prescription first, then two ways to
// go on; once a plan exists, revisions instead.
function renderChips() {
  const sample = sampleOf(state.meshCase);
  // short labels on the chip; the full sentence is what gets sent
  const chips = state.messages.some((m) => m.role === "user")
    ? [{ label: "13번 고정하고 재계획", message: "13번은 움직이지 말고 다시 짜줘." },
       { label: "앞니 IPR 제외", message: "IPR은 앞니(7~10번) 빼고 해줘." },
       { label: "전략 비교", message: "이 처방 안에서 확장안과 IPR안을 비교해줘." }]
    : [sample ? { label: "에이전트 계획", message: sample.request } : { label: "발치 없이 계획", message: "발치 없이 계획을 짜줘." },
       { label: "발치 없이 12개월", message: "발치 없이 12개월 안에 끝나는 계획 짜줘. 앞니 총생부터 풀고." },
       { label: "확장안·IPR안 비교", message: "이 처방 안에서 확장안과 IPR안을 비교해줘." }];
  const box = $("chips");
  if ([...box.children].map((c) => c.dataset.message).join("|") === chips.map((c) => c.message).join("|")) return;
  box.innerHTML = "";
  for (const c of chips) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = c.label; b.dataset.message = c.message; b.title = c.message;
    box.appendChild(b);
  }
}

async function activateCase(caseId, { greet = true } = {}) {
  if (state.streaming || state.loading) return;
  ++state.selectionVersion;
  state.requestId = null;
  state.messages = [];
  stopPlay();
  if (caseId !== state.meshCase) { group.clear(); ghost.clear(); clearLabels(); state.meshCase = null; }
  const info = await api(`/api/cases/${encodeURIComponent(caseId)}/activate`, { method: "POST" });
  $("transcript").innerHTML = "";   // a conversation belongs to one patient scan
  await loadMesh(caseId);
  resetPlanPanel();
  fillConstraints(info.constraints);
  await refreshPlans();
  renderCaseCard(caseId, info);
  state.activeCase = caseId;
  renderChips();
  $("caseGate").hidden = true;
  endCheck();
  setHash("#case=" + caseId);
  leaveStart();
  if (greet) {
    // The agent opens the conversation (clinical SW: case first, then constraints). Kept in the transcript
    // the model sees, so it knows which case is on screen.
    const sample = sampleOf(caseId);
    const asPrescribed = sample && sameConstraints(info.constraints, sample.constraints);
    const text = `케이스 ${caseId} (상악 ${info.n_teeth}개 치아, 총생 ${info.crowding_mm} mm) 를 불러왔습니다. ` + (sample
      ? (asPrescribed
        ? `의사 처방(${sample.prescription})을 계획 조건에 넣어 두었습니다.` + (sample.note ? ` ${sample.note}` : "")
        : `이 케이스에서 전에 바꾼 계획 조건이 남아 있습니다. 처방(${sample.prescription})과 다르니 조건 칸을 확인해 주세요.`)
      : `계획을 시작하려면 제약을 알려 주세요.`);
    // no bubble: the case card on the panel top already says it; only a changed prescription is worth a line
    if (sample && !asPrescribed) addMsg("system", "조건이 처방과 다릅니다 — 3D 왼쪽 위 조건을 확인해 주세요.");
    // the case opens with a rule-based preview of the prescription (#92): the first question is how to refine it
    const q = sample
      ? { question: "처방을 반영한 미리보기입니다(규칙 계산, 검토 없음). 이 초안을 어떻게 다듬을까요?",
          options: [{ label: "에이전트 계획(검토 포함)", message: sample.request },
                    { label: "기간 상한 정하기", fill: "발치 없이 12개월 안에 끝나는 계획 짜줘. 앞니 총생부터 풀고." },
                    { label: "확장안·IPR안 비교", message: "이 처방 안에서 확장안과 IPR안을 비교해줘." }] }
      : { question: "발치는 허용되나요? 기간 상한이 있으면 함께 알려 주세요.",
          options: [{ label: "발치 없이 계획", message: "발치 없이 계획을 짜줘." },
                    { label: "발치 허용하고 계획", message: "발치를 허용하고 계획을 짜줘." },
                    { label: "기간 상한 정하기", fill: "발치 없이 12개월 안에 끝나는 계획 짜줘." }] };
    state.messages.push({ role: "assistant", content: text + " " + q.question });
    addQuestion(q);
  }
}

function resetPlanPanel() {
  stopPlay();
  state.plan = null;
  document.body.classList.remove("has-plan");
  clearLabels(); applyStage(0);
  $("planSelect").innerHTML = '<option value="">계획 선택…</option>';
  for (const id of ["rPlan", "rParent", "rReview", "rApproval", "rStrategy", "rStages", "rMonths", "rViol"]) $(id).textContent = "—";
  $("viewCanvas").dataset.planId = "";
  $("resultCard").dataset.planId = "";
  $("reviewMemo").textContent = "";
  $("planNotice").textContent = "계획 없음";
  $("stageSlider").disabled = true;
  $("stageMarks").innerHTML = "";
  $("violTable").querySelector("tbody").innerHTML = "";
  setBadge("계획 없음", "neutral");
  updateActions();
}

async function loadMesh(caseId) {
  if (!caseId || caseId === state.meshCase) return;
  const mesh = await api(`/api/cases/${encodeURIComponent(caseId)}/mesh`);
  state.meshCase = caseId;
  state.plan = null;
  buildTeeth(mesh);
  applyStage(0);
}


const STRATEGY_ORDER = ["expansion", "ipr", "expansion_ipr", "extraction"];

function preferredPlanId(plans) {
  if (!plans.length) return null;
  const parent = plans[0].parent_plan_id ?? null;
  const batch = plans.filter((p) => (p.parent_plan_id ?? null) === parent);
  const ranked = [...batch].sort((a, b) => STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy));
  return (ranked.find((p) => p.passed) ?? ranked[0] ?? plans[0]).plan_id;
}

async function refreshPlans(selectId) {
  const caseId = state.meshCase, generation = state.selectionVersion;
  const { plans } = await api("/api/plans?case_id=" + encodeURIComponent(caseId));
  if (caseId !== state.meshCase || generation !== state.selectionVersion) return;
  const sel = $("planSelect");
  sel.innerHTML = '<option value="">계획 선택…</option>';
  // how many plans are new since the last refresh of this case: a turn that made several (a comparison) gets a plan card
  const known = state.planRowsCase === caseId ? state.planRows : null;
  state.newPlans = known ? plans.filter((p) => !(p.plan_id in known)).length : 0;
  state.planRows = Object.fromEntries(plans.map((p) => [p.plan_id, p]));
  state.planRowsCase = caseId;
  for (const p of plans) {
    const o = document.createElement("option");
    o.value = p.plan_id;
    o.textContent = `${STRATEGY_KO[p.strategy] ?? p.strategy} · ${p.n_stages}단계 · ${p.passed ? "통과" : "위반"}`;
    o.title = p.plan_id;
    sel.appendChild(o);
  }
  const id = selectId ?? state.plan?.plan_id ?? preferredPlanId(plans);
  if (id) { sel.value = id; await loadPlan(id); }
}

async function loadPlan(planId) {
  if (!planId) { $("planSelect").value = state.plan?.plan_id ?? ""; return; }
  const version = ++state.selectionVersion, caseId = state.meshCase;
  state.loading = true; updateActions();
  $("planNotice").textContent = "계획 불러오는 중 — 다운로드 잠김";
  try {
    const plan = await api("/api/plans/" + encodeURIComponent(planId));
    if (version !== state.selectionVersion || caseId !== state.meshCase) return;
    if (plan.case_id !== caseId) throw new Error("선택 케이스와 계획이 다릅니다.");
    stopPlay();
    state.plan = plan;
    fillConstraints(plan.constraints);
    const slider = $("stageSlider");
    slider.max = plan.stages.length;
    slider.disabled = false;
    buildIprLabels(); applyStage(0); renderResult(plan); renderStageMarks();
    document.body.classList.add("has-plan");
    $("planSelect").value = planId;
    $("viewCanvas").dataset.planId = planId;
    $("resultCard").dataset.planId = planId;
    $("planNotice").textContent = "표시 중인 계획: " + planId;
    // the plan joins the address: a new plan pushes, so back/forward walk through plans; while routing it replaces
    if (state.activeCase === caseId) setHash(`#case=${caseId}&plan=${planId}`);
  } catch (e) {
    if (version === state.selectionVersion) {
      $("planNotice").textContent = "계획 로드 실패 — 이전 결과를 유지합니다.";
      throw e;
    }
  } finally {
    if (version === state.selectionVersion) { state.loading = false; updateActions(); }
  }
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
  $("rParent").textContent = plan.parent_plan_id ?? "최초 계획";
  const review = plan.review;
  $("rReview").textContent = ({not_requested:"미실행",running:"검토 중",passed:"메모 생성 완료",failed:"검토 실패",skipped:"미실행 (규칙 폴백)"})[review.status] || review.status;
  const memo = splitNote(review.message + (review.error ? " (" + review.error + ")" : ""));
  $("reviewMemo").innerHTML = esc(memo.body.trim()) + (memo.note ? `<small class="note">${esc(memo.note)}</small>` : "");
  $("rApproval").textContent = plan.approval ? "의사 승인됨 · " + plan.approval.approved_at : "미승인";

  if (plan.input_stale) setBadge("이전 입력의 계획 — 승인·출력 불가", "fail");
  else if (plan.passed || viol.length === 0) setBadge(["passed", "running", "failed"].includes(plan.review?.status) ? "규칙 통과 (의사 검토 전 초안)" : "처방 미리보기 · 규칙 통과 (검토 없음)", "pass");
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
const TOOL_KO = { load_case: "케이스 읽기", list_cases: "케이스 목록", clinical_limits: "임상 한계 읽기", get_constraints: "조건 읽기",
  set_constraints: "조건 설정", propose_target: "목표 배열 제안", plan_stages: "단계 계획", validate: "규칙 검증",
  compare_strategies: "전략 비교", select_plan: "계획 선택", export_stl: "STL 내보내기", get_plan: "계획 읽기",
  load_skill: "임상 규칙 읽기", reviewer: "검토" };
const STRATEGY_KO = { expansion: "확장", ipr: "IPR", expansion_ipr: "확장 + IPR", extraction: "발치" };
function toolKo(name) {
  const n = (name ?? "").replace(/^Function (Start|End): /, "").replace(/^cualign__/, "");
  if (n.startsWith("fallback: ")) return "규칙 기반 " + (STRATEGY_KO[n.slice(10)] ?? n.slice(10));
  return TOOL_KO[n] ?? n;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
  const div = document.createElement("div");
  div.className = "review-q";
  div.innerHTML = "<b>검토 질문</b><ul></ul>";
  for (const q of qs) { const li = document.createElement("li"); li.textContent = q; div.querySelector("ul").append(li); }
  bubble.after(div);
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
// inside the transcript right before the assistant bubble. Click a row to expand the raw payload.
function newTrace() {
  const box = document.createElement("details");
  box.className = "trace";
  box.innerHTML = '<summary><span class="dot">\u25CF</span><span class="text"></span></summary><div class="rows"></div>';
  $("transcript").appendChild(box);
  return { box, el: box.querySelector(".rows"), rows: new Map() };
}
// The folded line reads as progress while a tool runs and as the list of tools used when the turn is done.
const RUN_KO = { "케이스 읽기": "케이스를 읽는 중", "케이스 목록": "케이스 목록을 읽는 중", "임상 한계 읽기": "임상 한계를 읽는 중",
  "조건 읽기": "조건을 읽는 중", "조건 설정": "조건을 반영하는 중", "목표 배열 제안": "목표 배열을 제안하는 중", "단계 계획": "단계를 나누는 중",
  "규칙 검증": "규칙을 검증하는 중", "전략 비교": "전략을 비교하는 중", "계획 선택": "계획을 고르는 중", "STL 내보내기": "STL을 내보내는 중",
  "계획 읽기": "계획을 읽는 중", "임상 규칙 읽기": "임상 규칙을 읽는 중", "검토": "계획을 검토하는 중", "모델 추론": "생각하는 중" };
function traceSummary(trace) {
  const rows = [...trace.el.children];
  const running = rows.find((r) => r.classList.contains("running"));
  trace.box.classList.toggle("running", !!running);
  const names = [...new Set(rows.map((r) => r.querySelector(".name").textContent))].filter((n) => n !== "모델 추론");
  trace.box.querySelector(".text").textContent = running
    ? (RUN_KO[running.querySelector(".name").textContent] ?? running.querySelector(".name").textContent + " 중") + "…"
    : (names.length ? `도구 ${rows.length}회 · ` + names.join(" → ") : `모델 응답 ${rows.length}회`);
  if (trace === state.trace) setWorkNote(running ? trace.box.querySelector(".text").textContent : null);
}
// While a turn runs the 3D dims and a pill over it repeats the running trace line (body.streaming).
const WORK_DEFAULT = "계획을 준비하는 중…";
function setWorkNote(text) { $("workNote").querySelector("span").textContent = text || WORK_DEFAULT; }
function setStreaming(on) {
  state.streaming = on;
  document.body.classList.toggle("streaming", on);
  setWorkNote(null);
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
  row.querySelector(".name").textContent = isLlm ? "모델 추론" : toolKo(label);
  row.querySelector(".args").textContent = isLlm ? ` (${label})` : (input ? `(${argsSummary(input)})` : "");
  const done = !!output;
  row.querySelector(".arrow").style.visibility = done ? "visible" : "hidden";
  row.querySelector(".out").textContent = done ? (isLlm ? output.replace(/\s+/g, " ").slice(0, 110) : outSummary(label, output)) : "";
  row.classList.toggle("running", !done);
  row.querySelector("pre").textContent = text ?? "";
  traceSummary(trace);
  $("transcript").scrollTop = $("transcript").scrollHeight;
}

// The agent's question card (#90): the question and two or three choices. A choice with a message is sent as the
// dentist's turn; a choice with `fill` only puts a sentence in the composer to edit.
function addQuestion(q) {
  if (!q?.question || !(q.options?.length >= 2)) return null;
  const div = document.createElement("div");
  div.className = "question";
  div.innerHTML = '<p></p><div class="opts"></div>';
  div.querySelector("p").textContent = q.question;
  for (const o of q.options) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = o.label;
    b.dataset.message = o.message ?? ""; b.dataset.fill = o.fill ?? ""; b.dataset.action = o.action ?? "";
    div.querySelector(".opts").appendChild(b);
  }
  div.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || state.streaming || state.loading) return;
    if (b.dataset.fill) { $("chatInput").value = b.dataset.fill; autosize(); $("chatInput").focus(); return; }
    const picked = document.createElement("span");
    picked.className = "picked"; picked.textContent = b.textContent;
    div.querySelector(".opts").replaceWith(picked);
    div.classList.add("done");
    if (b.dataset.action === "export") { $("exportBtn").disabled ? addMsg("system", "내보내기: " + $("exportWhy").textContent) : $("exportBtn").click(); return; }
    send(b.dataset.message);
  });
  $("transcript").appendChild(div);
  $("transcript").scrollTop = $("transcript").scrollHeight;
  return div;
}
// After each answer the server's fast model writes the next question; no card when it cannot. The request starts
// when the stream ends (it overlaps the plan reload); a muted placeholder holds the card's place until it answers.
// The demo path (preview → agent plan → time cap or comparison → export) is written down, keyed by the sentence
// the dentist just sent; off that path the server's fast model writes the question (#90 혼합).
const COMPARE = "이 처방 안에서 확장안과 IPR안을 비교해줘.";
const SCRIPT = [
  { when: (t, s) => s && t === s.request,
    q: { question: "처방대로 에이전트가 계획하고 검토했습니다. 조건을 더 다듬을까요?",
         options: [{ label: "12개월 안에", message: "12개월 안에 끝나게 다시 짜줘." },
                   { label: "확장안·IPR안 비교", message: COMPARE },
                   { label: "이대로 내보내기", action: "export" }] } },
  { when: (t) => /12개월 안에 끝나게 다시 짜줘/.test(t),
    q: { question: "기간을 맞춘 계획입니다. 다음은 어떻게 할까요?",
         options: [{ label: "앞니 먼저 풀기", message: "앞니 총생부터 먼저 풀도록 다시 짜줘." },
                   { label: "확장안·IPR안 비교", message: COMPARE },
                   { label: "이대로 내보내기", action: "export" }] } },
  { when: (t) => t === COMPARE,
    q: { question: "두 안을 비교했습니다. 어느 쪽으로 갈까요?",
         options: [{ label: "확장안으로", message: "확장안으로 계획해줘." },
                   { label: "IPR안으로", message: "IPR안으로 계획해줘." },
                   { label: "기간 상한 12개월", message: "12개월 안에 끝나게 다시 짜줘." }] } },
  { when: (t) => /^(확장안|IPR안)으로 계획해줘/.test(t) || /앞니 총생부터 먼저/.test(t),
    q: { question: "이 안으로 진행할까요?",
         options: [{ label: "이대로 내보내기", action: "export" },
                   { label: "13번 고정하고 재계획", message: "13번은 움직이지 말고 다시 짜줘." },
                   { label: "앞니 IPR 제외", message: "IPR은 앞니(7~10번) 빼고 해줘." }] } },
];
function scriptedFollowup() {
  const last = [...state.messages].reverse().find((m) => m.role === "user")?.content?.replace(/^\[선택한 치아:[^\]]*\]\s*/, "").trim() ?? "";
  const sample = sampleOf(state.meshCase);
  return SCRIPT.find((s) => s.when(last, sample))?.q ?? null;
}
function requestFollowup() {
  const scripted = scriptedFollowup();
  if (scripted) return Promise.resolve(scripted);
  return api("/api/followup", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: state.messages.slice(-8) }) }).then((r) => r.question ?? null, () => null);
}
async function askFollowup(caseId, pending = requestFollowup()) {
  const ph = document.createElement("div");
  ph.className = "question pending";
  ph.innerHTML = '<p>다음 질문을 준비하는 중…</p><div class="opts"></div>';
  $("transcript").appendChild(ph);
  $("transcript").scrollTop = $("transcript").scrollHeight;
  const question = await pending;   // never rejects: the card is optional
  const card = question && state.meshCase === caseId && !state.streaming && ph.isConnected ? addQuestion(question) : null;
  if (card) ph.replaceWith(card); else ph.remove();
}
// The plan a turn produced, as a card in the transcript; 열기 shows it in the 3D and the result panel.
function addPlanCard(plan) {
  if (!plan?.plan_id || state.newPlans < 2) return;   // a single plan turn: the 3D and the decision bar say enough
  const viol = plan.violations ?? [];
  const review = ({ not_requested: "검토 미실행", running: "검토 중", passed: "검토 완료", failed: "검토 실패", skipped: "검토 생략(규칙 기반)" })[plan.review?.status] ?? "";
  const div = document.createElement("div");
  div.className = "plan-card";
  div.innerHTML = '<div class="t"><b></b><small></small></div><button class="btn ghost small" type="button">열기</button>';
  div.querySelector("b").textContent = `${STRATEGY_KO[plan.strategy] ?? plan.strategy ?? "계획"} · ${plan.info?.n_stages ?? "?"}단계 · 약 ${plan.info?.months ?? "?"}개월 · ${viol.length ? "위반 " + viol.length + "건" : "규칙 통과"}`;
  div.querySelector("small").textContent = `비교한 ${state.newPlans}개 중 선택 · ${plan.parent_plan_id ? "이전 안에서 수정" : "최초 계획"} · ${review}`;
  div.title = plan.plan_id + (plan.parent_plan_id ? " ← " + plan.parent_plan_id : "");
  div.querySelector("button").addEventListener("click", () => {
    loadPlan(plan.plan_id).then(() => document.querySelector(".result").scrollIntoView({ behavior: "smooth" }))
      .catch((err) => addMsg("error", err.message));
  });
  $("transcript").appendChild(div);
  $("transcript").scrollTop = $("transcript").scrollHeight;
}


// `constraints` and `resend` come from the 다시 보내기 button: the same text and form values as the failed request,
// a fresh request id, and the failed turn's user message replaced rather than repeated in the transcript the model sees.
async function send(text, constraints = null, { resend = false } = {}) {
  text = (text ?? "").trim();
  if (!text || state.streaming || state.loading) return;
  if (!state.meshCase) { showStart(); return; }
  if (constraints === null) {
    try { constraints = readConstraints(); } catch (e) { addMsg("error", e.message); return; }
  }
  if (state.selected.size && !resend) {
    text = `[선택한 치아: ${[...state.selected].sort((a, b) => a - b).join(", ")}번] ` + text;
    state.selected.clear(); renderSelection();
  }
  const requestId = crypto.randomUUID(), caseId = state.meshCase, prevPlanId = state.plan?.plan_id ?? null;
  state.requestId = requestId;
  setStreaming(true); updateActions();
  $("retryBar").hidden = true;
  $("planNotice").textContent = state.plan ? "재계획 중 — 현재 3D는 이전 계획입니다." : "계획 생성 중";
  $("chatInput").value = ""; autosize();
  if (resend && state.messages.at(-1)?.role === "user" && state.messages.at(-1).content === text) state.messages.pop();
  state.messages.push({ role: "user", content: text });
  state.lastRequest = { text, constraints };
  addMsg("user", text);
  state.trace = newTrace();
  const bubble = addMsg("assistant", "");
  let answer = "", selected = null, streamError = false, overload = null;
  const handle = ({type, data: obj}) => {
    if (type === "plan_selected") {
      if (matchesSelection(obj, state.requestId, state.meshCase)) selected = obj;
    } else if (type === "plan_context") {
      if (obj.request_id === state.requestId && obj.case_id === state.meshCase) fillConstraints(obj.constraints);
    } else if (type === "plan_error" || type === "error" || obj.code) {
      streamError = true; addStep("error", obj, "fallback");
      if (obj.kind === "nim_overload" && obj.request_id === state.requestId) overload = obj;  // the server's sentence
    } else if (type === "intermediate_data") {
      addStep(obj.name ?? "step", obj.payload ?? "", "", state.trace, obj.id ?? null);
    } else if (type === "data") {
      const ch = obj.choices?.[0], delta = ch?.delta?.content ?? ch?.message?.content ?? obj.value ?? "";
      if (typeof delta === "string") { answer += delta; setAnswer(bubble, answer); }
    }
  };
  try {
    const r = await fetch("/chat/stream", { method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages: state.messages, cualign: { request_id: requestId,
        case_id: caseId, base_plan_id: state.plan?.plan_id ?? null, constraints } }) });
    if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
    const reader = r.body.getReader(), parser = new PlanStream();
    for (;;) {
      const {value, done} = await reader.read();
      for (const event of parser.push(value, done)) handle(event);
      if (done) break;
    }
    if (state.requestId !== requestId || state.meshCase !== caseId) return;
    if (answer) state.messages.push({ role: "assistant", content: answer });
    state.lastAssistantText = answer;
    const followup = answer && !streamError ? requestFollowup() : null;   // overlaps the plan reload below
    if (selected && !streamError) {
      await refreshPlans(selected.plan_id);
      if (state.plan?.plan_id === selected.plan_id && state.plan.review?.status === "passed") addReviewQuestions(bubble, state.plan.review.message);
      addPlanCard(state.plan);
      addDecision(prevPlanId, selected.plan_id);
      if (!answer) bubble.textContent = "계획은 생성됐지만 모델의 최종 설명은 비어 있습니다.";
      if (selected.reviewed_by_server) addMsg("system", "에이전트가 검토를 호출하지 않아 서버가 같은 조건으로 검토를 실행했습니다.");
      if (selected.review.status === "failed") addMsg("error", selected.review.message + " (" + selected.review.error + ")");
    } else if (streamError || !answer) {
      throw new Error(overload?.message || "모델 실행 또는 최종 계획 선택 실패");
    } else {
      $("planNotice").textContent = "새 계획 선택 없음 — 대화 내용을 확인하세요.";
    }
    if (followup) askFollowup(caseId, followup);   // not awaited: the card arrives when the fast model answers
  } catch (e) {
    if (answer) setAnswer(bubble, answer); else bubble.remove();
    $("planNotice").textContent = "재계획 실패 — 현재 3D는 이전 계획입니다.";
    addMsg("error", overload
      ? overload.message + " 잠시 뒤 「다시 보내기」를 누르거나, 모델 없이 규칙 기반으로 계산할 수 있습니다."
      : "계획을 받지 못했습니다 (" + e.message + "). 같은 요청을 다시 보내거나, 모델 없이 규칙 기반으로 계산할 수 있습니다.");
    if (state.requestId === requestId) $("retryBar").hidden = false;
  } finally {
    if (state.requestId === requestId) { setStreaming(false); updateActions(); }
  }
}

// ------------------------------------------------------------------ fallback / upload

async function runFallback() {
  const caseId = state.meshCase;
  if (!caseId || state.streaming || state.loading) return;
  let constraints;
  try { constraints = readConstraints(); } catch (e) { addMsg("error", e.message); return; }
  setStreaming(true); updateActions();
  addMsg("system", "규칙 기반 폴백 — 화면의 조건으로 계산합니다. 검토 에이전트는 실행하지 않습니다.");
  $("planNotice").textContent = "조건을 반영해 새 계획 계산 중";
  state.trace = newTrace();
  try {
    const res = await api("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: caseId, parent_plan_id: state.plan?.plan_id ?? null, ...constraints }) });
    for (const t of res.tried ?? []) addStep("fallback: " + t.strategy, t, "fallback");
    const selected = res.chosen || res.best_failed, prevPlanId = state.plan?.plan_id ?? null;
    if (selected) { await refreshPlans(selected.plan_id); addPlanCard(state.plan); addDecision(prevPlanId, selected.plan_id); }
    if (!res.chosen) addMsg("system", "허용 전략 전부 규칙 위반 — 의사 승인이 제한됩니다.");
  } catch (e) {
    addMsg("error", "폴백 실패: " + e.message);
    $("planNotice").textContent = "재계획 실패 — 이전 결과를 유지합니다.";
  } finally { setStreaming(false); updateActions(); }
}

// ------------------------------------------------------------------ stage playback
function stopPlay() { if (state.playing) { clearInterval(state.playing); state.playing = null; $("playBtn").textContent = "▶"; } }
function togglePlay() {
  if (!state.plan) return;
  if (state.playing) return stopPlay();
  $("playBtn").textContent = "⏸";
  state.playing = setInterval(() => {
    const n = state.plan.stages.length;
    applyStage(state.stage >= n ? 0 : state.stage + 1);
  }, 350);
}

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
$("homeBtn").addEventListener("click", () => showStart().catch((err) => addMsg("error", err.message)));
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("chatInput").value); } });
$("chips").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) send(c.dataset.message); });
$("resendBtn").addEventListener("click", () => {
  const last = state.lastRequest;
  if (last) send(last.text, last.constraints, { resend: true });
});
$("sampleCards").addEventListener("click", async (e) => {
  const card = e.target.closest(".case-card");
  if (!card || state.streaming || state.loading) return;
  state.patient = null;
  // the pane fades while the mesh loads; leaveStart() drops both classes when the workspace is ready
  card.classList.add("picked");
  document.body.classList.add("leaving");
  try { await activateCase(card.dataset.id); }
  catch (err) { addMsg("error", `케이스 로드 실패: ${err.message}`); }
  finally { document.body.classList.remove("leaving"); card.classList.remove("picked"); }
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
    $("pScansName").textContent = "누르면 파일 선택 창이 열립니다. 나중에 올려도 됩니다.";
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
$("pScans").addEventListener("change", (e) => {
  const n = e.target.files.length;
  $("pScansName").textContent = n ? `${n}개 파일 선택됨 — 등록하면 바로 올라갑니다` : "누르면 파일 선택 창이 열립니다. 나중에 올려도 됩니다.";
});
$("scanInput").addEventListener("change", (e) => { uploadScan([...e.target.files]); e.target.value = ""; });
for (const ev of ["dragenter", "dragover"]) $("dropZone").addEventListener(ev, (e) => { e.preventDefault(); $("dropZone").classList.add("over"); });
for (const ev of ["dragleave", "drop"]) $("dropZone").addEventListener(ev, (e) => { e.preventDefault(); $("dropZone").classList.remove("over"); });
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
$("mirrorBtn").addEventListener("click", async () => {
  const caseId = state.checkCase;
  const [pid, sid] = (caseId ?? "").split("-");
  if (!confirm("치아 파일 번호를 좌우로 뒤집습니다 (2↔15, 3↔14 …). 계속할까요?")) return;
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
$("introPick").addEventListener("click", () => $("sampleCards").querySelector(".case-card:not(:disabled)")?.focus());
$("gateClose").addEventListener("click", async () => {
  // no case open yet: the start state (the sample cards) is where the modal came from
  if (!state.activeCase) { showStart().catch((err) => addMsg("error", err.message)); return; }
  $("caseGate").hidden = true;
  setHash("#case=" + state.activeCase);
  // the input check may have put another scan in the viewer: go back to the case being planned, whose
  // constraints and chips are still on screen (#70 review)
  if (state.meshCase !== state.activeCase) {
    try { await loadMesh(state.activeCase); await refreshPlans(); } catch (err) { addMsg("error", err.message); }
  }
});
$("planSelect").addEventListener("change", (e) => loadPlan(e.target.value).catch((err) => addMsg("error", `계획 로드 실패: ${err.message}`)));
$("stageSlider").addEventListener("input", (e) => { stopPlay(); applyStage(+e.target.value); });
$("playBtn").addEventListener("click", togglePlay);
$("fallbackBtn").addEventListener("click", runFallback);
$("retryFallback").addEventListener("click", () => { $("retryBar").hidden = true; runFallback(); });
$("exportBtn").addEventListener("click", () => {
  if (state.plan?.approval) { $("stlLink").click(); return; }
  $("exportPop").hidden = !$("exportPop").hidden;
});
$("exportCancel").addEventListener("click", () => { $("exportPop").hidden = true; });
$("exportGo").addEventListener("click", async () => {
  $("exportPop").hidden = true;
  if (!state.plan?.approval) await approveCurrent();
  if (state.plan?.approval && $("stlLink").hasAttribute("href")) $("stlLink").click();
});
// One transcript card per approval once its STL download starts; 다시 내려받기 clicks the same link again.
const doneCards = new Set();
$("stlLink").addEventListener("click", () => {
  const p = state.plan, link = $("stlLink");
  if (!p?.approval || !link.hasAttribute("href")) return;
  const key = p.plan_id + "@" + p.approval.approved_at;
  if (doneCards.has(key)) return;
  doneCards.add(key);
  const div = document.createElement("div");
  div.className = "done export-done";
  div.innerHTML = '<span></span><button class="btn ghost small" type="button">다시 내려받기</button>';
  div.querySelector("span").textContent = `승인 완료 · 단계별 STL ${p.stages?.length ?? p.info?.n_stages ?? "?"}장을 내려받았습니다`;
  div.querySelector("button").addEventListener("click", () => {
    if (state.plan?.plan_id === p.plan_id && link.hasAttribute("href")) link.click();
  });
  $("transcript").appendChild(div);
  $("transcript").scrollTop = $("transcript").scrollHeight;
});
$("revokeBtn").addEventListener("click", approveCurrent);
$("reviewBtn").addEventListener("click", reviewCurrent);
$("constraints").addEventListener("input", () => { renderCondSummary(); updateActions(); });
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerleave", () => { $("tip").hidden = true; });
for (const b of document.querySelectorAll(".view-rail button[data-view]")) b.addEventListener("click", () => setView(b.dataset.view));

(async function init() {
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
  if (active) document.querySelector(`.case-card[data-id="${CSS.escape(active)}"]`)?.classList.add("current");
  // a reload or a shared address opens the same screen; otherwise this is the start state
  if (location.hash && location.hash !== "#start") {
    routing = true;
    try { await route(location.hash); } catch (e) { addMsg("error", e.message); }
    routing = false;
  } else history.replaceState(null, "", "#start");
})();
window.__cualign = { renderMd, reviewQuestions, addReviewQuestions, scriptedFollowup, state };   // test hook (scratch browser checks)
