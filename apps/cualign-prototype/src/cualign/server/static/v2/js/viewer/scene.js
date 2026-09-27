// 3D Scene setup: renderer, camera, lighting, resize handling, controls

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Creates and initializes the Three.js 3D scene.
 *
 * @param {HTMLElement} container
 * @param {object} [options]
 * @returns {object} Scene controller
 */
export function createScene(container, options = {}) {
  let canvas = container.querySelector('canvas.viewer-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'viewer-canvas';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.outline = 'none';
    container.style.position = 'relative';
    container.appendChild(canvas);
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
  camera.up.set(0, 1, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.9);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(30, 40, 120);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-50, -30, 60);
  scene.add(fillLight);

  // Groups
  const group = new THREE.Group();
  scene.add(group);

  const ghost = new THREE.Group();
  scene.add(ghost);

  const raycaster = new THREE.Raycaster();

  let animationFrameId = null;
  const beforeRenderCallbacks = new Set();
  let isDestroyed = false;

  function resize() {
    if (isDestroyed || !container) return;
    const w = container.clientWidth || 300;
    const h = container.clientHeight || 200;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(() => {
    resize();
  });
  resizeObserver.observe(container);
  resize();

  function loop() {
    if (isDestroyed) return;
    controls.update();

    for (const cb of beforeRenderCallbacks) {
      cb({ scene, camera, renderer, controls });
    }

    renderer.render(scene, camera);
    animationFrameId = requestAnimationFrame(loop);
  }

  animationFrameId = requestAnimationFrame(loop);

  function destroy() {
    isDestroyed = true;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    resizeObserver.disconnect();
    beforeRenderCallbacks.clear();
    controls.dispose();
    renderer.dispose();
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    group,
    ghost,
    raycaster,
    canvas,
    resize,
    onBeforeRender(cb) {
      beforeRenderCallbacks.add(cb);
      return () => beforeRenderCallbacks.delete(cb);
    },
    destroy
  };
}
