// cuAlign web UI — patient → scan upload → input check on the 3D → chat (NAT /chat/stream, inline tool trace) → three.js stage viewer → plan panel.
import * as THREE from "three";
import { PlanStream, matchesSelection } from "./plan-stream.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { createManual } from "./manual.js";
import { createScanFx } from "./scan-reveal.js";

const $ = (id) => document.getElementById(id);
// 직접 이동 (manual.js): created once the screen's functions exist (end of file); until then nothing is being edited
let manualEdit = { active: false, open() {}, cancel() {}, leave() {} };
const isManualTarget = () => state.target?.info?.source === "manual";
// FDI ↔ Universal (upper arch only, #113): the dentist reads and writes FDI on screen; the core, planner and API
// keep Universal. Convert at the screen boundary only — never show Universal alongside FDI (decision 2026-09-27).
const fdi = (u) => { u = Number(u); return u <= 8 ? 19 - u : 12 + u; };
const universal = (f) => { f = Number(f); return f <= 18 ? 19 - f : f - 12; };
const fdiList = (ids) => [...(ids ?? [])].map(fdi).join("·");
// Colours follow clinical software conventions (docs/research/2026-09-23-원내-얼라이너-SW-화면-역설계.md):
// teeth are ivory, movement is a heat tint, collisions red, limit breaches amber, locked teeth blue.
const IVORY = new THREE.Color(0xe9e3d6);
const RED = 0xe52020, AMBER = 0xef9100, BLUE = 0x4f8fd6;   // DESIGN.md colors.error, warning, locked
const IPR_FACE = 0x2f8ae8;   // the IPR cut planes on a crown (#22, DESIGN.md colors.ipr-face)
const IPR_FACE_MAT = new THREE.MeshStandardMaterial({ color: IPR_FACE, roughness: 0.45, metalness: 0.02, side: THREE.FrontSide });

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
  stlBusy: false,        // the server is building the STL zip for a download (#119)
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
  labels: [],            // CSS2DObject IPR labels
  patient: null,         // GET /api/patients/{id} payload of the patient on screen
  caseList: [], clSelected: null,   // 케이스 목록 (#109): 샘플 카드 + 환자 표, 선택한 것 아래 상세 (③-b)
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
  oldPlans: new Set(),   // plans that already existed when the case was opened: folded as 지난 계획 (#105, #111)
  tab: "stages",         // the open sidebar tab: stages | rules | cond (#111)
  planError: null,       // the server's sentence when a case has no plan and the calculation failed (#112)
};

// ------------------------------------------------------------------ three.js
const canvas = $("viewCanvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const labelRenderer = new CSS2DRenderer({ element: $("labels") });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
// Free arc rotation (#18): a horizontal drag always turns about the root axis (world z), a vertical drag pitches about
// the camera's own right axis, both accumulated on the camera quaternion. No pole clamp (OrbitControls stopped at the
// poles, #132) and no roll drift: the right axis starts level with the arch plane and neither turn tilts it. The
// presets place the camera with lookAt (up = −z, apical) and then only the quaternion is kept; camera.up is unused.
const controls = {
  target: new THREE.Vector3(), dist: 100, vel: { yaw: 0, pitch: 0 }, damping: 0.85, speed: 0.006, minDist: 5, maxDist: 1500,
  place() { camera.position.copy(controls.target).add(new THREE.Vector3(0, 0, controls.dist).applyQuaternion(camera.quaternion)); },
  rotate(yaw, pitch) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(right, pitch))
      .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw)).normalize();
  },
  pan(dx, dy) {   // screen-space: the target slides with the pointer
    const k = (2 * controls.dist * Math.tan((camera.fov * Math.PI) / 360)) / canvas.clientHeight;
    controls.target.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), -dx * k)
      .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), dy * k);
  },
  zoom(f) { controls.dist = Math.min(controls.maxDist, Math.max(controls.minDist, controls.dist * f)); },
  lookFrom(pos, up) {   // the presets: the camera at pos looking at the target, the arch plane level
    controls.dist = pos.distanceTo(controls.target);
    camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, controls.target, up));
    controls.vel.yaw = controls.vel.pitch = 0;
    controls.place();
  },
  dragging: false,
  update() {   // the inertia runs after the pointer lets go; during a drag the pointer moves the camera itself
    if (controls.dragging) { controls.place(); return; }
    if (Math.abs(controls.vel.yaw) > 1e-4 || Math.abs(controls.vel.pitch) > 1e-4) {
      controls.rotate(controls.vel.yaw, controls.vel.pitch);
      controls.vel.yaw *= controls.damping; controls.vel.pitch *= controls.damping;
    } else controls.vel.yaw = controls.vel.pitch = 0;
    controls.place();
  },
};
canvas.style.touchAction = "none";
{
  let drag = null, lastMove = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }; controls.dragging = true;
    controls.vel.yaw = controls.vel.pitch = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; lastMove = performance.now();
    if (drag.pan) controls.pan(dx, dy);
    else { controls.rotate(-dx * controls.speed, -dy * controls.speed); controls.vel.yaw = -dx * controls.speed * 0.5; controls.vel.pitch = -dy * controls.speed * 0.5; }
  });
  const end = () => { if (!drag) return; drag = null; controls.dragging = false; if (performance.now() - lastMove > 80) controls.vel.yaw = controls.vel.pitch = 0; };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); controls.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(30, 40, 120); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-50, -30, 60); scene.add(fill);
const group = new THREE.Group(); scene.add(group);
// the scan reveal on the setup turn and the IPR tool cursor (scan-reveal.js); the prescription it plays is the form's
// (Universal; the form's IPR contacts are FDI)
const prescribed = (c) => ({ extraction: c?.extraction ?? [], ipr_surfaces: (c?.ipr_surfaces ?? []).map(([a, b, mm]) => [universal(a), universal(b), mm]) });
const scanFx = createScanFx({ THREE, CSS2DObject, group, state, fdi, notice: $("planNotice"),
  refresh: () => { applyStage(state.stage); renderSetupMarks(); },
  stageContacts: (p) => contactsOnScreen(surfacesOf(p.target, p.info), new Set((p.target?.removed ?? []).map(String))) });
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

// +x is the patient's left (tooth 15 side), +y anterior, +z occlusal (see setView).
const VIEWS = { occlusal: "교합면", frontal: "정면", left: "환자 왼쪽", right: "환자 오른쪽" };
(function loop() {
  controls.update(); scanFx.tick(); renderer.render(scene, camera); labelRenderer.render(scene, camera);
  requestAnimationFrame(loop);
})();

