// Integrates scene, teeth, overlay, layers, views, and stage-bar

import * as THREE from 'three';
import { createScene } from './scene.js';
import { createTeethManager } from './teeth.js';
import { createLayersManager } from './layers.js';
import { createViewsManager, VIEW_NAMES_KO } from './views.js';
import { createOverlayManager } from './overlay.js';
import { createStageBar } from './stage-bar.js';
import { VIEWER_T } from '../domain/vocab/viewer.js';

export function createViewer(container, options = {}) {
  // Ensure container styling
  container.classList.add('viewer-container');

  // State
  let currentMesh = null;
  let currentPlan = null;
  let currentStage = 0;
  let currentPlanNumber = 1;
  let customLabels = [];

  const sceneCtx = createScene(container);

  const teethManager = createTeethManager({
    group: sceneCtx.group,
    ghostGroup: sceneCtx.ghost
  });

  const layersManager = createLayersManager({
    ghostGroup: sceneCtx.ghost,
    teethManager
  });

  const archBadge = document.createElement('div');
  archBadge.className = 'viewer-arch-info';
  archBadge.hidden = true;
  container.appendChild(archBadge);

  function updateArchBadge() {
    if (!currentMesh) {
      archBadge.hidden = true;
      return;
    }
    const archName = currentMesh.arch === 'upper' ? VIEWER_T.arch.upper : (currentMesh.arch === 'lower' ? VIEWER_T.arch.lower : (currentMesh.arch || ''));
    const teethCount = teethManager.getTeethCount();
    archBadge.textContent = currentPlan
      ? VIEWER_T.arch.archInfo(archName, teethCount, currentPlanNumber, currentStage)
      : VIEWER_T.arch.scanInfo(archName, teethCount);
    archBadge.hidden = false;
  }

  const viewsManager = createViewsManager({
    camera: sceneCtx.camera,
    controls: sceneCtx.controls,
    group: sceneCtx.group,
    onViewChange: (viewKey, viewLabel) => {
      viewsBar.querySelectorAll('.viewer-view-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === viewKey);
      });
      updateArchBadge();
    }
  });

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

  const viewsBar = document.createElement('div');
  viewsBar.className = 'viewer-views-bar';
  const supportedViews = ['occlusal', 'frontal', 'right', 'left'];

  for (const key of supportedViews) {
    const label = VIEW_NAMES_KO[key] || key;
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
  container.appendChild(viewsBar);

  const layersBar = document.createElement('div');
  layersBar.className = 'viewer-layers-bar';

  const layerButtons = {};
  const layerDefs = [
    { key: 'ghost', label: VIEWER_T.layers.ghost },
    { key: 'heat', label: VIEWER_T.layers.heat },
    { key: 'ipr', label: VIEWER_T.layers.ipr },
    { key: 'numbers', label: VIEWER_T.layers.numbers },
    { key: 'gum', label: VIEWER_T.layers.gum }
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

  const stageBarTarget = options.stageBarContainer || container;
  const stageBarEnabled = options.stageBar === true
    || (options.stageBar !== false && typeof options.onStageChange === 'function');
  const stageBar = stageBarEnabled ? createStageBar(stageBarTarget, {
    max: 0,
    value: 0,
    violations: [],
    onChange: (stage) => {
      setStage(stage, false);
      options.onStageChange?.(stage);
    }
  }) : null;

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
    currentPlanNumber = 1;

    teethManager.loadMesh(meshJson);
    stageBar?.setMax(0);
    stageBar?.setMonths(null);
    stageBar?.setStage(0);
    stageBar?.setViolations([]);

    applyStage(0);
    viewsManager.setView('occlusal');
    updateArchBadge();
  }

  function setPlan(planJson, planNumber = null) {
    currentPlan = planJson;
    currentPlanNumber = Number(planNumber ?? planJson?.planNumber ?? planJson?.plan_number ?? planJson?.ordinal) || 1;
    const totalStages = planJson?.stages?.length || 0;
    const months = planJson?.info?.months ?? null;

    stageBar?.setMax(totalStages);
    stageBar?.setMonths(months);
    stageBar?.setViolations(planJson?.violations || []);

    applyStage(Math.min(currentStage, totalStages));
    updateArchBadge();
  }

  function setStage(n, updateBar = true) {
    const totalStages = currentPlan?.stages?.length || 0;
    currentStage = Math.max(0, Math.min(totalStages, Number(n) || 0));

    applyStage(currentStage);
    updateArchBadge();

    if (updateBar) {
      stageBar?.setStage(currentStage);
    }
  }

  function applyStage(k) {
    teethManager.applyPose(currentPlan, k);
    layersManager.applyAppearance(currentPlan, k, overlayManager.getSelectedTeeth());
    overlayManager.syncLabels(currentPlan, k, layersManager.getLayers(), customLabels);
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
    overlayManager.syncLabels(currentPlan, currentStage, layersManager.getLayers(), customLabels);
  }

  function setView(name) {
    viewsManager.setView(name);
  }

  function setLabels(list) {
    customLabels = list || [];
    overlayManager.syncLabels(currentPlan, currentStage, layersManager.getLayers(), customLabels);
  }

  function destroy() {
    sceneCtx.canvas.removeEventListener('pointermove', onPointerMove);
    sceneCtx.canvas.removeEventListener('pointerdown', onPointerDown);
    sceneCtx.canvas.removeEventListener('pointerup', onPointerUp);
    sceneCtx.canvas.removeEventListener('pointerleave', onPointerLeave);

    archBadge.remove();
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
