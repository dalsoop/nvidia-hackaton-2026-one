// 2D HTML/CSS overlay on top of 3D canvas (Violations, Callouts, FDI chips)
// Screen coordinates are set via CSS custom properties: --x and --y

import * as THREE from 'three';
import { universalToFdi } from '../domain/teeth.js';
import { calculateIprContacts, getViolationsAtStage, projectNormalizedToScreen } from './math.js';

/**
 * Projects a 3D Vector3 onto 2D screen coordinates.
 *
 * @param {THREE.Vector3} worldPos
 * @param {THREE.Camera} camera
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number, visible: boolean }}
 */
export function projectToScreen(worldPos, camera, width, height) {
  const v = worldPos.clone().project(camera);
  const visible = v.z < 1.0;
  const { x, y } = projectNormalizedToScreen(v.x, v.y, width, height);
  return { x, y, visible };
}

/**
 * Creates the overlay manager.
 *
 * @param {object} param0
 * @param {HTMLElement} param0.container
 * @param {THREE.Camera} param0.camera
 * @param {object} param0.teethManager
 * @param {object} [param0.options]
 * @returns {object}
 */
export function createOverlayManager({ container, camera, teethManager, options = {} }) {
  let overlayRoot = container.querySelector('.viewer-overlay-root');
  if (!overlayRoot) {
    overlayRoot = document.createElement('div');
    overlayRoot.className = 'viewer-overlay-root';
    container.appendChild(overlayRoot);
  }

  // Sub-containers
  const labelsLayer = document.createElement('div');
  labelsLayer.className = 'viewer-overlay-layer viewer-labels-layer';
  overlayRoot.appendChild(labelsLayer);

  const chipsBar = document.createElement('div');
  chipsBar.className = 'viewer-overlay-chips-bar';
  chipsBar.hidden = true;
  overlayRoot.appendChild(chipsBar);

  const tooltip = document.createElement('div');
  tooltip.className = 'viewer-tooltip';
  tooltip.hidden = true;
  overlayRoot.appendChild(tooltip);

  // Tracked 3D objects with labels
  let dynamicLabels = []; // Array<{ el: HTMLElement, getPosition: () => THREE.Vector3, isVisible?: () => boolean }>
  const selectedTeeth = new Set();
  let currentPlan = null;
  let currentStage = 0;
  let showNumbers = false;
  let showIpr = true;

  function clearLabels() {
    labelsLayer.innerHTML = '';
    dynamicLabels = [];
  }

  /**
   * Rebuilds violation and IPR labels for the current plan and stage.
   *
   * @param {object|null} plan
   * @param {number} stage
   * @param {object} layersState
   */
  function syncLabels(plan, stage = 0, layersState = {}) {
    clearLabels();
    currentPlan = plan;
    currentStage = stage;
    showNumbers = !!layersState.numbers;
    showIpr = layersState.ipr !== false;

    const teeth = teethManager.getTeeth();
    const centers = teethManager.getCenters();

    // 1. Collision and violation labels
    if (plan && plan.violations) {
      for (const v of plan.violations) {
        if (v.stage !== stage) continue;
        if (v.type === 'collision' && Array.isArray(v.teeth) && v.teeth.length >= 2) {
          const aId = String(v.teeth[0]);
          const bId = String(v.teeth[1]);
          const mA = teeth[aId];
          const mB = teeth[bId];
          const cA = centers[aId];
          const cB = centers[bId];

          if (mA && mB && cA && cB) {
            const el = document.createElement('div');
            el.className = 'viewer-violation-callout';
            const fdiA = universalToFdi(aId) ?? aId;
            const fdiB = universalToFdi(bId) ?? bId;
            const vol = v.overlap_mm3 != null ? `${v.overlap_mm3} mm³` : '충돌';
            el.innerHTML = `<span class="badge-danger">충돌</span> <span class="teeth-pair">${fdiA}-${fdiB}</span> <span class="vol">${vol}</span>`;
            labelsLayer.appendChild(el);

            dynamicLabels.push({
              el,
              getPosition: () => {
                const posA = cA.clone().add(mA.position);
                const posB = cB.clone().add(mB.position);
                const mid = posA.add(posB).multiplyScalar(0.5);
                mid.z += 2.5;
                return mid;
              }
            });
          }
        }
      }
    }

    // 2. IPR labels along contact points
    if (showIpr && plan?.target?.ipr_mm_per_surface) {
      const archOrder = teethManager.getArchOrder();
      const iprContacts = calculateIprContacts(archOrder, plan.target);

      for (const contact of iprContacts) {
        const mA = teeth[contact.a];
        const mB = teeth[contact.b];
        const cA = centers[contact.a];
        const cB = centers[contact.b];

        if (mA && mB && cA && cB) {
          const el = document.createElement('div');
          el.className = 'viewer-ipr-callout';
          el.textContent = `${contact.mm.toFixed(2)}`;
          el.title = `IPR ${contact.mm.toFixed(2)}mm (${universalToFdi(contact.a)}-${universalToFdi(contact.b)})`;
          labelsLayer.appendChild(el);

          dynamicLabels.push({
            el,
            getPosition: () => {
              const posA = cA.clone().add(mA.position);
              const posB = cB.clone().add(mB.position);
              const mid = posA.add(posB).multiplyScalar(0.5);
              mid.z += 2.0;
              return mid;
            }
          });
        }
      }
    }

    // 3. Tooth Numbering (FDI) when numbers layer is enabled
    if (showNumbers) {
      for (const [id, m] of Object.entries(teeth)) {
        if (!m.visible) continue;
        const c = centers[id];
        if (!c) continue;

        const fdi = universalToFdi(id);
        if (!fdi) continue;

        const el = document.createElement('div');
        el.className = 'viewer-tooth-badge';
        el.textContent = String(fdi);
        labelsLayer.appendChild(el);

        dynamicLabels.push({
          el,
          getPosition: () => {
            const pos = c.clone().add(m.position);
            pos.z += 3.0;
            return pos;
          },
          isVisible: () => m.visible
        });
      }
    }

    updateLabelCoordinates();
  }

  /**
   * Updates CSS variables --x and --y for all dynamic overlay elements.
   */
  function updateLabelCoordinates() {
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 200;

    for (const item of dynamicLabels) {
      if (item.isVisible && !item.isVisible()) {
        item.el.style.display = 'none';
        continue;
      }

      const worldPos = item.getPosition();
      const { x, y, visible } = projectToScreen(worldPos, camera, width, height);

      if (!visible || x < -50 || x > width + 50 || y < -50 || y > height + 50) {
        item.el.style.display = 'none';
      } else {
        item.el.style.display = '';
        item.el.style.setProperty('--x', `${x.toFixed(1)}px`);
        item.el.style.setProperty('--y', `${y.toFixed(1)}px`);
      }
    }
  }

  /**
   * Render FDI selection chips at the top/bottom of the viewer.
   */
  function renderChips() {
    chipsBar.innerHTML = '';
    if (selectedTeeth.size === 0) {
      chipsBar.hidden = true;
      return;
    }
    chipsBar.hidden = false;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'viewer-chips-title';
    titleSpan.textContent = '선택한 치아:';
    chipsBar.appendChild(titleSpan);

    const sorted = [...selectedTeeth].sort((a, b) => Number(a) - Number(b));
    for (const id of sorted) {
      const fdi = universalToFdi(id) ?? id;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'viewer-fdi-chip';
      chip.dataset.id = id;
      chip.innerHTML = `<span>#${fdi}</span> <span class="chip-remove">✕</span>`;
      chip.title = `치아 ${fdi}번 선택 해제`;
      chip.addEventListener('click', () => {
        selectedTeeth.delete(id);
        renderChips();
        options.onSelectionChange?.(new Set(selectedTeeth));
      });
      chipsBar.appendChild(chip);
    }

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'viewer-chips-clear';
    clearBtn.textContent = '모두 해제';
    clearBtn.addEventListener('click', () => {
      selectedTeeth.clear();
      renderChips();
      options.onSelectionChange?.(new Set(selectedTeeth));
    });
    chipsBar.appendChild(clearBtn);
  }

  /**
   * Hover tooltip update
   *
   * @param {string|null} toothId
   * @param {number} clientX
   * @param {number} clientY
   */
  function updateTooltip(toothId, clientX, clientY) {
    if (!toothId) {
      tooltip.hidden = true;
      return;
    }

    const toothMesh = teethManager.getTooth(toothId);
    if (!toothMesh) {
      tooltip.hidden = true;
      return;
    }

    const fdi = universalToFdi(toothId) ?? toothId;
    const moved = toothMesh.userData?.moved ?? 0;
    const locked = new Set((currentPlan?.target?.locked ?? []).map(String)).has(toothId);
    const removed = new Set((currentPlan?.target?.removed ?? []).map(String)).has(toothId);

    const { byTooth } = getViolationsAtStage(currentPlan?.violations, currentStage);
    const toothViols = byTooth[toothId] ? [...byTooth[toothId]] : [];

    const lines = [];
    lines.push(`<strong>치아 #${fdi}</strong>`);
    if (currentPlan) {
      lines.push(`누적 이동: ${moved.toFixed(2)} mm`);
    }
    if (locked) lines.push(`<span class="badge-blue">고정</span>`);
    if (removed) lines.push(`<span class="badge-amber">발치</span>`);
    if (toothViols.length > 0) {
      lines.push(`<span class="badge-danger">위반: ${toothViols.join(', ')}</span>`);
    }

    tooltip.innerHTML = lines.join(' · ');

    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left + 12;
    const y = clientY - rect.top + 12;

    tooltip.style.setProperty('--x', `${x}px`);
    tooltip.style.setProperty('--y', `${y}px`);
    tooltip.hidden = false;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function toggleToothSelection(id) {
    if (!id) return;
    if (selectedTeeth.has(id)) {
      selectedTeeth.delete(id);
    } else {
      selectedTeeth.add(id);
    }
    renderChips();
    options.onSelectionChange?.(new Set(selectedTeeth));
  }

  function getSelectedTeeth() {
    return new Set(selectedTeeth);
  }

  function clearSelection() {
    selectedTeeth.clear();
    renderChips();
    options.onSelectionChange?.(new Set(selectedTeeth));
  }

  function destroy() {
    clearLabels();
    overlayRoot.remove();
  }

  return {
    syncLabels,
    updateLabelCoordinates,
    updateTooltip,
    hideTooltip,
    toggleToothSelection,
    getSelectedTeeth,
    clearSelection,
    renderChips,
    destroy
  };
}