const ghost = new THREE.Group(); scene.add(ghost);
const GHOST_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false });
// Each gum vertex follows the four nearest crowns, weighted by distance (σ 7 mm), so the scanned gum moves with
// the teeth instead of swallowing them. Translation only; crown rotation is small at the gum line.
const GUM_K = 4, GUM_SIGMA = 7, GUM_SMOOTH = 3;   // #18: 3 / 5 mm tore the gum between crowns that part (the extraction sites)
function gumSkin(geo) {
  const pos = geo.attributes.position.array, n = pos.length / 3;
  const ids = Object.keys(state.center), centers = ids.map((id) => state.center[id]);
  const base = Float32Array.from(pos), skinIds = new Int16Array(n * GUM_K), w = new Float32Array(n * GUM_K);
  const near = [];
  for (let v = 0; v < n; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
    near.length = 0;
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i], d = Math.hypot(x - c.x, y - c.y, z - c.z);
      near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    let sum = 0;
    for (let j = 0; j < GUM_K; j++) { const [d, i] = near[j] ?? [1e9, 0]; const g = Math.exp(-(d * d) / (2 * GUM_SIGMA * GUM_SIGMA)); skinIds[v * GUM_K + j] = i; w[v * GUM_K + j] = g; sum += g; }
    // far from every crown the gum stays; near one crown it follows fully
    const scale = sum > 1e-4 ? Math.min(1, sum) / sum : 0;
    for (let j = 0; j < GUM_K; j++) w[v * GUM_K + j] *= scale;
  }
  // vertex adjacency for smoothing the displacement field (#18): where neighbouring vertices follow different crowns
  // that part (the extraction sites) the raw field tore the gum into dark seams
  const idx = geo.index.array, adj = Array.from({ length: n }, () => []);
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
  }
  return { base, ids: skinIds, w, toothIds: ids, adj, disp: new Float32Array(n * 3), tmp: new Float32Array(n * 3) };
}
// Each vertex is carried to where its nearest crowns would take it: R(v − c) + c + d per crown (yaw about the
// crown's pivot, then the translation), blended by the skin weights (#14: rotation included).
// A crown the plan removed is no neighbour at all (server contract 11-gum-server.md): the filled socket cover must not
// follow a crown that is gone, so its share goes to the crowns still there.
function deformGum(st, rot = {}, piv = {}, removed = new Set()) {
  const skin = state.gumSkin, gum = state.gum;
  if (!skin || !gum) return;
  const pos = gum.geometry.attributes.position.array, n = pos.length / 3;
  const moves = skin.toothIds.map((id) => {
    if (removed.has(id) || (!st[id] && !rot[id])) return null;
    const a = ((rot[id] ?? 0) * Math.PI) / 180, d = st[id] ?? [0, 0, 0], c = piv[id] ?? [0, 0, 0];
    return { cos: Math.cos(a), sin: Math.sin(a), d, c };
  });
  for (let v = 0; v < n; v++) {
    const x = skin.base[3 * v], y = skin.base[3 * v + 1];
    // a crown the plan removed has no entry: it is no neighbour (the filled gum shows in its socket), its share goes
    // to the crowns that are still there
    let all = 0, present = 0;
    for (let j = 0; j < GUM_K; j++) { const g = skin.w[v * GUM_K + j]; all += g; if (moves[skin.ids[v * GUM_K + j]]) present += g; }
    const share = present > 1e-6 ? all / present : 0;
    let dx = 0, dy = 0, dz = 0;
    for (let j = 0; j < GUM_K; j++) {
      const t = moves[skin.ids[v * GUM_K + j]], g = skin.w[v * GUM_K + j] * share;
      if (!t) continue;
      const rx = x - t.c[0], ry = y - t.c[1];
      dx += g * (t.cos * rx - t.sin * ry + t.c[0] + t.d[0] - x);
      dy += g * (t.sin * rx + t.cos * ry + t.c[1] + t.d[1] - y);
      dz += g * t.d[2];
    }
    skin.disp[3 * v] = dx; skin.disp[3 * v + 1] = dy; skin.disp[3 * v + 2] = dz;
  }
  // two Laplacian passes over the displacement (not the surface): the seams between crown territories blend, the scan's detail stays
  let src = skin.disp, dst = skin.tmp;
  for (let pass = 0; pass < GUM_SMOOTH; pass++) {
    for (let v = 0; v < n; v++) {
      const nb = skin.adj[v], m = nb.length;
      let ax = 0, ay = 0, az = 0;
      for (let i = 0; i < m; i++) { const u = nb[i]; ax += src[3 * u]; ay += src[3 * u + 1]; az += src[3 * u + 2]; }
      dst[3 * v] = m ? 0.5 * src[3 * v] + 0.5 * ax / m : src[3 * v];
      dst[3 * v + 1] = m ? 0.5 * src[3 * v + 1] + 0.5 * ay / m : src[3 * v + 1];
      dst[3 * v + 2] = m ? 0.5 * src[3 * v + 2] + 0.5 * az / m : src[3 * v + 2];
    }
    [src, dst] = [dst, src];
  }
  for (let v = 0; v < n; v++) { pos[3 * v] = skin.base[3 * v] + src[3 * v]; pos[3 * v + 1] = skin.base[3 * v + 1] + src[3 * v + 1]; pos[3 * v + 2] = skin.base[3 * v + 2] + src[3 * v + 2]; }
  // the wall's copies of the rim vertices stay glued to the rim (splitGumBase)
  for (const [c, o] of gum.geometry.userData.dups ?? []) { pos[3 * c] = pos[3 * o]; pos[3 * c + 1] = pos[3 * o + 1]; pos[3 * c + 2] = pos[3 * o + 2]; }
  gum.geometry.attributes.position.needsUpdate = true;
  gum.geometry.computeVertexNormals();
  fixGumBaseNormals(gum.geometry);
}
// The server closes the gum with a wall down to a floor at z_base (gum_fill.base). Those faces share their rim vertices
// with the scanned surface, so averaged normals bled the jagged rim into the wall as vertical streaks. Give the wall and
// floor their own copies of the rim vertices: the surface keeps its smooth normals, the wall smooths only along itself.
// `dups` pairs [copy, original] so the skin can keep the copies on the rim when the gum deforms.
function splitGumBase(gumMesh, zBase) {
  const v = gumMesh.v.flat(), f = gumMesh.f.flat(), dups = [];
  if (zBase == null) return { v, f, dups, wall: [], floorVerts: new Set(), wallVerts: new Set() };   // no closed base (procedural gum): nothing to split
  const onBase = (i) => Math.abs(v[3 * i + 2] - zBase) < 0.02;   // the server rounds z_base to 2 decimals
  // face class: 0 surface (no vertex on the floor plane), 1 wall (some), 2 floor (all three)
  const cls = new Uint8Array(f.length / 3), used = [new Uint8Array(v.length / 3), new Uint8Array(v.length / 3), new Uint8Array(v.length / 3)];
  for (let k = 0; k < f.length; k += 3) {
    const c = onBase(f[k]) + onBase(f[k + 1]) + onBase(f[k + 2]);
    cls[k / 3] = c === 0 ? 0 : c === 3 ? 2 : 1;
    used[cls[k / 3]][f[k]] = used[cls[k / 3]][f[k + 1]] = used[cls[k / 3]][f[k + 2]] = 1;
  }
  // the wall and the floor each get their own copy of a vertex another class also uses (rim: surface|wall,
  // bottom edge: wall|floor). The surface keeps the originals.
  for (const c of [1, 2]) {
    const copy = new Map();
    for (let k = 0; k < f.length; k += 3) {
      if (cls[k / 3] !== c) continue;
      for (let j = 0; j < 3; j++) {
        const i = f[k + j];
        if (!(used[0][i] || used[c === 1 ? 2 : 1][i])) continue;   // used by this class only: nothing to separate from
        if (!copy.has(i)) { copy.set(i, v.length / 3); v.push(v[3 * i], v[3 * i + 1], v[3 * i + 2]); dups.push([v.length / 3 - 1, i]); }
        f[k + j] = copy.get(i);
      }
    }
  }
  const wall = [], floorVerts = new Set(), wallVerts = new Set();
  for (let k = 0; k < f.length; k += 3) {
    if (cls[k / 3] === 1) { wall.push(k); wallVerts.add(f[k]); wallVerts.add(f[k + 1]); wallVerts.add(f[k + 2]); }
    else if (cls[k / 3] === 2) { floorVerts.add(f[k]); floorVerts.add(f[k + 1]); floorVerts.add(f[k + 2]); }
  }
  return { v, f, dups, wall, floorVerts, wallVerts };
}
// The wall and floor triangles come with mixed winding (the wall is fanned from a loop, the floor ear-clipped), so
// averaged normals alternate and the flat faces shade as stripes. Overwrite them: the floor faces straight down,
// each wall vertex takes the mean of its faces' normals turned to point away from the arch.
function fixGumBaseNormals(geo) {
  const b = geo.userData.base;
  if (!b) return;
  const N = geo.attributes.normal.array, P = geo.attributes.position.array, I = geo.index.array;
  for (const i of b.floorVerts) { N[3 * i] = 0; N[3 * i + 1] = 0; N[3 * i + 2] = -1; }
  for (const i of b.wallVerts) { N[3 * i] = N[3 * i + 1] = N[3 * i + 2] = 0; }
  let cx = 0, cy = 0;
  for (const i of b.wallVerts) { cx += P[3 * i]; cy += P[3 * i + 1]; }
  cx /= b.wallVerts.size || 1; cy /= b.wallVerts.size || 1;
  for (const k of b.wall) {
    const a = I[k], c = I[k + 1], d = I[k + 2];
    const ax = P[3 * c] - P[3 * a], ay = P[3 * c + 1] - P[3 * a + 1], az = P[3 * c + 2] - P[3 * a + 2];
    const bx = P[3 * d] - P[3 * a], by = P[3 * d + 1] - P[3 * a + 1], bz = P[3 * d + 2] - P[3 * a + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const mx = (P[3 * a] + P[3 * c] + P[3 * d]) / 3 - cx, my = (P[3 * a + 1] + P[3 * c + 1] + P[3 * d + 1]) / 3 - cy;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const i of [a, c, d]) { N[3 * i] += nx; N[3 * i + 1] += ny; N[3 * i + 2] += nz; }
  }
  for (const i of b.wallVerts) { const l = Math.hypot(N[3 * i], N[3 * i + 1], N[3 * i + 2]) || 1; N[3 * i] /= l; N[3 * i + 1] /= l; N[3 * i + 2] /= l; }
  geo.attributes.normal.needsUpdate = true;
}
function buildTeeth(mesh) {
  group.clear(); ghost.clear(); state.teeth = {}; state.center = {}; state.gum = null; clearLabels(); scanFx.cancel();
  state.violLabels = []; state.selected.clear(); renderSelection();
  for (const [id, t] of Object.entries(mesh.teeth)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(t.v.flat(), 3));
    geo.setIndex(t.f.flat());
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ color: IVORY.clone(), roughness: 0.45, metalness: 0.02, transparent: true, opacity: 1, side: THREE.FrontSide });   // closed crowns: no inner black faces (#14)
    const m = new THREE.Mesh(geo, mat);
    m.userData.id = id;
    group.add(m);
    ghost.add(new THREE.Mesh(geo, GHOST_MAT));   // the untreated position, shown by 전후 겹쳐 보기
    state.teeth[id] = m;
    state.center[id] = geo.boundingBox.getCenter(new THREE.Vector3());
    // a thin white outline for an extracted crown (#14): the same crown inflated 4% about its centre, back faces only,
    // as a child so it follows the crown; shown only while the crown is a silhouette
    const c = state.center[id];
    const shell = new THREE.Mesh(geo.clone().translate(-c.x, -c.y, -c.z), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0.6, depthWrite: false }));
    shell.position.copy(c); shell.scale.setScalar(1.04); shell.visible = false;
    m.add(shell); m.userData.shell = shell;
    // the IPR cut (#22): the scan's crown stays as `full`; setCut fills `cut` {geo, faces} and applyStage swaps them in from 셋업 on
    m.userData.full = geo;
    const cutMesh = new THREE.Mesh(new THREE.BufferGeometry(), IPR_FACE_MAT); cutMesh.visible = false;
    m.add(cutMesh); m.userData.cutMesh = cutMesh;
  }
  for (const set of Object.values(state.cutSets)) for (const c of Object.values(set)) { c.geo.dispose(); c.faces.dispose(); }
  state.cutSets = {};
  if (mesh.plan_id) setCut(mesh, "plan:" + mesh.plan_id);   // the representative plan's cut comes with the scan
  const gumMesh = mesh.gum_filled ?? mesh.gum;   // the sockets filled by the server when it sends gum_filled (contract 11-gum-server.md)
  if (gumMesh) {
    const geo = new THREE.BufferGeometry();
    const split = splitGumBase(gumMesh, mesh.gum_fill?.z_base);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(split.v, 3));
    geo.setIndex(split.f);
    geo.userData.dups = split.dups;
    if (split.wall.length) geo.userData.base = split;
    geo.computeVertexNormals();
    fixGumBaseNormals(geo);
    // both sides (#18): the scanned gum is an open shell; from the base its inside showed black with FrontSide. The crowns stay FrontSide.
    const gum = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd98b8f, roughness: 0.6, metalness: 0.0, transparent: true, opacity: 1, side: THREE.DoubleSide }));
    gum.userData.gum = true;
    state.gum = gum;
    state.gumSkin = gumSkin(geo);
    group.add(gum);
  }
  state.archOrder = (mesh.arch_order ?? mesh.ids ?? []).map(String);
  setView("occlusal");
}

