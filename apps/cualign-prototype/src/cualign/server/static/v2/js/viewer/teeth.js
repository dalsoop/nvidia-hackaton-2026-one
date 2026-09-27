// Tooth meshes and pose management for 3D viewer
import * as THREE from 'three';
import { calculateToothPosition } from './math.js';

export const IVORY = 0xe9e3d6;
export const GUM_COLOR = 0xd98b8f;
export const GHOST_MAT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  wireframe: true,
  transparent: true,
  opacity: 0.12,
  depthWrite: false
});

/**
 * Creates the Teeth and Gum mesh manager.
 *
 * @param {object} param0
 * @param {THREE.Group} param0.group
 * @param {THREE.Group} param0.ghostGroup
 * @returns {object}
 */
export function createTeethManager({ group, ghostGroup }) {
  let teeth = {}; // tooth_id -> THREE.Mesh
  let ghostMeshes = {}; // tooth_id -> THREE.Mesh
  let centers = {}; // tooth_id -> THREE.Vector3
  let gum = null;
  let archOrder = [];
  let currentMesh = null;

  function clear() {
    for (const m of Object.values(teeth)) {
      m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
      else m.material.dispose();
      group.remove(m);
    }
    for (const g of Object.values(ghostMeshes)) {
      g.geometry.dispose();
      ghostGroup.remove(g);
    }
    if (gum) {
      gum.geometry.dispose();
      gum.material.dispose();
      group.remove(gum);
      gum = null;
    }
    teeth = {};
    ghostMeshes = {};
    centers = {};
    archOrder = [];
    currentMesh = null;
    group.clear();
    ghostGroup.clear();
  }

  function loadMesh(mesh) {
    clear();
    currentMesh = mesh;

    if (!mesh || !mesh.teeth) return;

    for (const [id, t] of Object.entries(mesh.teeth)) {
      const geo = new THREE.BufferGeometry();
      const vertices = Array.isArray(t.v) ? (Array.isArray(t.v[0]) ? t.v.flat() : t.v) : [];
      const faces = Array.isArray(t.f) ? (Array.isArray(t.f[0]) ? t.f.flat() : t.f) : [];

      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setIndex(faces);
      geo.computeVertexNormals();
      geo.computeBoundingBox();

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(IVORY),
        roughness: 0.45,
        metalness: 0.02,
        transparent: true,
        opacity: 1
      });

      const m = new THREE.Mesh(geo, mat);
      m.userData = { id, moved: 0, violations: [] };
      group.add(m);
      teeth[id] = m;

      // Initial untreated ghost mesh
      const ghostMesh = new THREE.Mesh(geo, GHOST_MAT);
      ghostMesh.userData = { id };
      ghostGroup.add(ghostMesh);
      ghostMeshes[id] = ghostMesh;

      centers[id] = geo.boundingBox.getCenter(new THREE.Vector3());
    }

    if (mesh.gum) {
      const gumGeo = new THREE.BufferGeometry();
      const gumV = Array.isArray(mesh.gum.v) ? (Array.isArray(mesh.gum.v[0]) ? mesh.gum.v.flat() : mesh.gum.v) : [];
      const gumF = Array.isArray(mesh.gum.f) ? (Array.isArray(mesh.gum.f[0]) ? mesh.gum.f.flat() : mesh.gum.f) : [];

      gumGeo.setAttribute('position', new THREE.Float32BufferAttribute(gumV, 3));
      gumGeo.setIndex(gumF);
      gumGeo.computeVertexNormals();

      const gumMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(GUM_COLOR),
        roughness: 0.6,
        metalness: 0.0,
        transparent: true,
        opacity: 1
      });

      gum = new THREE.Mesh(gumGeo, gumMat);
      gum.userData = { gum: true };
      group.add(gum);
    }

    archOrder = (mesh.arch_order ?? mesh.ids ?? Object.keys(mesh.teeth)).map(String);
  }

  /**
   * Applies the stage transform to all teeth.
   *
   * @param {object|null} plan
   * @param {number} stage
   */
  function applyPose(plan, stage = 0) {
    const hasPlan = !!plan;
    const st = stage > 0 ? (plan?.stages?.[stage - 1] ?? {}) : {};
    const rot = stage > 0 ? (plan?.rotations?.[stage - 1] ?? {}) : {};
    const pivots = plan?.pivots ?? {};
    const removed = new Set((plan?.target?.removed ?? []).map(String));

    if (gum) {
      gum.material.opacity = stage > 0 ? 0.35 : 1;
      gum.material.depthWrite = stage === 0;
    }

    for (const [id, m] of Object.entries(teeth)) {
      const d = st[id] || [0, 0, 0];
      const rotDeg = rot[id] || 0;
      const pivot = pivots[id] || [0, 0, 0];

      const transform = calculateToothPosition(d, pivot, rotDeg);
      m.rotation.set(0, 0, transform.rotation[2]);
      m.position.set(transform.position[0], transform.position[1], transform.position[2]);

      const gone = hasPlan && removed.has(id);
      m.visible = !gone || stage === 0;
      m.material.opacity = gone ? 0.25 : 1;

      const moved = Math.hypot(d[0] || 0, d[1] || 0, d[2] || 0);
      m.userData.moved = moved;
    }
  }

  return {
    loadMesh,
    applyPose,
    clear,
    getTeeth: () => teeth,
    getTooth: (id) => teeth[String(id)],
    getGhostMeshes: () => ghostMeshes,
    getCenters: () => centers,
    getCenter: (id) => centers[String(id)],
    getGum: () => gum,
    getArchOrder: () => archOrder,
    getMesh: () => currentMesh,
    getArch: () => currentMesh?.arch ?? 'upper',
    getTeethCount: () => Object.keys(teeth).length,
    destroy: clear
  };
}
