// app.js 에서 나눈 모듈: the three.js scene — renderer, camera, controls, lights, the render loop, the gum, the crowns and
// their IPR cuts, the view buttons, the design flow's step strip (setStep) and applyStage.
import { THREE, CSS2DRenderer, CSS2DObject, threeError } from "./three-load.js";
import { createScanFx } from "./scan-reveal.js";
import { createValidateSweep } from "./validate-sweep.js";
import { createStageGrow } from "./stage-grow.js";
import { $, api, fdi, manualEdit, state, surfacesOf } from "./state.js";
// defined in later modules: app.js hands them in (wire) before any of them is called
let caseHash, closeExportPop, followStep, markScanRx, markStage, renderPlanList, renderSelection, setHash,
  setWorkNote, stopPlay;
export function wire(fns) { ({ caseHash, closeExportPop, followStep, markScanRx, markStage, renderPlanList,
    renderSelection, setHash, setWorkNote, stopPlay } = fns); }
// Colours follow clinical software conventions (docs/research/2026-09-23-원내-얼라이너-SW-화면-역설계.md):
// teeth are ivory, movement is a heat tint, collisions red, limit breaches amber, locked teeth blue.
const IVORY = new THREE.Color(0xe9e3d6);
const RED = 0xe52020, AMBER = 0xef9100, BLUE = 0x4f8fd6;   // DESIGN.md colors.error, warning, locked
const IPR_FACE = 0x2f8ae8;   // the IPR cut planes on a crown (#22, DESIGN.md colors.ipr-face)
const IPR_FACE_MAT = new THREE.MeshStandardMaterial({ color: IPR_FACE, roughness: 0.45, metalness: 0.02, side: THREE.FrontSide });

// ------------------------------------------------------------------ three.js
const canvas = $("viewCanvas");
// No WebGL (turned off, a blocked GPU) or no three.js (the CDN out of reach): the 3D area shows the #no3d card and the
// renderer draws nothing, so the chat, the stage table, rules, conditions, approval and export keep working.
const renderer = (() => {
  try {
    if (!threeError) {
      const probe = document.createElement("canvas"), gl = probe.getContext("webgl2") || probe.getContext("webgl");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      if (gl) return new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    }
  } catch (e) { console.warn("3D off:", e); }
  document.body.classList.add("no-3d");
  $("no3d").hidden = false;
  if (threeError) $("no3dHint").textContent = "3D 라이브러리(three.js)를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.";
  return { setPixelRatio() {}, setSize() {}, render() {} };
})();
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const labelRenderer = new CSS2DRenderer({ element: $("labels") });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
// Free arc rotation (#18): a horizontal drag always turns about the root axis (world z), a vertical drag pitches about
// the camera's own right axis, both accumulated on the camera quaternion. No pole clamp (OrbitControls stopped at the
// poles, #132) and no roll drift: the right axis starts level with the arch plane and neither turn tilts it. The
// presets place the camera with lookAt (up = −z, apical) and then only the quaternion is kept; camera.up is unused.
const controls = {
  target: new THREE.Vector3(), dist: 100, vel: { yaw: 0, pitch: 0 }, damping: 0.85, speed: 0.006, minDist: 5 * 1.25, maxDist: 1500 * 1.25,
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
  fitted: null,   // the preset on screen until the pointer or the wheel moves the view: a resize fits it again
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
    // the near surface follows the pointer: a turn about world z reads the other way round when z points down on screen
    // (every preset looks with up = −z, crowns down), so the horizontal sign is taken from the camera's up at the press
    const yawSign = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).z < 0 ? -1 : 1;
    drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey, yawSign }; controls.dragging = true; controls.fitted = null;
    controls.vel.yaw = controls.vel.pitch = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; lastMove = performance.now();
    if (drag.pan) controls.pan(dx, dy);
    else { const yaw = -dx * controls.speed * drag.yawSign; controls.rotate(yaw, -dy * controls.speed); controls.vel.yaw = yaw * 0.5; controls.vel.pitch = -dy * controls.speed * 0.5; }
  });
  const end = () => { if (!drag) return; drag = null; controls.dragging = false; if (performance.now() - lastMove > 80) controls.vel.yaw = controls.vel.pitch = 0; };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); controls.fitted = null; controls.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(30, 40, 120); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-50, -30, 60); scene.add(fill);