// The mesh response carries the crowns an IPR cuts (#22, #140): `teeth_cut` {tooth: {v, f}} for the cut teeth only and
// `ipr_cut` {tooth: {mm, faces}} with the indices of the faces on the cut planes; `plan_id` (/plans/{id}/cut, or the
// opening mesh) or `target_id` (/targets/{id}/cut) says whose. Each cut tooth gets a crown geometry without those faces
// and a second one of only them (shared positions), so the planes shade in their own colour with no z-fighting.
// The set is kept under its key; a response with no cuts (an extraction plan) is an empty set.
function setCut(view, key) {
  const old = state.cutSets[key];
  if (old) for (const c of Object.values(old)) { c.geo.dispose(); c.faces.dispose(); }
  const set = state.cutSets[key] = {};
  for (const id of Object.keys(state.teeth)) {
    const t = view?.teeth_cut?.[id], c = view?.ipr_cut?.[id];
    if (!t) continue;
    const pos = new THREE.Float32BufferAttribute(t.v.flat(), 3), onPlane = new Set(c?.faces ?? []);
    const body = [], planes = [];
    t.f.forEach((f, k) => (onPlane.has(k) ? planes : body).push(...f));
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", pos); geo.setIndex(body); geo.computeVertexNormals(); geo.computeBoundingBox();
    const faces = new THREE.BufferGeometry(); faces.setAttribute("position", pos); faces.setIndex(planes); faces.computeVertexNormals();
    set[id] = { geo, faces, mm: c?.mm ?? 0 };
  }
}
// Which cut the view shows: 초기 none; 목표 (and 셋업) the target's when the target turn gave one, else the plan's;
// 단계 the plan's. A key with no set fetched yet shows the scan's crowns.
function cutKeyNow() {
  if (state.step === "initial") return null;
  const t = state.targetId ? "target:" + state.targetId : null, p = state.plan ? "plan:" + state.plan.plan_id : null;
  return state.step === "stages" ? p ?? t : t ?? p;
}
// the target turn's cut dentition (#22, #146): GET /targets/{id}/cut → {teeth_cut, ipr_cut, plan_id: null, target_id} — the cut
// crowns alone, not the whole mesh again. A response for another target (or none) leaves the scan's crowns
async function loadTargetCut(targetId) {
  try {
    const view = await api(`/api/cases/${encodeURIComponent(state.meshCase)}/targets/${encodeURIComponent(targetId)}/cut`);
    if (view.target_id !== targetId || !state.teeth) return;
    setCut(view, "target:" + targetId);
    if (cutKeyNow() === "target:" + targetId) applyStage(state.stage);   // the target is already on screen: swap its crowns in
  } catch { /* the target shows without its cut */ }
}
function setView(kind) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // the fit is by the vertical fov; a narrow viewer (1366 wide, #17-10) is limited by width, so the camera backs off by the aspect
  const dist = Math.max(size.x, size.y, size.z) / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.25 / Math.min(1, camera.aspect);
  const pos = new THREE.Vector3();
  if (kind === "frontal") {            // look from the anterior (+y) side; upper arch → crowns hang down (occlusal z=0 at the bottom)
    pos.set(c.x, c.y + dist, c.z - size.z * 0.3);
  } else if (kind === "back") {        // from the palate side, crowns down
    pos.set(c.x, c.y - dist, c.z - size.z * 0.3);
  } else if (kind === "left" || kind === "right") {   // buccal side views; +x is the patient's left
    pos.set(c.x + (kind === "left" ? dist : -dist), c.y, c.z - size.z * 0.3);
  } else if (kind === "base") {        // from below the base of the scan
    pos.set(c.x, c.y - dist * 0.02, c.z - dist);
  } else {                             // occlusal: look down −z from just off the pole, anterior (+y) at the top
    kind = "occlusal";
    pos.set(c.x, c.y + dist * 0.02, c.z + dist);
  }
  controls.target.copy(c);
  controls.lookFrom(pos, new THREE.Vector3(0, 0, -1));
  for (const b of document.querySelectorAll(".view-rail [data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === kind));
}

// ---- the design flow (#15): 초기 → 셋업 → 목표 → 단계. The server computed the plan when the case opened; the
// screen reveals it in steps. The step lives in body.step-* and in the address (&step=).
const STEPS = ["initial", "setup", "target", "stages"];
// The strip is progress (#20): the agent's turns move it forward (step_done), the dentist only looks back at steps
// that are done (초기 ↔ 목표 to compare). The plan the 3D shows for a step: the target before any plan exists,
// otherwise the plan.
const stepIndex = (s) => STEPS.indexOf(s);
const viewPlan = () => (state.step === "target" && state.target ? state.target : state.plan);
function setProgress(step, reset = false) {   // reset: a new setup or target makes the later steps stale again
  if (!reset && stepIndex(step) <= stepIndex(state.progress)) return;
  state.progress = step;
  for (const s of STEPS) document.body.classList.toggle("prog-" + s, stepIndex(s) <= stepIndex(step));
  renderFlow();
}
function setStep(step) {
  if (!STEPS.includes(step) || stepIndex(step) > stepIndex(state.progress)) step = state.progress;
  manualEdit.leave(step);   // an unapplied hand edit does not follow the view off the 목표 step
  state.step = step;
  for (const s of STEPS) document.body.classList.toggle("step-" + s, s === step);
  stopPlay();
  const n = viewPlan()?.stages?.length ?? 0;
  applyStage(step === "target" ? n : 0);   // 목표 = the last stage; the others start at the scan
  buildIprLabels();
  renderSetupMarks();
  renderFlow();
  renderPlanList();
  // the right panel follows the step: the scan's facts, then the conditions, from the stages on the table and rules
  if (step === "initial") showTab("scan");
  else if (step === "setup" || step === "target") showTab("cond");
  else if (state.tab === "cond" || state.tab === "scan") showTab("stages");
  if (state.activeCase) setHash(caseHash());
}
function renderFlow() {
  for (const b of document.querySelectorAll("#flow button")) {
    const i = stepIndex(b.dataset.step), cur = stepIndex(state.step), done = stepIndex(state.progress);
    b.classList.toggle("on", i === cur); b.classList.toggle("done", i < cur && i <= done);
    b.disabled = i > done;
  }
}
// what the 3D marks in 셋업: the agent's constraints (step_done setup), or the plan's target when looking back at a plan
function setupSource() {
  // the IPR contacts (#57): the agent's prescription as it read it, or what the plan's target strips
  if (state.setup) return { removed: (state.setup.extraction ?? []).map(String), surfaces: state.setup.ipr_surfaces ?? [], expansion: 0 };
  const t = state.plan?.target;
  return t ? { removed: (t.removed ?? []).map(String), surfaces: surfacesOf(t, state.plan.info),
               expansion: state.plan.info?.expansion_mm_per_side ?? 0 } : null;
}
// one mark per IPR contact whose two crowns are on screen (#57): [a, b, mm] Universal → [id, id, mm] strings
function contactsOnScreen(surfaces, removed = new Set()) {
  return (surfaces ?? []).map(([a, b, mm]) => [String(a), String(b), +mm]).filter(([a, b]) => state.teeth[a] && state.teeth[b] && !removed.has(a) && !removed.has(b));
}
// 셋업 marks over the 3D: a yellow dot at each IPR contact (the same contacts the mm labels use), arrows on the
// last crowns when the arch widens. Only in the 셋업 state.
function renderSetupMarks() {
  for (const o of state.setupMarks ?? []) o.parent?.remove(o);
  state.setupMarks = [];
  const src = setupSource();
  if (state.step !== "setup" || !src) return;
  const removed = new Set(src.removed);
  const order = state.archOrder.filter((id) => state.teeth[id] && !removed.has(id));
  const put = (el, pos) => { const o = new CSS2DObject(el); o.position.copy(pos); group.add(o); state.setupMarks.push(o); };
  for (const [a, b, mm] of contactsOnScreen(src.surfaces, removed)) {
    const el = document.createElement("div"); el.className = "ipr-mark"; el.title = `IPR 접촉면 ${fdi(a)}-${fdi(b)} ${mm} mm`;
    el.dataset.contact = `${Math.min(+a, +b)}-${Math.max(+a, +b)}`;   // the scan reveal lights them in turn
    const p = state.center[a].clone().add(state.center[b]).multiplyScalar(0.5); p.z += 2;
    put(el, p);
  }
  for (const id of removed) {   // 발치 where the extracted crown was
    if (!state.teeth[id]) continue;
    const el = document.createElement("div"); el.className = "extract-mark"; el.textContent = "발치"; el.dataset.extract = id;
    put(el, state.center[id].clone().setZ(state.center[id].z + 2));
  }
  if (src.expansion > 0 && order.length >= 2) {
    for (const [id, arrow] of [[order[0], "←"], [order[order.length - 1], "→"]]) {
      const el = document.createElement("div"); el.className = "exp-arrow"; el.textContent = arrow; el.title = `악궁 확장 편측 ${src.expansion} mm`;
      const p = state.center[id].clone(); p.x += arrow === "←" ? -7 : 7;   // outward of the last crown (+x is the patient's left)
      put(el, p);
    }
  }
}
$("flow").addEventListener("click", (e) => { const s = e.target.closest("button:not([disabled])")?.dataset.step; if (s && state.meshCase) setStep(s); });

// ---- IPR labels: one per contact along the arch, mm number at the contact point (3/5 clinical SW do this)
function clearLabels() { for (const l of state.labels) l.parent?.remove(l); state.labels = []; }
function buildIprLabels() {
  clearLabels();
  const v = viewPlan(), t = v?.target;
  // the contacts the target strips, mm per contact (#57); no guessing from the even rule any more
  for (const [a, b, mm] of contactsOnScreen(surfacesOf(t, v?.info), new Set((t?.removed ?? []).map(String)))) {
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
  for (const v of viewPlan()?.violations ?? []) {
    if (v.stage !== k || !v.teeth) continue;
    for (const t of v.teeth) (by[String(t)] ??= new Set()).add(v.type);
  }
  return by;
}

function applyStage(k) {
  state.stage = k;
  const plan = viewPlan();
  const st = k > 0 ? (plan?.stages?.[k - 1] ?? {}) : {};
  const rot = k > 0 ? plan?.rotations?.[k - 1] ?? {} : {};
  const hasPlan = !!plan;
  const bad = violationsAt(k);
  const locked = new Set((plan?.target?.locked ?? []).map(String));
  const plain = state.step === "initial", setup = state.step === "setup";   // #15: before the target, the crowns all stay
  // 셋업 marks what the agent's constraints remove (#20); the other steps follow the plan on view
  const removed = new Set(setup ? setupSource()?.removed ?? [] : (plan?.target?.removed ?? []).map(String));
  // the gum follows the crowns, turning with them; from the target on, the removed crowns are gone for it too
  deformGum(st, rot, plan?.pivots ?? {}, k > 0 && !plain && !setup ? removed : new Set());
  // IPR-cut crowns (#22): 초기 shows the scan; 셋업·목표·단계 show the crowns as the case's plan cuts them
  const cutSet = state.cutSets[cutKeyNow()] ?? null;
  for (const [id, m] of Object.entries(state.teeth)) {
    const d = st[id];
    const cut = cutSet?.[id] ?? null;
    m.geometry = cut ? cut.geo : m.userData.full;
    if (cut) m.userData.cutMesh.geometry = cut.faces;
    // turn about the crown's own vertical axis through its centroid c: v' = R(v - c) + c + d  =>  position = d + c - R c
    const a = ((rot[id] ?? 0) * Math.PI) / 180, c = plan?.pivots?.[id] ?? [0, 0, 0], t = d ?? [0, 0, 0];
    m.rotation.set(0, 0, a);
    m.position.set(t[0] + c[0] - (Math.cos(a) * c[0] - Math.sin(a) * c[1]), t[1] + c[1] - (Math.sin(a) * c[0] + Math.cos(a) * c[1]), t[2]);
    // #18 decision: 치료 전 (k = 0) is the scan with every crown, stages 1..n−1 show the silhouette, the target (k = n) none
    const gone = hasPlan && removed.has(id) && !plain && !setup && k > 0;
    // 셋업 (#20): the extracted crowns flash red as the setup lands, then they are gone (the filled gum shows)
    m.visible = setup && removed.has(id) ? state.setupRed : !gone || k < (plan?.stages?.length ?? 0);
    // extracted teeth from stage 1 on: a translucent white silhouette (#14, #18); materials are per tooth and reused across
    // plans, so every other tooth gets its solid look back
    m.material.opacity = gone ? 0.45 : 1;
    m.material.depthWrite = !gone;
    m.userData.shell.visible = gone;
    m.userData.cutMesh.visible = !!cut && !gone && m.visible;
    const moved = d ? Math.hypot(...d) : 0;
    m.userData.moved = moved;
    m.userData.viol = bad[id] ? [...bad[id]] : [];
    if (gone) m.material.color.setHex(0xffffff);
    else if (plain) m.material.color.copy(IVORY);
    else if (setup) m.material.color.setHex(removed.has(id) ? RED : IVORY.getHex());   // 셋업: what the constraints remove
    else if (bad[id]?.has("collision")) m.material.color.setHex(RED);
    else if (bad[id]?.has("move_limit")) m.material.color.setHex(AMBER);
    else if (locked.has(id)) m.material.color.setHex(BLUE);
    else m.material.color.copy(IVORY);
    m.material.emissive.setHex(state.selected.has(id) ? 0x5a9400 : gone ? 0x777777 : 0x000000);   // the silhouette reads white, not lit grey
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
  $("stageLabel").textContent = !hasPlan ? "계획 없음" : `${n}단계 · ${months}개월`;
  $("stageSlider").value = k;
  const tip = $("stageTip");
  const boundary = plan?.info?.phase_boundary ?? 0;   // sequencing (#144): which phase this aligner is in
  tip.textContent = k === 0 ? "치료 전" : `단계 ${k}` + (!boundary ? "" : k === boundary ? " · 뒤따라 이동 시작" : k > boundary ? " · 뒤따라 이동" : " · 먼저 이동");
  tip.style.left = n ? `calc(8px + ${(k / n) * 100}% - ${(k / n) * 16}px)` : "8px";   // the thumb's centre: 8px inset each side
  markStage(k);
  scanFx.stageReached(k);
}

// ---- hover tooltip: tooth number · cumulative move · violations at this stage (number only on hover, as in 5/5 SW)
function onPointerMove(e) {
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(p, camera);
  const hit = raycaster.intersectObjects(group.children.filter((o) => o.isMesh && o.visible && !o.userData.gum))[0];
  canvas.style.cursor = hit ? "pointer" : "";
  if (hit && state.plan && !state.pickedOnce && !localStorage.getItem("cualign.pickHint")) showPickHint();
  const tip = $("tip");
  if (!hit) { tip.hidden = true; return; }
  const m = hit.object, id = m.userData.id;
  const parts = [`치아 ${fdi(id)}`];
  if (state.plan) parts.push(`누적 이동 ${(m.userData.moved ?? 0).toFixed(2)} mm`);
  if (m.userData.viol?.length) parts.push(`위반: ${m.userData.viol.join(", ")}`);
  if ((state.plan?.target?.locked ?? []).map(String).includes(id)) parts.push("고정");
  if ((state.plan?.target?.removed ?? []).map(String).includes(id)) parts.push("발치");
  if (parts.length === 1) { tip.hidden = true; return; }
  tip.textContent = parts.join(" · ");
  tip.style.left = `${e.clientX - r.left + 12}px`;
  tip.style.top = `${e.clientY - r.top + 12}px`;
  tip.hidden = false;
}

// the first time the pointer rests on a tooth: one line saying what a click does, once per browser (#14)
function showPickHint() {
  localStorage.setItem("cualign.pickHint", "1");
  $("pickHint").hidden = false;
  setTimeout(() => { $("pickHint").hidden = true; }, 8000);
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
  for (const id of [...state.selected].sort((a, b) => fdi(a) - fdi(b))) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.id = id; b.textContent = `${fdi(id)}번 ✕`; b.title = "선택 해제";
    box.append(b);
  }
  const clear = document.createElement("button");
  clear.type = "button"; clear.className = "clear"; clear.textContent = "모두 해제";
  box.append(clear);
}
let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (manualEdit.active) return;   // 직접 이동: a click picks the crown to move (manual.js), not a tooth for the chat
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const id = toothAt(e);
  if (!id) return;
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  state.pickedOnce = true; $("pickedLegend").hidden = false; $("pickHint").hidden = true;
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
    b.dataset.tip = `단계 ${k} · ` + [s.collision && `충돌 ${s.collision}건`, s.move_limit && `한계 초과 ${s.move_limit}건`].filter(Boolean).join(" · ");
    b.setAttribute("aria-label", b.dataset.tip);
    b.addEventListener("click", () => { stopPlay(); applyStage(+k); });
    box.append(b);
  }
}

