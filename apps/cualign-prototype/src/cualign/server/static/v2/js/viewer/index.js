// 3D Viewer module entry (J5 contract)
// Integrates scene, teeth, overlay, layers, views, and stage-bar

import * as THREE from 'three';
import { createScene } from './scene.js';
import { createTeethManager } from './teeth.js';
import { createLayersManager } from './layers.js';
import { createViewsManager, VIEW_NAMES_KO } from './views.js';
import { createOverlayManager } from './overlay.js';
import { createStageBar } from './stage-bar.js';

/**
 * Creates and initializes the 3D dental aligner viewer.
 *
 * @param {HTMLElement} container
 * @param {object} [options]
 * @returns {object}
 */
export function createViewer(container, options = {}) {
  // Ensure container styling
  container.classList.add('viewer-container');

  // 1. Initialize Scene (Renderer, Camera, Lights, OrbitControls)
  const sceneCtx = createScene(container);

  // 2. Initialize Teeth Manager (Meshes, Poses, Centers)
  const teethManager = createTeethManager({
    group: sceneCtx.group,
    ghostGroup: sceneCtx.ghost
  });

  // 3. Initialize Layers Manager (Ghost overlay, Heat tint, IPR, Numbers, Gum)
  const layersManager = createLayersManager({
    ghostGroup: sceneCtx.ghost,
    teethManager
  });

  // 4. Initialize Views Manager (Occlusal, Frontal, Right, Left)
  const viewsManager = createViewsManager({
    camera: sceneCtx.camera,
    controls: sceneCtx.controls,
    group: sceneCtx.group
  });

  // 5. Initialize Overlay Manager (Labels, Violations, Tooltips, FDI chips)
  const overlayManager = createOverlayManager({
    container,
    camera: sceneCtx.camera,
    teethManager,
    options: {
      onSelectionChange: (selected) => {
        layersManager.applyAppearance(currentPlan, currentStage, selected);
        options.onSelectionChange?.(selected);
      }
    }
  });

  // 6. View Controls UI (교합면, 정면, 우측, 좌측)
  const viewsBar = document.createElement('div');
  viewsBar.className = 'viewer-views-bar';
  for (const [key, label] of Object.entries(VIEW_NAMES_KO)) {
    if (['occlusal', 'frontal', 'right', 'left'].includes(key)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `viewer-view-btn ${key === 'occlusal' ? 'active' : ''}`;
      btn.dataset.view = key;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        viewsBar.querySelectorAll('.viewer-view-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        viewsManager.setView(key);
      });
      viewsBar.appendChild(btn);
    }
  }
  container.appendChild(viewsBar);

  // 7. Layer Controls UI (치료 전 겹쳐 보기, 이동량 색, IPR, 치아 번호, 잇몸)
  const layersBar = document.createElement('div');
  layersBar.className = 'viewer-layers-bar';

  const layerButtons = {};
  const layerDefs = [
    { key: 'ghost', label: '치료 전 겹쳐 보기' },
    { key: 'heat', label: '이동량 색' },
    { key: 'ipr', label: 'IPR' },
    { key: 'numbers', label: '치아 번호' },
    { key: 'gum', label: '잇몸' }
  ];

  for (const def of layerDefs) {
    const isInitiallyActive = !!layersManager.getLayers()[def.key];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `viewer-layer-toggle-btn ${isInitiallyActive ? 'active' : ''}`;
    btn.setAttribute('aria-pressed', String(isInitiallyActive));
    btn.textContent = def.label;
    btn.dataset.layer = def.key;
    btn.addEventListener('click', () => {
      const current = !!layersManager.getLayers()[def.key];
      const next = !current;
      setLayers({ [def.key]: next });
    });
    layersBar.appendChild(btn);
    layerButtons[def.key] = btn;
  }
  container.appendChild(layersBar);

  // State
  let currentMesh = null;
  let currentPlan = null;
  let currentStage = 0;
  let customLabels = [];

  // 8. Initialize 440px Stage Bar (Bottom-Right)
  const stageBarTarget = options.stageBarContainer || container;
  const stageBar = options.stageBar === false ? null : createStageBar(stageBarTarget, {
    max: 0,
    value: 0,
    violations: [],
    onChange: (stage) => {
      setStage(stage, false);
      options.onStageChange?.(stage);
    }
  });

  // Coordinate update on every frame
  sceneCtx.onBeforeRender(() => {
    overlayManager.updateLabelCoordinates();
  });

  // Pointer interactions (Hover tooltip & Click selection)
  let downPos = null;
  function getToothUnderPointer(e) {
    const rect = sceneCtx.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    sceneCtx.raycaster.setFromCamera(p, sceneCtx.camera);
    const meshes = Object.values(teethManager.getTeeth()).filter((m) => m.visible);
    const hit = sceneCtx.raycaster.intersectObjects(meshes)[0];
    return hit?.object?.userData?.id ?? null;
  }

  function onPointerMove(e) {
    const toothId = getToothUnderPointer(e);
    if (toothId) {
      overlayManager.updateTooltip(toothId, e.clientX, e.clientY);
    } else {
      overlayManager.hideTooltip();
    }
  }

  function onPointerDown(e) {
    downPos = [e.clientX, e.clientY];
  }

  function onPointerUp(e) {
    if (!downPos) return;
    const dist = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
    downPos = null;
    if (dist > 5) return; // Orbit drag

    const toothId = getToothUnderPointer(e);
    if (toothId) {
      overlayManager.toggleToothSelection(toothId);
    }
  }

  function onPointerLeave() {
    overlayManager.hideTooltip();
  }

  sceneCtx.canvas.addEventListener('pointermove', onPointerMove);
  sceneCtx.canvas.addEventListener('pointerdown', onPointerDown);
  sceneCtx.canvas.addEventListener('pointerup', onPointerUp);
  sceneCtx.canvas.addEventListener('pointerleave', onPointerLeave);

  // Contract Methods

  function loadCase(meshJson) {
    currentMesh = meshJson;
    currentPlan = null;
    currentStage = 0;

    teethManager.loadMesh(meshJson);
    stageBar?.setMax(0);
    stageBar?.setStage(0);
    stageBar?.setViolations([]);

    applyStage(0);
    viewsManager.setView('occlusal');
  }

  function setPlan(planJson) {
    currentPlan = planJson;
    const totalStages = planJson?.stages?.length || 0;

    stageBar?.setMax(totalStages);
    stageBar?.setViolations(planJson?.violations || []);

    applyStage(Math.min(currentStage, totalStages));
  }

  function setStage(n, updateBar = true) {
    const totalStages = currentPlan?.stages?.length || 0;
    currentStage = Math.max(0, Math.min(totalStages, Number(n) || 0));

    applyStage(currentStage);

    if (updateBar) {
      stageBar?.setStage(currentStage);
    }
  }

  function applyStage(k) {
    teethManager.applyPose(currentPlan, k);
    layersManager.applyAppearance(currentPlan, k, overlayManager.getSelectedTeeth());
    overlayManager.syncLabels(currentPlan, k, layersManager.getLayers());
  }

  function setLayers(obj) {
    layersManager.setLayers(obj);
    if (obj && typeof obj === 'object') {
      for (const [key, val] of Object.entries(obj)) {
        if (layerButtons[key]) {
          layerButtons[key].setAttribute('aria-pressed', String(!!val));
          layerButtons[key].classList.toggle('active', !!val);
        }
      }
    }
    layersManager.applyAppearance(currentPlan, currentStage, overlayManager.getSelectedTeeth());
    overlayManager.syncLabels(currentPlan, currentStage, layersManager.getLayers());
  }

  function setView(name) {
    viewsManager.setView(name);
    viewsBar.querySelectorAll('.viewer-view-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === name);
    });
  }

  function setLabels(list) {
    customLabels = list || [];
    overlayManager.syncLabels(currentPlan, currentStage, layersManager.getLayers());
  }

  function destroy() {
    sceneCtx.canvas.removeEventListener('pointermove', onPointerMove);
    sceneCtx.canvas.removeEventListener('pointerdown', onPointerDown);
    sceneCtx.canvas.removeEventListener('pointerup', onPointerUp);
    sceneCtx.canvas.removeEventListener('pointerleave', onPointerLeave);

    viewsBar.remove();
    layersBar.remove();
    stageBar?.destroy();
    overlayManager.destroy();
    teethManager.destroy();
    sceneCtx.destroy();
    container.classList.remove('viewer-container');
  }

  return {
    loadCase,
    setPlan,
    setStage,
    setLayers,
    setView,
    setLabels,
    destroy,
    // Additional helpers
    getStage: () => currentStage,
    getPlan: () => currentPlan,
    getMesh: () => currentMesh,
    getLayers: () => layersManager.getLayers(),
    getSelectedTeeth: () => overlayManager.getSelectedTeeth(),
    clearSelection: () => overlayManager.clearSelection(),
    getStageBar: () => stageBar
  };
}
