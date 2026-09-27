import { VIEWER_T } from '../domain/vocab/viewer.js';
import { createStageBar } from './stage-bar.js';

function stageCount(plan) {
  return Array.isArray(plan?.stages)
    ? plan.stages.length
    : (Number(plan?.stages) || plan?.info?.n_stages || 0);
}

export function createViewerFallback(container, options = {}) {
  container.querySelectorAll('canvas.viewer-canvas').forEach((canvas) => canvas.remove());
  container.classList.add('viewer-container', 'viewer-container-unavailable');

  const notice = document.createElement('div');
  notice.className = 'viewer-unavailable';
  notice.setAttribute('role', 'status');

  const title = document.createElement('strong');
  title.textContent = VIEWER_T.unavailable.title;
  const detail = document.createElement('span');
  detail.textContent = VIEWER_T.unavailable.detail;
  notice.append(title, detail);
  container.appendChild(notice);

  let currentMesh = null;
  let currentPlan = null;
  let currentStage = 0;
  let layers = {};
  const stageBarEnabled = options.stageBar === true
    || (options.stageBar !== false && typeof options.onStageChange === 'function');
  const stageBar = stageBarEnabled ? createStageBar(options.stageBarContainer || container, {
    max: 0,
    value: 0,
    violations: [],
    onChange: (stage) => {
      setStage(stage, false);
      options.onStageChange?.(stage);
    }
  }) : null;

  function syncPlan() {
    const total = stageCount(currentPlan);
    currentStage = Math.max(0, Math.min(total, currentStage));
    stageBar?.setMax(total);
    stageBar?.setViolations(currentPlan?.violations || []);
    stageBar?.setStage(currentStage);
  }

  function setStage(value, updateBar = true) {
    currentStage = Math.max(0, Math.min(stageCount(currentPlan), Number(value) || 0));
    if (updateBar) stageBar?.setStage(currentStage);
  }

  return {
    loadCase(mesh) { currentMesh = mesh; },
    setPlan(plan) { currentPlan = plan; syncPlan(); },
    setStage,
    setLayers(next) { layers = { ...layers, ...next }; },
    setView() {},
    setLabels() {},
    destroy() {
      stageBar?.destroy();
      notice.remove();
      container.classList.remove('viewer-container', 'viewer-container-unavailable');
    },
    getStage: () => currentStage,
    getPlan: () => currentPlan,
    getMesh: () => currentMesh,
    getLayers: () => ({ ...layers }),
    getSelectedTeeth: () => [],
    clearSelection() {},
    getStageBar: () => stageBar
  };
}