// ---- keep or undo a new plan (#90): the previous plan stays one click away after every replanning
function addDecision(prevId, newId) {
  if (!prevId || !newId || prevId === newId) return;
  const bar = document.createElement("div");
  bar.className = "decision";
  bar.innerHTML = `<span></span><button class="btn ghost small" type="button" data-act="revert">이전 안으로 되돌리기</button>`;
  const say = (t) => { bar.querySelector("span").textContent = t; };
  // the dentist reads strategy and stages; the ids stay in the tooltip (DESIGN.md: no plan ids on screen)
  const kind = (p) => (["passed", "running", "failed"].includes(p?.review?.status) ? "에이전트 계획" : "규칙 계산");
  const newRow = state.plan?.plan_id === newId ? { strategy: state.plan.strategy, n_stages: state.plan.info?.n_stages, review: state.plan.review } : state.planRows[newId];
  const prevRow = state.planRows[prevId];
  const newText = `${kind(newRow)} · ${planWords(newRow)}`, prevText = `${kind(prevRow)} · ${planWords(prevRow)}`;
  bar.title = `새 계획 ${newId} · 이전 계획 ${prevId}`;
  say(`3D가 새 안(${newText})으로 바뀌었습니다. 이전 안: ${prevText}`);
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
    }
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
  e.currentTarget.setAttribute("aria-label", on ? "대화 · 대화 패널을 다시 엽니다" : "크게 · 대화 패널을 접고 3D를 크게 봅니다");
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
function readConstraints() {
  const teeth = (id) => FIELD_READ[id]();
  const ipr = FIELD_READ.cIpr(), cap = FIELD_READ.cCap();
  // extraction: the prescribed teeth (#56); the app never picks them, 발치 허용 off empties the field (non-extraction)
  const out = { extraction: teeth("cExtract"), lock: teeth("cLock"), ipr_exclude: teeth("cExclude"),
    ipr_limit_mm: ipr, stage_cap: cap, clear_stage_cap: cap === null, order: $("cOrder").value };
  // IPR per contact (#57), FDI in the patch — this field only. Sent when there is one or one is being cleared; a server
  // before core #143 rejects the key (ConstraintPatch forbids extras), so an untouched empty field sends nothing
  const surf = FIELD_READ.cSurf();
  if (surf.length || state.plan?.constraints?.ipr_surfaces?.length || state.setup?.ipr_surfaces?.length) out.ipr_surfaces = surf;
  return out;
}
// 기간(개월) ↔ 단계 상한: the same formula as the server's limits.py (30.4 days a month, 7 days an aligner)
const capOfMonths = (m) => Math.round((m * 30.4) / 7);
const monthsOfCap = (cap) => Math.round(((cap * 7) / 30.4) * 10) / 10;
function fillConstraints(c) {
  $("cExtract").value = (c.extraction || []).map(fdi).sort((a,b) => a-b).join(", ");
  $("cAllowExt").checked = (c.extraction || []).length > 0; $("cExtract").disabled = !$("cAllowExt").checked;
  $("cLock").value = (c.lock || []).map(fdi).sort((a,b) => a-b).join(", ");
  $("cSurf").value = surfacesKo(c.ipr_surfaces);
  $("cExclude").value = (c.ipr_exclude || []).map(fdi).sort((a,b) => a-b).join(", ");
  $("cIpr").value = c.ipr_limit_mm;
  $("cCap").value = c.stage_cap ?? "";
  $("cMonths").value = c.stage_cap ? monthsOfCap(c.stage_cap) : "";
  $("cOrder").value = c.order;
  renderCondState();
}
// the form's conditions as short words: 비발치 · 고정 13번 · IPR 면당 0.25mm · 동시
function condWords() {
  const nums = (id) => $(id).value.split(/[,\s]+/).filter(Boolean);
  const ext = nums("cExtract"), lock = nums("cLock"), excl = nums("cExclude"), parts = [];
  parts.push(ext.length ? "발치 " + ext.join("·") + "번" : "비발치");   // the form already reads FDI (#113)
  if (lock.length) parts.push("고정 " + lock.join("·") + "번");
  const surf = $("cSurf").value.split(",").map((s) => s.trim()).filter(Boolean);   // a prescription replaces the even rule (#57), as the server's conditions_ko does
  if (surf.length) parts.push("IPR 처방 " + surf.map((s) => s + "mm").join(" · "));
  else {
    if (excl.length) parts.push("IPR 제외 " + excl.join("·") + "번");
    parts.push("면당 " + ($("cIpr").value || "0") + " mm");
  }
  parts.push($("cCap").value ? "상한 " + $("cCap").value + "장" : "단계 상한 없음");
  parts.push("이동 " + ($("cOrder").options[$("cOrder").selectedIndex]?.textContent ?? ""));
  return parts;
}
// A case with no plan whose calculation failed (#112, 보드 07): the server's sentence as it came, the conditions it
// was tried with, and one way out. Cleared by the next plan list that has rows.
function renderPlanFail() {
  const box = $("planFail"), msg = state.planError;
  box.hidden = !msg;
  if (!msg) return;
  $("planFailMsg").textContent = msg;
  $("planFailCond").replaceChildren(...condWords().map((t) => { const c = document.createElement("span"); c.className = "tag"; c.textContent = t; return c; }));
  $("planFailRetry").disabled = state.streaming || state.loading;
}
// The 조건 tab's two lines: whose conditions the form holds, and whether it still matches the plan on screen (#111)
function renderCondState() {
  const p = state.plan, n = planNo(p?.plan_id);
  $("condFor").textContent = p ? `계획 ${n}의 조건 · 고치면 셋업부터 다시` : state.setup ? "에이전트가 읽은 조건 · 고치면 셋업부터 다시" : "계획을 만들 조건";
  const dirty = constraintsDirty(), el = $("condState"), busy = state.streaming || state.loading;
  // a field that does not read: its sentence in red under it, the field outlined
  const errs = fieldErrors();
  for (const id of ["cExtract", "cLock", "cSurf", "cExclude", "cIpr", "cCap"]) {
    const box = $(id).parentElement.querySelector(".err");
    box.textContent = errs[id] ?? ""; box.hidden = !errs[id];
    $(id).setAttribute("aria-invalid", String(!!errs[id]));
  }
  el.textContent = !p ? "" : dirty ? "조건이 바뀜 · 「다시 계산」으로 새 계획" : "보고 있는 계획의 조건과 같음";
  el.classList.toggle("changed", dirty);
  const diff = p && !Object.keys(errs).length ? condDiff(p.constraints) : "";
  $("condDiff").textContent = diff;
  $("condRecalc").hidden = !p;   // 다시 계산 changes a plan on screen; before one exists the retry bar's 에이전트 없이 계산 does
  $("condRecalc").disabled = busy || !diff;
  $("condApply").hidden = stepIndex(state.progress) < 1;   // a hand-edited condition re-runs the setup turn (#20)
  $("condApply").disabled = busy;
}
// what the form changes against the plan on screen, in one line: 「발치 14·24 → 비발치, 장수 상한 없음 → 32」
function condDiff(base) {
  const c = readConstraints(), out = [];
  const teeth = (ids) => fdiList([...(ids ?? [])].sort((a, b) => fdi(a) - fdi(b)));
  const ext = (ids) => ids?.length ? "발치 " + teeth(ids) : "비발치";
  if (teeth(c.extraction) !== teeth(base.extraction)) out.push(`${ext(base.extraction)} → ${ext(c.extraction)}`);
  for (const [k, name] of [["lock", "고정"], ["ipr_exclude", "IPR 제외"]])
    if (teeth(c[k]) !== teeth(base[k])) out.push(`${name} ${teeth(base[k]) || "없음"} → ${teeth(c[k]) || "없음"}`);
  const surf = (s) => surfacesKo(normSurfaces(s)) || "없음", cs = c.ipr_surfaces && normSurfaces(c.ipr_surfaces, true);   // the form's are FDI
  if (cs && surf(cs) !== surf(base.ipr_surfaces)) out.push(`IPR 처방 ${surf(base.ipr_surfaces)} → ${surf(cs)}`);
  if (Math.abs(c.ipr_limit_mm - (base.ipr_limit_mm ?? 0.25)) > 1e-6) out.push(`면당 IPR ${base.ipr_limit_mm ?? 0.25} → ${c.ipr_limit_mm} mm`);
  if ((c.stage_cap ?? null) !== (base.stage_cap ?? null)) out.push(`장수 상한 ${base.stage_cap ?? "없음"} → ${c.stage_cap ?? "없음"}`);
  const order = (v) => [...$("cOrder").options].find((o) => o.value === v)?.textContent ?? v;
  if (c.order !== (base.order ?? "simultaneous")) out.push(`이동 순서 ${order(base.order ?? "simultaneous")} → ${order(c.order)}`);
  return out.join(", ");
}
function constraintsDirty() {
  if (!state.plan) return false;
  try {
    const c = readConstraints();
    delete c.clear_stage_cap;
    const surfChanged = JSON.stringify(normSurfaces(c.ipr_surfaces, true)) !== JSON.stringify(normSurfaces(state.plan.constraints.ipr_surfaces));
    delete c.ipr_surfaces;
    return surfChanged || Object.keys(c).some(k => JSON.stringify(c[k]) !== JSON.stringify(state.plan.constraints[k]));
  } catch { return true; }
}
function updateActions() {
  const p = state.plan, busy = state.streaming || state.loading;
  const dirty = constraintsDirty(), allowed = p && !busy && !dirty;
  for (const id of ["sendBtn", "caseBtn"]) $(id).disabled = !!busy;
  for (const b of document.querySelectorAll("#plans .plan-row .btn")) b.disabled = !!busy;
  renderCondState();
  $("constraints").disabled = !!busy;
  const exportable = allowed && p.passed && !p.input_stale && ["passed", "skipped"].includes(p.review.status);
  $("exportBtn").disabled = !exportable || state.stlBusy;
  renderRail();
  const building = "STL 만드는 중" + (state.stlProgress ? " · " + state.stlProgress : "…");
  $("exportBtn").textContent = state.stlBusy ? building : p?.approval ? "STL 내려받기" : "내보내기";
  // why the button is off, in the same order as the gate above; nothing while a turn or a load is running
  $("exportWhy").textContent = exportable || busy ? "" : !p ? "계획이 없습니다" : p.input_stale ? "이전 입력의 계획"
    : dirty ? "조건이 바뀜 · 새 계획 뒤 승인" : !p.passed ? `규칙 위반 ${(p.violations ?? []).length}건 · 조건을 바꿔 다시 계획`
    : "검토 실패 · 검토 다시 요청";
  // the rail item is the only visible 내보내기 (#13 polish): dim until the plan can be approved, the reason in its tooltip
  const railExport = document.querySelector('#rail button[data-go="export"]');
  railExport.querySelector("span").textContent = state.stlBusy ? (state.stlProgress ? state.stlProgress : "만드는 중…") : p?.approval ? "STL 받기" : "내보내기";
  railExport.title = $("exportWhy").textContent ? "내보내기 · " + $("exportWhy").textContent : p?.approval ? "단계별 STL(zip)을 내려받습니다" : "승인하고 STL 내보내기";
  $("exportSkip").hidden = !["skipped", "not_requested"].includes(p?.review?.status);
  $("revokeBtn").hidden = !p?.approval;
  $("revokeBtn").disabled = !allowed;
  if (!exportable && !$("exportPop").hidden) showPop($("exportPop"), false);
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
  const row = state.planRows[p.plan_id];
  if (row) { row.review = { ...(row.review ?? {}), status: "running" }; renderPlanList(); }
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
  endCheck();
  $("caseGate").hidden = true;
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
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";   // server sends UTC (+00:00); show the viewer's local time

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

async function activateCase(caseId, { greet = true } = {}) {
  if (state.streaming || state.loading) return;
  ++state.selectionVersion;
  state.requestId = null;
  state.messages = [];
  state.followup = null;
  state.lastRequest = null; $("retryBar").hidden = true;   // 다시 보내기 replays the failed case's request, never into the case opened next
  stopPlay(); scanFx.cancel();
  if (caseId !== state.meshCase) { group.clear(); ghost.clear(); clearLabels(); state.meshCase = null; }
  // plans saved before this opening fold as 지난 계획; the preview this opening makes (#92) is not one of them
  const before = await api("/api/plans?case_id=" + encodeURIComponent(caseId));
  state.oldPlans = new Set(before.plans.map((p) => p.plan_id));
  const info = await api(`/api/cases/${encodeURIComponent(caseId)}/activate`, { method: "POST" });
  $("transcript").innerHTML = "";   // a conversation belongs to one patient scan
  state.planError = info.plan_error ?? null;   // the case opened but no plan could be made: the server's sentence
  state.setup = null; state.target = null; state.targetId = null; state.setupRed = false; state.caseInfo = info;
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
      ? (asPrescribed
        ? `의사 처방(${sample.prescription})을 계획 조건에 넣어 두었습니다.` + (sample.note ? ` ${sample.note}` : "")
        : `이 케이스에서 전에 바꾼 계획 조건이 남아 있습니다. 처방(${sample.prescription})과 다르니 조건 칸을 확인해 주세요.`)
      : `계획을 시작하려면 제약을 알려 주세요.`);
    // no bubble: the case card on the panel top already says it; only a changed prescription is worth a line
    if (sample && !asPrescribed) addMsg("system", "조건이 처방과 다릅니다 · 오른쪽 「조건」 탭을 확인해 주세요.");
    // the agent's first word (#20): the prescription; a sample offers its own as one chip that sends it. A case the
    // server restored further along says where it stands, and the chips continue from there.
    const ask = state.progress === "initial" ? "처방을 적어 주세요."
      : `이 케이스는 ${{ setup: "셋업", target: "목표 배열", stages: "단계" }[state.progress]}까지 되어 있습니다. 이어서 진행하세요.`;
    state.messages.push({ role: "assistant", content: text + " " + ask });
    addNextChips(addMsg("assistant", ask));
  }
}


