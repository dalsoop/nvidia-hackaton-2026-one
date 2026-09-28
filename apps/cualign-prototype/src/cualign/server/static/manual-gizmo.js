// 직접 이동의 3D 손잡이: 선택한 치관 위에 치아 자신의 축(근원심·협설·수직)을 따른 양방향 화살표 셋과 장축 회전 고리.
// 치관 위에 그리고(깊이 검사 없음), 판정 도형은 보이는 손잡이 둘레에만 둔다: 화살표 촉과 바깥쪽 대, 고리. 치관 가운데
// (반지름 HOLE 안)는 비워 둬서 치관 위에서 시작한 드래그는 손잡이를 잡지 않은 한 화면 회전이다 — 선택한 치관을 돌려 보려다
// 옮기는 일이 없게. 3D 로 비운 것만으로는 모자라다: 교합면 쪽에서 보면 수직 화살표 촉이 치관 가운데 바로 위에 선다. 그래서
// 화면에서도 손잡이 원점 둘레 HOLE mm 안의 누름은 손잡이로 치지 않는다. 손잡이 위에서는 커서가 grab 으로 바뀐다. 손잡이를 누르면 그 드래그는 궤도 회전이 보지 못하게
// 가로채고(capture 단계에서 stopImmediatePropagation), 끌지 않고 뗀 클릭은 onClick 으로 넘긴다.

import { AXES } from "./manual-math.js";

const COLORS = { mesial: 0xff5da2, buccal: 0x2ec4b6, occlusal: 0x9b7bff, yaw: 0xffd166 };
const L = 5, R = 6, HOLE = 4;   // arrow half-length, ring radius, the free middle of the arrows (no hit), mm

// callbacks: isActive() — the edit is on; onDragStart(handle) — a drag begins (false cancels it);
// onDrag(handle, amount) — mm along the axis since the press, or degrees about +z for "yaw"; onDragEnd(); onClick(e)
export function createGizmo({ THREE, scene, camera, canvas }, { isActive, onDragStart, onDrag, onDragEnd, onClick }) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const hits = [], arrows = {};
  const mat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
  const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  for (const k of AXES) {
    const g = new THREE.Group(), m = mat(COLORS[k]);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2 * L, 8), m);
    for (const s of [1, -1]) {
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 14), m);
      head.position.y = s * (L + 0.75); if (s < 0) head.rotation.z = Math.PI;
      g.add(head);
    }
    g.add(shaft);
    for (const s of [1, -1]) {   // the outer shaft and the head on each side; the middle stays the crown's
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, L + 1.5 - HOLE, 6), hitMat);
      hit.position.y = s * (HOLE + L + 1.5) / 2;
      hit.userData.handle = k; hits.push(hit); g.add(hit);
    }
    for (const o of g.children) o.renderOrder = 999;
    root.add(g); arrows[k] = g;
  }
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 72), mat(COLORS.yaw));
    const hit = new THREE.Mesh(new THREE.TorusGeometry(R, 0.5, 6, 48), hitMat);
    hit.userData.handle = "yaw"; hits.push(hit);
    ring.renderOrder = hit.renderOrder = 999;
    root.add(ring, hit);
  }
  let frame = null, drag = null, down = null, hover = false;

  // ---- screen helpers
  const ray = new THREE.Raycaster();
  const ndc = (e) => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  const toScreen = (v) => { const p = v.clone().project(camera), r = canvas.getBoundingClientRect(); return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top]; };
  // the first of `objects` under the pointer
  function pick(e, objects) { ray.setFromCamera(ndc(e), camera); return ray.intersectObjects(objects, false)[0] ?? null; }
  // the handle under the pointer, none within HOLE mm of the handles' origin on screen (the crown's middle turns the view)
  function grab(e) {
    const o = toScreen(root.position), r = toScreen(root.position.clone().add(new THREE.Vector3(HOLE, 0, 0).applyQuaternion(camera.quaternion)));
    if (Math.hypot(e.clientX - o[0], e.clientY - o[1]) < Math.hypot(r[0] - o[0], r[1] - o[1])) return null;
    return pick(e, hits);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!isActive() || e.button !== 0) return;
    down = [e.clientX, e.clientY];
    if (!root.visible) return;
    const hit = grab(e);
    if (!hit) return;
    const handle = hit.object.userData.handle;
    if (onDragStart(handle) === false) return;
    e.stopImmediatePropagation(); e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const origin = root.position.clone();
    drag = { handle, start: [e.clientX, e.clientY] };
    if (handle === "yaw") {
      drag.o = toScreen(origin);
      drag.sign = camera.getWorldDirection(new THREE.Vector3()).z < 0 ? 1 : -1;   // seen from above, screen CCW = CCW about +z
    } else {
      const a = toScreen(origin), b = toScreen(origin.clone().add(new THREE.Vector3(...frame[handle])));
      drag.px = [b[0] - a[0], b[1] - a[1]];   // screen pixels per mm along the axis
    }
  }, { capture: true });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) {   // hover: a handle under the pointer reads as grabbable
      const over = isActive() && root.visible && !e.buttons && !!grab(e);
      if (over !== hover) { hover = over; canvas.style.cursor = over ? "grab" : ""; }
      return;
    }
    e.stopImmediatePropagation();
    if (drag.handle === "yaw") {
      const a0 = Math.atan2(-(drag.start[1] - drag.o[1]), drag.start[0] - drag.o[0]), a1 = Math.atan2(-(e.clientY - drag.o[1]), e.clientX - drag.o[0]);
      const da = ((((a1 - a0) * 180) / Math.PI + 540) % 360) - 180;
      onDrag("yaw", drag.sign * da);
    } else {
      const n2 = drag.px[0] ** 2 + drag.px[1] ** 2;
      if (n2 < 1e-4) return;   // the axis points at the camera: turn the view first
      onDrag(drag.handle, ((e.clientX - drag.start[0]) * drag.px[0] + (e.clientY - drag.start[1]) * drag.px[1]) / n2);
    }
  }, { capture: true });
  const end = () => { if (!drag) return; drag = null; onDragEnd(); };
  canvas.addEventListener("pointerup", (e) => {
    if (drag) { end(); return; }
    if (!isActive() || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    onClick(e);
  }, { capture: true });
  canvas.addEventListener("pointercancel", end, { capture: true });

  return {
    pick,
    get dragging() { return !!drag; },
    // put the handles at `origin` (world mm) along `f` ({mesial, buccal, occlusal} unit vectors), or hide them
    show(origin, f) {
      frame = f;
      root.position.set(...origin);
      const up = new THREE.Vector3(0, 1, 0);
      for (const k of AXES) arrows[k].quaternion.setFromUnitVectors(up, new THREE.Vector3(...f[k]).normalize());
      root.visible = true;
    },
    hide() { root.visible = false; drag = null; if (hover) { hover = false; canvas.style.cursor = ""; } },
  };
}
