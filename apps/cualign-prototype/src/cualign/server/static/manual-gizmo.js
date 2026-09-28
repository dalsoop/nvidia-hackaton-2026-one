// 직접 이동의 3D 손잡이: 선택한 치관 위에 치아 자신의 축(근원심·협설·수직)을 따른 양방향 화살표 셋과 장축 회전 고리.
// 치관 위에 그리고(깊이 검사 없음), 잡기 쉽게 보이지 않는 굵은 판정 도형을 따로 둔다. 손잡이를 누르면 그 드래그는
// 궤도 회전이 보지 못하게 가로채고(capture 단계에서 stopImmediatePropagation), 끌지 않고 뗀 클릭은 onClick 으로 넘긴다.

import { AXES } from "./manual-math.js";

const COLORS = { mesial: 0xff5da2, buccal: 0x2ec4b6, occlusal: 0x9b7bff, yaw: 0xffd166 };
const L = 5, R = 6;   // arrow half-length and ring radius, mm

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
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2 * L + 3, 6), hitMat);
    hit.userData.handle = k; hits.push(hit);
    g.add(shaft, hit);
    for (const o of g.children) o.renderOrder = 999;
    root.add(g); arrows[k] = g;
  }
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 72), mat(COLORS.yaw));
    const hit = new THREE.Mesh(new THREE.TorusGeometry(R, 0.8, 6, 48), hitMat);
    hit.userData.handle = "yaw"; hits.push(hit);
    ring.renderOrder = hit.renderOrder = 999;
    root.add(ring, hit);
  }
  let frame = null, drag = null, down = null;

  // ---- screen helpers
  const ray = new THREE.Raycaster();
  const ndc = (e) => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  const toScreen = (v) => { const p = v.clone().project(camera), r = canvas.getBoundingClientRect(); return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top]; };
  // the first of `objects` under the pointer
  function pick(e, objects) { ray.setFromCamera(ndc(e), camera); return ray.intersectObjects(objects, false)[0] ?? null; }

  canvas.addEventListener("pointerdown", (e) => {
    if (!isActive() || e.button !== 0) return;
    down = [e.clientX, e.clientY];
    if (!root.visible) return;
    const hit = pick(e, hits);
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
    if (!drag) return;
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
    hide() { root.visible = false; drag = null; },
  };
}