// The server may send the case's current step state with /activate (#20 decision 1): `state: {setup: constraints|null,
// target_id: str|null, plan_id: str|null}`. Each field opens the strip that far; without it the case opens at 초기.
async function restoreProgress(st) {
  state.restoredStep = null;
  if (!st) return;
  state.restoredStep = STEPS.includes(st.step) ? st.step : null;   // where the case stands: the router lands there when the address names no step
  const setup = st.constraints ?? st.setup;
  if (setup) { state.setup = setup; fillConstraints(setup); setProgress("setup", true); }
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
  clearLabels(); applyStage(0);
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
// The plan cards on the panel top (#111): one row per plan, the plan on screen marked 보는 중, the rest with 보기.
// Plans that existed before the case was opened sit folded under 지난 계획 (#105).
function renderPlanList() {
  const rows = Object.values(state.planRows), cur = state.plan?.plan_id;
  if (rows.length) state.planError = null;
  renderPlanFail();
  $("plans").hidden = !(rows.length && state.step === "stages") && !state.planError;
  const old = rows.filter((r) => state.oldPlans.has(r.plan_id)), now = rows.filter((r) => !state.oldPlans.has(r.plan_id));
  const make = (row) => {
    const div = document.createElement("div");
    const n = planNo(row.plan_id), months = row.months ?? row.info?.months, [pill, cls] = planPill(row);
    div.className = "plan-row" + (row.plan_id === cur ? " current" : "");
    div.dataset.plan = row.plan_id;
    div.title = row.plan_id + (row.parent_plan_id ? " ← " + row.parent_plan_id : " · 최초 계획");
    div.innerHTML = `<span class="n"></span><span class="what"></span><span class="pill"></span><span class="sp"></span>` +
      (row.plan_id === cur ? `<span class="viewing">보는 중</span>` : `<button class="btn ghost" type="button" data-act="view">보기</button>`);
    div.querySelector(".n").textContent = `계획 ${n}`;
    div.querySelector(".what").textContent = `${STRATEGY_KO[row.strategy] ?? row.strategy}` + (row.manual && row.strategy !== "manual" ? " · 수동 조정" : "") + ` · ${row.n_stages}장` + (months != null ? ` · 약 ${months}개월` : "");
    const pl = div.querySelector(".pill"); pl.textContent = pill; pl.classList.add(cls);
    return div;
  };
  $("oldPlans").hidden = !old.length;
  $("oldPlansN").textContent = old.length;
  if (old.some((r) => r.plan_id === cur)) $("oldPlans").open = true;
  $("oldPlanList").replaceChildren(...old.map(make));
  $("planList").replaceChildren(...now.map(make));
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
    state.plan = plan;
    if (cut && cut.plan_id === planId) setCut(cut, "plan:" + planId);
    fillConstraints(plan.constraints);
    const slider = $("stageSlider");
    slider.max = plan.stages.length;
    slider.disabled = false;
    buildIprLabels(); applyStage(0); renderResult(plan); renderStageMarks();
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
  // the fold shows once a review result is in (passed · failed) or the plan is approved; an unreviewed plan has no fold
  $("reviewLine").textContent = memo.body.trim() ? "검토 메모" : "검토";
  $("planReview").hidden = !plan.approval && !["passed", "failed"].includes(review.status);
  renderSide(plan);
  renderLegend(plan);
}
// the 3D legend shows only what this plan has (#13 polish); 선택한 치아 appears once a tooth was picked
function renderLegend(plan) {
  const viol = plan?.violations ?? [], t = plan?.target ?? {};
  const show = { collision: viol.some((v) => v.type === "collision"), move_limit: viol.some((v) => v.type === "move_limit"),
                 locked: (t.locked ?? []).length > 0, removed: (t.removed ?? []).length > 0, ipr: surfacesOf(t, plan?.info).length > 0,
                 ipr_face: Object.keys(state.cutSets[cutKeyNow()] ?? {}).length > 0 };
  for (const el of document.querySelectorAll(".legend [data-key]")) el.hidden = !show[el.dataset.key];
  $("pickedLegend").hidden = !state.pickedOnce;
}

// ---- the sidebar's three panes read the plan on screen; null empties them
function renderSide(plan) {
  renderStagePane(plan);
  renderRulesPane(plan);
  renderCondPane(plan);
}
function renderStagePane(plan) {
  const facts = $("stageFacts"), grid = $("stageGrid");
  facts.innerHTML = ""; grid.innerHTML = "";
  if (!plan) { for (const el of document.querySelectorAll(".grid-legend [data-kind]")) el.hidden = true; return; }
  const n = plan.stages?.length ?? 0, t = plan.target ?? {}, info = plan.info ?? {};
  // two lines (#13 polish): 「확장 · 9단계 · 약 2.1개월」 / 「총생 1.6 mm → 확보 2.1 mm」; the movement notes are on the 규칙 tab
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
const RULE_KO = { collision: "충돌", move_limit: "장당 이동 한계", stage_cap: "장수 상한", space_deficit: "공간 부족",
  extraction_mismatch: "발치 처방 불일치", extraction_space_open: "발치 공간 미폐쇄", ipr_unprescribed: "처방에 없는 IPR",
  // the kinds main had no word for, in v2's vocabulary (sidebar.js)
  rotation_limit: "회전 한도 초과", locked_tooth: "고정 치아 이동", extraction_forbidden: "비발치 규칙 위반",
  ipr_limit: "IPR 한도 초과", ipr_excluded: "IPR 제외 치아 절제" };
const REVIEW_KO = { passed: "검토 통과", failed: "검토 실패", running: "검토 중" };   // not_requested · skipped: 검토 전
function renderRulesPane(plan) {
  const cards = $("ruleCards"), groups = $("violGroups");
  cards.innerHTML = ""; groups.innerHTML = "";
  $("rulesFor").textContent = plan ? `계획 ${planNo(plan.plan_id)} · ${STRATEGY_KO[plan.strategy] ?? plan.strategy} · ${plan.stages?.length ?? 0}장` : "";
  // the planner's movement notes (from the 단계 표 head, #13 polish); they name Universal ids: 「치아 13 회전 …」 → FDI
  // …and a Universal list like [5, 12] → 14·24 until the server writes FDI itself (temporary, #14)
  const toFdi = (s) => s.replace(/치아 (\d+)/g, (_, u) => `치아 ${fdi(u)}`)
    .replace(/\[(\d{1,2}(?:,\s*\d{1,2})*)\]/g, (m, list) => { const ids = list.split(/,\s*/).map(Number); return ids.every((u) => u >= 1 && u <= 16) ? fdiList(ids) : m; });
  $("ruleNotes").textContent = plan ? (plan.target?.notes ?? []).map(toFdi).join(" · ") : "";
  const verdict = $("ruleVerdict");
  verdict.querySelector("b").textContent = ""; verdict.querySelector("span").textContent = "";
  if (!plan) return;
  const viol = plan.violations ?? [], by = (t) => viol.filter((v) => v.type === t);
  // at a glance: 규칙 통과 · 검토 통과 big, or the violation count; after a rule plan where every allowed strategy
  // failed, which plan this is (the least wrong one) and what was tried
  const allFailed = state.allFailed?.plan_id === plan.plan_id ? state.allFailed : null;
  verdict.classList.toggle("fail", viol.length > 0);
  verdict.querySelector("b").textContent = allFailed ? "허용 전략 전부 규칙 위반"
    : viol.length ? `규칙 위반 ${viol.length}건` : `규칙 통과 · ${REVIEW_KO[plan.review?.status] ?? "검토 전"}`;
  verdict.querySelector("span").textContent = allFailed
    ? `시도한 전략 ${allFailed.tried.map((s) => STRATEGY_KO[s] ?? s).join(" · ")} — 가장 덜 틀린 ${STRATEGY_KO[plan.strategy] ?? plan.strategy} 계획의 위반을 아래에 보입니다. 조건을 바꿔 다시 계산하세요.`
    : viol.length ? "아래 위반 항목을 누르면 그 단계로 가서 치아를 강조합니다." : "검사한 규칙";
  const coll = by("collision"), mv = by("move_limit"), cap = by("stage_cap"), sp = by("space_deficit");
  const maxOf = (arr, key) => arr.length ? Math.max(...arr.map((v) => +v[key] || 0)) : 0;
  const rules = [
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
  if (!viol.length) { groups.innerHTML = '<p class="empty">위반 없음</p>'; return; }
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

// ------------------------------------------------------------------ chat
const TOOL_KO = { load_case: "케이스 읽기", list_cases: "케이스 목록", clinical_limits: "임상 한계 읽기", get_constraints: "조건 읽기",
  set_constraints: "조건 설정", propose_target: "목표 배열 제안", plan_stages: "단계 계획", validate: "규칙 검증",
  compare_strategies: "전략 비교", select_plan: "계획 선택", export_stl: "STL 내보내기", get_plan: "계획 읽기",
  load_skill: "임상 규칙 읽기", reviewer: "검토" };
const STRATEGY_KO = { expansion: "확장", ipr: "IPR", expansion_ipr: "확장 + IPR", extraction: "발치", manual: "수동 배치" };
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
// The next moves, as chips right under the agent's bubble (#20): what the finished step allows. One row at a time;
// sending anything folds the open row.
const NEXT_STEP = { initial: "setup", setup: "target", target: "stages", stages: "stages" };
function nextChips() {
  const sample = sampleOf(state.meshCase);
  const extraction = state.setup ? (state.setup.extraction ?? []).length > 0 : ($("cExtract").value.trim() !== "");
  switch (state.progress) {
    case "initial": return sample ? [{ label: "이 케이스의 처방 넣기", message: sample.request, step: "setup", hint: sample.prescription }] : [];
    case "setup": return [{ label: "목표 배열 만들기", message: "이 조건으로 목표 배열을 만들어줘.", step: "target" }, { label: "조건 바꾸기", action: "cond" },
                          { label: "처음부터 수동 배치", action: "manualScan", hint: "에이전트 목표 없이, 치료 전 위치에서 치아를 직접 옮깁니다" }];
    // a hand-edited target (직접 이동) is staged as it is: a condition change or a comparison would make new targets
    case "target": return isManualTarget()
      ? [{ label: "단계 만들기", message: "직접 옮긴 이 목표 배열 그대로 단계를 만들어줘.", step: "stages" },
         { label: "에이전트 없이 단계 계산", action: "manualStages", hint: "모델 없이 이 목표 배열을 단계로 나누고 규칙을 검사합니다" },
         { label: "다시 조정", action: "manual" }]
      : [{ label: "단계 만들기", message: "이 목표로 단계를 만들어줘.", step: "stages" },
         { label: "8개월 안에", message: "8개월 안에 끝나게 단계를 만들어줘.", step: "stages" },
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
    if (b.dataset.action === "manualScan") { if (state.step !== "setup") setStep("setup"); manualEdit.open(); return; }
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
  if (state.selected.size && !resend) {
    text = `[선택한 치아: ${[...state.selected].map(fdi).sort((a, b) => a - b).join(", ")}번] ` + text;
    state.selected.clear(); renderSelection();
  }
  const requestId = crypto.randomUUID(), caseId = state.meshCase, prevPlanId = state.plan?.plan_id ?? null;
  // the step this turn asks for (#20): the next one after the progress, or the one the chip/button names
  const turnStep = step ?? (resend ? state.lastRequest?.step : null) ?? NEXT_STEP[state.progress] ?? "stages";
  state.requestId = requestId;
  setStreaming(true); updateActions();
  foldNextChips();
  $("retryBar").hidden = true;
  $("planNotice").textContent = turnStep === "setup" ? "처방을 조건으로 옮기는 중" : turnStep === "target" ? "목표 배열 만드는 중"
    : state.plan ? "재계획 중 · 현재 3D는 이전 계획입니다." : "단계 계획 만드는 중";
  if (turnStep === "setup") scanFx.start(caseId, prescribed(constraints));   // the scan is read and the prescription applied on the 3D
  $("chatInput").value = ""; autosize();
  if (resend && state.messages.at(-1)?.role === "user" && state.messages.at(-1).content === text) state.messages.pop();
  state.messages.push({ role: "user", content: text });
  state.lastRequest = { text, constraints, step: turnStep };
  const userBubble = addMsg("user", text);
  state.trace = newTrace();
  const bubble = addMsg("assistant", "");
  // a sample case may skip the agent (#15): after 8 s of streaming a 건너뛰기 sits under the answer; a failed turn offers it too
  const sample = !!sampleOf(caseId), ac = new AbortController();
  state.abort = ac; state.skippedTurn = null;
  state.turnStep = stepOf(text, turnStep);   // which recorded answer 건너뛰기 would play for this turn
  let skipRow = null;
  const skipTimer = sample ? setTimeout(() => { if (state.requestId === requestId) skipRow = addSkipRow(bubble, requestId); }, 8000) : null;
  $("retryFallback").hidden = sample; $("skipBtn").hidden = !sample;
  let answer = "", selected = null, streamError = false, overload = null, stepDone = null, refusedPii = null;
  const handle = ({type, data: obj}) => {
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
      // the server's own sentence, worth a 다시 보내기: NIM overload, or a final answer with no Korean in it (no_answer)
      if ((obj.kind === "nim_overload" || obj.kind === "no_answer" || obj.kind === "nim_auth") && (obj.request_id ?? state.requestId) === state.requestId) overload = obj;
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
      body: JSON.stringify({ messages: state.messages, step: turnStep, cualign: { request_id: requestId,
        case_id: caseId, base_plan_id: state.plan?.plan_id ?? null, constraints } }), signal: ac.signal });
    if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
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
    if (stepDone && !streamError) await landStep(stepDone);
    if (selected && !streamError) {
      await refreshPlans(selected.plan_id);
      setStep("stages");
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
    clearTimeout(skipTimer); skipRow?.remove(); scanFx.release();
    if (state.requestId === requestId) { setStreaming(false); updateActions(); }
  }
}
// step_done (#20): the agent finished a step. setup → its constraints go to the form and the 3D marks them; target →
// the target state comes from /targets and the 3D shows it; stages → plan_selected does the rest.
async function landStep(done) {
  if (done.step === "setup" && done.constraints) {
    state.setup = done.constraints; state.target = null; state.targetId = null;
    fillConstraints(done.constraints);
    setProgress("setup", true);
    scanFx.landed(done.constraints);
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
// 건너뛰기 (#15): the rule plan on screen is the plan; a running turn is cut, its answer dropped
function addSkipRow(bubble, requestId) {
  const row = document.createElement("div");
  row.className = "skip-row";
  row.innerHTML = '<span>에이전트가 답하는 중입니다.</span><button class="btn ghost small" type="button">건너뛰기</button>';
  row.querySelector("button").addEventListener("click", () => skipTurn(requestId));
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
// 건너뛰기 plays the recorded answer for this step (contract 12-replay.md); with none recorded (404) the rule plan on
// screen is adopted. The recorded answer sits where the agent's would, marked grey with its date.
async function replayOrAdopt(bubble, caseId, prevPlanId) {
  $("retryBar").hidden = true;
  // a recorded answer makes its own targets; a hand-edited target is staged as it is instead
  if (isManualTarget() && state.progress === "target" && !["setup", "target"].includes(state.turnStep)) { bubble.remove(); return stageManualTarget(); }
  if (state.turnStep === "setup") { try { scanFx.start(caseId, prescribed(readConstraints())); } catch { /* the form does not parse: no reveal */ } }
  try {
    const r = await fetch(`/api/cases/${encodeURIComponent(caseId)}/replay`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: state.turnStep ?? "stages", base_plan_id: state.plan?.plan_id ?? null }) });
    if (r.status === 404) { bubble.remove(); adoptCurrentPlan(); return; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const rec = await r.json();
    setAnswer(bubble, rec.answer_md ?? "");
    bubble.classList.add("recorded");
    const tag = document.createElement("small"); tag.className = "recorded-tag"; tag.textContent = "녹화된 답 · " + (rec.recorded_at ?? "").slice(0, 10);
    tag.title = "녹화 시각 " + (rec.recorded_at ?? "");   // the full stamp in the badge's tooltip
    bubble.prepend(tag);
    state.messages.push({ role: "assistant", content: rec.answer_md ?? "" });
    addMsg("system", "에이전트 답을 건너뛰고 녹화된 답을 보였습니다.");
    // a recorded setup or target lands like the agent's step_done (#20); a plan like its plan_selected
    if (rec.constraints) await landStep({ step: "setup", constraints: rec.constraints });
    else if (rec.target_id) await landStep({ step: "target", target_id: rec.target_id, summary: rec.summary });
    const sel = rec.plan_selected;   // null on a compare of an extraction case (the answer only asks back): the bubble alone, cards and 3D stay
    if (!sel?.plan_id) $("planNotice").textContent = "";
    if (sel?.plan_id) {
      await refreshPlans(sel.plan_id);
      setStep("stages");
      addDecision(prevPlanId, sel.plan_id);
      if (state.plan?.plan_id === sel.plan_id && state.plan.review?.status === "passed") addReviewQuestions(bubble, state.plan.review.message);
    }
    addNextChips(bubble);
  } catch (e) {
    bubble.remove();
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
    // every allowed strategy broke a rule: the 규칙 tab says so over the least-wrong plan's violations
    state.allFailed = !res.chosen && selected ? { plan_id: selected.plan_id, tried: (res.tried ?? []).map((t) => t.strategy) } : null;
    if (selected) {
      await refreshPlans(selected.plan_id); setStep("stages");
      if (fromCond) addMsg("system", `조건을 바꿔 규칙으로 다시 계산했습니다 — 계획 ${planNo(selected.plan_id)}`);
      addDecision(prevPlanId, selected.plan_id); addNextChips($("transcript").lastElementChild);
    }
    if (!res.chosen) { addMsg("system", "허용 전략 전부 규칙 위반 — 의사 승인이 제한됩니다."); if (selected) { renderRulesPane(state.plan); showTab("rules"); } }
  } catch (e) {
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
    addMsg("error", "단계를 만들지 못했습니다: " + e.message);
  } finally { setStreaming(false); updateActions(); }
}

// ------------------------------------------------------------------ stage playback
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
    state.clSelected = state.clSelected === el.dataset.id ? null : el.dataset.id;
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
    if (state.meshCase === caseId) { group.clear(); ghost.clear(); clearLabels(); state.meshCase = null; }
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
// plan cards: 보기 puts that plan in the 3D and the sidebar (#111)
$("plans").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act=view]"), id = btn?.closest(".plan-row")?.dataset.plan;
  if (!id || state.streaming || state.loading) return;
  loadPlan(id).catch((err) => addMsg("error", `계획 로드 실패: ${err.message}`));
});
// sidebar tabs
for (const b of document.querySelectorAll(".side-tab")) b.addEventListener("click", () => (b.dataset.tab === "move" ? manualEdit.open() : showTab(b.dataset.tab)));
function showTab(name) {
  state.tab = name;
  for (const b of document.querySelectorAll(".side-tab")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  $("paneScan").hidden = name !== "scan"; $("paneStages").hidden = name !== "stages"; $("paneRules").hidden = name !== "rules"; $("paneCond").hidden = name !== "cond";
  $("paneMove").hidden = name !== "move";
}
// the scan as it came (#20): tooth count, crowding, what is missing between 17 and 27
function renderScanPane(info) {
  const rows = [];
  if (info) {
    const present = new Set(Object.keys(state.teeth).map((id) => fdi(id)));
    const missing = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27].filter((n) => !present.has(n));
    rows.push(["치아", `${info.n_teeth ?? Object.keys(state.teeth).length}개`], ["총생", info.crowding_mm != null ? `${info.crowding_mm} mm` : "—"],
              ["결손", missing.length ? missing.join(", ") + "번" : "없음"]);
  }
  $("scanFacts").replaceChildren(...rows.flatMap(([k, v]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; return [dt, dd]; }));
  $("scanFor").textContent = info ? (sampleOf(state.meshCase)?.prescription ? "처방 · " + sampleOf(state.meshCase).prescription : "처방은 대화로") : "";
}
$("condApply").addEventListener("click", () => {
  let constraints;
  try { constraints = readConstraints(); } catch (e) { addMsg("error", e.message); return; }
  send("조건을 이렇게 바꿔서 다시 셋업해줘.", constraints, { step: "setup" });
});
// a row of the stage table moves the 3D to that stage
$("stageGrid").addEventListener("click", (e) => {
  const k = e.target.closest("[data-stage]")?.dataset.stage;
  if (k == null || !state.plan) return;
  stopPlay(); applyStage(+k);
});
// a violation item (or one of its stage buttons): playback stops, the slider goes to the stage, its teeth are selected
$("violGroups").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-teeth]");
  if (!b || b.disabled || !state.plan) return;
  stopPlay();
  if (state.step !== "stages") setStep("stages");
  const ids = b.dataset.teeth.split(",").filter(Boolean);
  if (ids.length) {
    state.selected.clear(); for (const id of ids) state.selected.add(id);
    state.pickedOnce = true; $("pickedLegend").hidden = false;
    renderSelection();
  }
  applyStage(b.dataset.stage != null ? +b.dataset.stage : state.stage);   // after the selection: it paints the highlight with the stage's marks
});
$("stageSlider").addEventListener("input", (e) => { stopPlay(); applyStage(+e.target.value); });
$("playBtn").addEventListener("click", togglePlay);
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
$("exportBtn").addEventListener("click", () => {
  if (state.plan?.approval) { $("stlLink").click(); return; }
  const pop = $("exportPop");
  showPop(pop, pop.hidden);
  // the popover sits beside the rail item that opened it (the anchor button itself is hidden)
  const r = document.querySelector('#rail button[data-go="export"]').getBoundingClientRect();
  pop.style.top = `${Math.round(r.top)}px`; pop.style.left = `${Math.round(r.right + 8)}px`;
});
$("exportCancel").addEventListener("click", () => showPop($("exportPop"), false));
$("exportGo").addEventListener("click", async () => {
  showPop($("exportPop"), false);
  if (!state.plan?.approval) await approveCurrent();
  if (state.plan?.approval && $("stlLink").hasAttribute("href")) $("stlLink").click();
});
// The server builds the zip on every download (5–11 s on a real scan, #119), and a link click shows nothing until the
// file arrives: fetch it so the button says so meanwhile (and a refused download shows its reason instead of being
// saved as the file), then hand it to the browser. Every download path clicks the hidden link, which lands here.
// One transcript card per approval once its file arrives; 다시 내려받기 downloads again.
// One toast per approval once its file arrives (#20: no line in the agent panel, no 다시 내려받기; the rail button downloads again)
const doneCards = new Set();
function toast(text, ms = 3200) {
  const el = $("toast"); el.textContent = text; showPop(el, true);
  clearTimeout(toast.timer); toast.timer = setTimeout(() => showPop(el, false), ms);
}
// While the zip builds, the server may report its progress (contract: GET /api/plans/{id}/export-status →
// {building, done, total}); the rail label shows N/총 when it does, plain 만드는 중 when it does not
async function pollExportStatus(planId) {
  while (state.stlBusy && state.plan?.plan_id === planId) {
    try {
      const r = await fetch(`/api/plans/${encodeURIComponent(planId)}/export-status`);
      if (r.status === 404) return;   // the server has no progress to give
      const st = await r.json();
      state.stlProgress = st.total ? `${st.done ?? 0}/${st.total}` : null;
      if (state.stlBusy) updateActions();
    } catch { return; }
    await new Promise((res) => setTimeout(res, 500));
  }
}
async function downloadStl() {
  const p = state.plan, link = $("stlLink");
  if (state.stlBusy || !p?.approval || !link.hasAttribute("href")) return;
  state.stlBusy = true; state.stlProgress = null; updateActions();
  pollExportStatus(p.plan_id);
  try {
    const r = await fetch(link.href);
    if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.detail || ("HTTP " + r.status)); }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `cualign_${p.plan_id}_stages.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    addMsg("error", `STL 내려받기 실패: ${err.message}`);
    return;
  } finally {
    state.stlBusy = false; state.stlProgress = null; updateActions();
  }
  const key = p.plan_id + "@" + p.approval.approved_at;
  toast(`${doneCards.has(key) ? "" : "승인 완료 · "}단계별 STL ${p.stages?.length ?? p.info?.n_stages ?? "?"}장을 내려받았습니다`);
  doneCards.add(key);
}
$("stlLink").addEventListener("click", (e) => { e.preventDefault(); downloadStl(); });
$("revokeBtn").addEventListener("click", approveCurrent);
$("reviewBtn").addEventListener("click", reviewCurrent);
$("cMonths").addEventListener("input", () => { const m = Number($("cMonths").value); $("cCap").value = m > 0 ? capOfMonths(m) : ""; });
$("cCap").addEventListener("input", () => { const cap = Number($("cCap").value); $("cMonths").value = cap > 0 ? monthsOfCap(cap) : ""; });
$("constraints").addEventListener("input", () => updateActions());
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("dblclick", () => setView("occlusal"));   // back to the first view (#15)
canvas.addEventListener("pointerleave", () => { $("tip").hidden = true; });
for (const b of document.querySelectorAll(".view-rail button[data-view]")) b.addEventListener("click", () => setView(b.dataset.view));

manualEdit = createManual({ THREE, scene, camera, canvas, state, $, fdi, api, applyStage, showTab, addMsg, toast, loadTargetCut,
  afterApply: () => addNextChips($("transcript").lastElementChild),
  // 처음부터 수동 배치: the scan-position target is shown as the 목표 while it is edited; 취소 puts the flow back
  enterTarget: (t) => { state.target = t; state.targetId = t.target_id; state.targetSummary = null; setProgress("target", true); setStep("target"); loadTargetCut(t.target_id); },
  restoreFlow: (prev) => { state.target = prev.target; state.targetId = prev.targetId; setProgress(prev.progress, true); setStep("setup"); } });

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
  if (active) { state.clSelected = active; renderCaseList(); }   // the list opens on the case the server has active
  // a reload or a shared address opens the same screen; otherwise this is the start state
  if (location.hash && location.hash !== "#start") {
    routing = true;
    try { await route(location.hash); } catch (e) { addMsg("error", e.message); }
    routing = false;
  } else { history.replaceState(null, "", "#start"); renderRail(); }   // the rail lights 「환자」 on the very first paint too
  } finally { document.documentElement.classList.remove("booting"); }   // the address's screen is on: show it (#15)
})();
window.__cualign = { renderMd, reviewQuestions, addReviewQuestions, loadPlan, state, camera, controls, setView, cutKeyNow, readConstraints };   // test hook (scratch browser checks)
