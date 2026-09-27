// Camera viewpoints: occlusal, frontal, right, left

import * as THREE from 'three';
import { calculateViewCamera } from './math.js';
import { VIEWER_T } from '../domain/vocab/viewer.js';

export const VIEW_NAMES_KO = VIEWER_T.views;

/**
 * Creates the viewpoint manager.
 *
 * @param {object} param0
 * @param {THREE.PerspectiveCamera} param0.camera
 * @param {object} param0.controls
 * @param {THREE.Group} param0.group
 * @param {(kind: string, label: string) => void} [param0.onViewChange]
 * @returns {object}
 */
export function createViewsManager({ camera, controls, group, onViewChange = null }) {
  let currentView = 'occlusal';

  function setView(kind = 'occlusal') {
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return;

    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const { position, up, target } = calculateViewCamera({
      kind,
      center: [c.x, c.y, c.z],
      size: [size.x, size.y, size.z],
      fov: camera.fov
    });

    camera.up.set(up[0], up[1], up[2]);
    camera.position.set(position[0], position[1], position[2]);
    controls.target.set(target[0], target[1], target[2]);
    controls.update();

    currentView = kind;
    onViewChange?.(kind, VIEW_NAMES_KO[kind] || kind);
  }

  function getCurrentView() {
    return currentView;
  }

  return {
    setView,
    getCurrentView,
    VIEW_NAMES_KO
  };
}
