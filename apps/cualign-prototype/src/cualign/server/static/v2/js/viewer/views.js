// Camera viewpoints: occlusal (교합면), frontal (정면), right (우측), left (좌측)

import * as THREE from 'three';
import { calculateViewCamera } from './math.js';

export const VIEW_NAMES_KO = {
  occlusal: '교합면',
  frontal: '정면',
  right: '우측',
  left: '좌측',
  back: '설측',
  base: '바닥'
};

/**
 * Creates the viewpoint manager.
 *
 * @param {object} param0
 * @param {THREE.PerspectiveCamera} param0.camera
 * @param {object} param0.controls
 * @param {THREE.Group} param0.group
 * @returns {object}
 */
export function createViewsManager({ camera, controls, group }) {
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