// a weak light from behind and the root side: the hemisphere's ground colour falls on every face turned back (−y), so a
// canine's distal side bared by an extraction read as a dark slab. It reaches no occlusal (+z) face: the tops keep their shade.
const under = new THREE.DirectionalLight(0xffffff, 0.5); under.position.set(0, -60, -80); scene.add(under);
const group = new THREE.Group(); scene.add(group);
// the scan reveal on the setup turn and the IPR tool cursor (scan-reveal.js); the prescription it plays is the one the
// setup landed with (step_done / the recording, Universal)
const scanFx = createScanFx({ THREE, CSS2DObject, group, camera, state, fdi, notice: $("planNotice"),
  refresh: () => { applyStage(state.stage); renderSetupMarks(); }, recut: () => applyStage(state.stage),
  stageContacts: (p) => contactsOnScreen(surfacesOf(p.target, p.info), new Set((p.target?.removed ?? []).map(String))) });
// the 스캔 tab's chart subscribes to scan-reveal ② (the prescription on the 3D): every applyPrescription marks it too
const applyPrescription3d = scanFx.applyPrescription;
scanFx.applyPrescription = (rx) => { applyPrescription3d(rx); markScanRx(rx); };
// the crowns swept while the rule check runs, its violations left red (validate-sweep.js)
const sweepFx = createValidateSweep({ state });
const raycaster = new THREE.Raycaster();

function resize() {
  const wrap = $("canvasWrap");
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // the opening fit runs while the start screen still holds the layout; until the view is moved, a new size fits again
  if (controls.fitted && w && h) setView(controls.fitted);
}
new ResizeObserver(resize).observe($("canvasWrap"));

// +x is the patient's left (tooth 15 side), +y anterior, +z occlusal (see setView).
const VIEWS = { occlusal: "교합면", frontal: "정면", left: "환자 왼쪽", right: "환자 오른쪽" };
// ?fps=N draws the 3D at most N times a second (a test browser on software WebGL, where every frame costs a core); without
// it every frame is drawn. The effects run on elapsed time, so they end the same at any rate.
const FRAME_GAP = 1000 / (Number(new URLSearchParams(location.search).get("fps")) || Infinity);
let lastFrame = -Infinity;
(function loop() {
  const t = performance.now();
  if (t - lastFrame >= FRAME_GAP - 1) {
    lastFrame = t;
    controls.update(); scanFx.tick(); sweepFx.tick(); window.__stageGrow?.tick(); renderer.render(scene, camera); labelRenderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
})();

const ghost = new THREE.Group(); scene.add(ghost);
const GHOST_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false });
// the stage tool's 「단계가 자라난다」 (stage-grow.js): ghost at the target, the cursor stepping the crowns, the table filling
const stageGrow = createStageGrow({ THREE, CSS2DObject, group, ghost, state, applyStage: (k) => applyStage(k), setWorkNote: (on, text) => setWorkNote(on, text) });
import("./target-reveal.js").then((m) => m.createTargetReveal({ THREE, CSS2DObject, scene, group, ghost, state, applyStage, setWorkNote }));   // the target tool's 「치열궁을 따라 자리 잡는다」: it watches the tool rows and the landing itself
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
    let dx = 0, dy = 0;
    for (let j = 0; j < GUM_K; j++) {
      const t = moves[skin.ids[v * GUM_K + j]], g = skin.w[v * GUM_K + j] * share;
      if (!t) continue;
      const rx = x - t.c[0], ry = y - t.c[1];
      dx += g * (t.cos * rx - t.sin * ry + t.c[0] + t.d[0] - x);
      dy += g * (t.sin * rx + t.cos * ry + t.c[1] + t.d[1] - y);
    }
    // vertical: the nearest crown still there alone (a levelled crown's gum rose only 20–30 % of it when averaged with
    // neighbours that stay, PR #197 ③a); the blend is for xy, and the smoothing passes below soften the seams
    const near = skin.ids.subarray(v * GUM_K, v * GUM_K + GUM_K).find((i) => !removed.has(skin.toothIds[i]));
    const dz = present > 1e-6 && near !== undefined ? all * (st[skin.toothIds[near]]?.[2] ?? 0) : 0;
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
  sweepFx.clear();
  group.clear(); ghost.clear(); state.teeth = {}; state.center = {}; state.gum = null; scanFx.cancel();
  state.violLabels = []; state.selected.clear(); state.ruleMarked.clear(); renderSelection();
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
// Which cut the view shows: 초기 none; 셋업 the setup's prescribed contacts (before any target or plan exists);
// 목표 the target's when the target turn gave one, else the plan's; 단계 the plan's. A key with no set fetched yet
// shows the scan's crowns.
function cutKeyNow() {
  if (state.step === "initial") return null;
  if (state.step === "setup" && state.setup) return "setup";
  const t = state.targetId ? "target:" + state.targetId : null, p = state.plan ? "plan:" + state.plan.plan_id : null;
  return state.step === "stages" ? p ?? t : t ?? p;
}
// the setup's cut dentition: GET /setup/cut → {teeth_cut, ipr_cut} of the prescribed contacts the setup landed with.
// The previous setup's set goes at once, so a new setup never shows the old one's cut while this is in flight.
async function loadSetupCut() {
  const caseId = state.meshCase;
  setCut(null, "setup");
  try {
    const view = await api(`/api/cases/${encodeURIComponent(caseId)}/setup/cut`);
    if (caseId !== state.meshCase) return;
    setCut(view, "setup");
    if (cutKeyNow() === "setup") applyStage(state.stage);
  } catch { /* the setup shows the scan's crowns */ }
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
const FIT_MARGIN = 1.25 * 1.25;
function setView(kind) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // the fit is by the vertical fov; a narrow viewer (1366 wide, #17-10) is limited by width, so the camera backs off by the aspect.
  // FIT_MARGIN: the opening view and every preset at 80% of the old size (1.25 → 1.25 × 1.25)
  const dist = Math.max(size.x, size.y, size.z) / (2 * Math.tan((camera.fov * Math.PI) / 360)) * FIT_MARGIN / Math.min(1, camera.aspect);
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
  controls.fitted = kind;
  for (const b of document.querySelectorAll(".view-rail [data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === kind));
}

// ---- the design flow (#15): 초기 → 셋업 → 목표 → 단계. The server computed the plan when the case opened; the
// screen reveals it in steps. The step lives in body.step-* and in the address (&step=).
const STEPS = ["initial", "setup", "target", "stages"];
// The strip is progress (#20): the agent's turns move it forward (step_done), the dentist only looks back at steps
// that are done (초기 ↔ 목표 to compare). The plan the 3D shows for a step: the target before any plan exists,
// otherwise the plan.
const stepIndex = (s) => STEPS.indexOf(s);
const viewPlan = () => ((state.step === "target" || manualEdit.active) && state.target ? state.target : state.plan);   // 직접 이동 draws its draft as the target, on 셋업 too
function setProgress(step, reset = false) {   // reset: a new setup or target makes the later steps stale again
  if (!reset && stepIndex(step) <= stepIndex(state.progress)) return;
  state.progress = step;
  for (const s of STEPS) document.body.classList.toggle("prog-" + s, stepIndex(s) <= stepIndex(step));
  renderFlow();
}
function setStep(step) {
  if (!STEPS.includes(step) || stepIndex(step) > stepIndex(state.progress)) step = state.progress;
  if (manualEdit.leave(step)) return;   // a hand edit is stored before the view leaves its step (manual.js sets the step once stored)
  state.step = step;
  closeExportPop();   // the card was about the step it opened on
  for (const s of STEPS) document.body.classList.toggle("step-" + s, s === step);
  stopPlay();
  const n = viewPlan()?.stages?.length ?? 0;
  applyStage(step === "target" ? n : 0);   // 목표 = the last stage; the others start at the scan
  renderSetupMarks();
  renderFlow();
  renderPlanList();
  followStep(step);   // the right panel follows the step
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
// 셋업 marks over the 3D: a yellow dot and its mm at each prescribed IPR contact (drawn even where the contact is open:
// the core cuts from each crown's own contact surface; an amount too small to cut reads 여유), arrows on the last
// crowns when the arch widens. Only in the 셋업 state: 목표·단계 show the cut crowns without marks.
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
    const num = document.createElement("span"); num.className = "ipr-mm"; num.textContent = mm >= 0.005 ? mm.toFixed(2) : "여유"; el.append(num);
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
$("flow").addEventListener("click", (e) => { const s = e.target.closest("button:not([disabled])")?.dataset.step; if (s && state.meshCase) { if (s !== state.step) sweepFx.clear(); setStep(s); } });

function violationsAt(k) {
  const by = {};   // tooth -> Set(type)
  for (const v of viewPlan()?.violations ?? []) {
    if (v.stage !== k || !v.teeth) continue;
    for (const t of v.teeth) (by[String(t)] ??= new Set()).add(v.type);
  }
  return by;
}

function applyStage(k) {
  if (state.stageTouched) sweepFx.clear();   // the dentist moved the stage: the rule check's red goes
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
    const cut = cutSet?.[id] && scanFx.cutShown(id) ? cutSet[id] : null;   // the setup reveal cuts a crown as its cursor passes
    m.geometry = cut ? cut.geo : m.userData.full;
    if (cut) m.userData.cutMesh.geometry = cut.faces;
    m.userData.cutMesh.material = setup ? IPR_FACE_MAT : m.material;   // the planes blue in 셋업 only; after it the crown is just cut
    // turn about the crown's own vertical axis through its centroid c: v' = R(v - c) + c + d  =>  position = d + c - R c
    const a = ((rot[id] ?? 0) * Math.PI) / 180, c = plan?.pivots?.[id] ?? [0, 0, 0], t = d ?? [0, 0, 0];
    m.rotation.set(0, 0, a);
    m.position.set(t[0] + c[0] - (Math.cos(a) * c[0] - Math.sin(a) * c[1]), t[1] + c[1] - (Math.sin(a) * c[0] + Math.cos(a) * c[1]), t[2]);
    // 치료 전 (k = 0) is the scan with every crown; the extracted crowns are gone from stage 1 on, no silhouette left
    const gone = hasPlan && removed.has(id) && !plain && !setup && k > 0;
    // 셋업 (#20): the extracted crowns flash red as the setup lands, then they are gone (the filled gum shows)
    m.visible = setup && removed.has(id) ? state.setupRed : !gone;
    m.userData.cutMesh.visible = !!cut && m.visible;
    const moved = d ? Math.hypot(...d) : 0;
    m.userData.moved = moved;
    m.userData.viol = bad[id] ? [...bad[id]] : [];
    if (plain) m.material.color.copy(IVORY);
    else if (setup) m.material.color.setHex(removed.has(id) ? RED : IVORY.getHex());   // 셋업: what the constraints remove
    else if (bad[id]?.has("collision")) m.material.color.setHex(RED);
    else if (bad[id]?.has("move_limit")) m.material.color.setHex(AMBER);
    else if (locked.has(id)) m.material.color.setHex(BLUE);
    else m.material.color.copy(IVORY);
    m.material.emissive.setHex(state.selected.has(id) ? 0x5a9400 : 0x000000);
  }
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

export { AMBER, BLUE, STEPS, applyStage, buildTeeth, camera, canvas, controls, cutKeyNow, ghost, group, loadSetupCut,
  loadTargetCut, raycaster, renderSetupMarks, resize, scanFx, scene, setCut, setProgress, setStep, setView,
  stageGrow, stepIndex, sweepFx };
