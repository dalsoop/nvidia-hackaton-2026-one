import * as THREE from 'three';
import { universalToFdi } from '../domain/teeth.js';
import { calculateIprContacts, getViolationsAtStage } from './math.js';
import { VIEWER_T } from '../domain/vocab/viewer.js';
import { appendDiv, projectToScreen, replaceTooltipContent, textSpan } from './overlay-dom.js';

export { projectToScreen } from './overlay-dom.js';

export function createOverlayManager({ container, camera, teethManager, options = {} }) {
  const T = VIEWER_T.overlay;

  let overlayRoot = container.querySelector('.viewer-overlay-root');
  if (!overlayRoot) {
    overlayRoot = document.createElement('div');
    overlayRoot.className = 'viewer-overlay-root';
    container.appendChild(overlayRoot);
  }

  const labelsLayer = appendDiv(overlayRoot, 'viewer-overlay-layer viewer-labels-layer');
  const chipsBar = appendDiv(overlayRoot, 'viewer-overlay-chips-bar', true);
  const tooltip = appendDiv(overlayRoot, 'viewer-tooltip', true);

  let dynamicLabels = []; // Array<{ el: HTMLElement, getPosition: () => THREE.Vector3, isVisible?: () => boolean }>
  const selectedTeeth = new Set();
  let currentPlan = null;
  let currentStage = 0;
  let showNumbers = false;
  let showIpr = true;

  function clearLabels() {
    labelsLayer.replaceChildren();
    dynamicLabels = [];
  }

  function syncLabels(plan, stage = 0, layersState = {}, customLabels = []) {
    clearLabels();
    currentPlan = plan;
    currentStage = stage;
    showNumbers = !!layersState.numbers;
    showIpr = layersState.ipr !== false;

    const teeth = teethManager.getTeeth();
    const centers = teethManager.getCenters();

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
            const vol = v.overlap_mm3 != null ? `${v.overlap_mm3} mm³` : T.collision;
            el.append(
              textSpan('badge-danger', T.collision),
              textSpan('teeth-pair', `#${fdiA}-#${fdiB}`),
              textSpan('vol', vol)
            );
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
          const fdiA = universalToFdi(contact.a) ?? contact.a;
          const fdiB = universalToFdi(contact.b) ?? contact.b;
          el.title = T.iprTitle(contact.mm.toFixed(2), `#${fdiA}-#${fdiB}`);
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

    if (showNumbers) {
      const labelByTooth = new Map(customLabels.map((item) => [String(item.tooth), item.label]));
      for (const [id, m] of Object.entries(teeth)) {
        if (!m.visible) continue;
        const c = centers[id];
        if (!c) continue;

        const fdi = universalToFdi(id);
        if (!fdi) continue;

        const el = document.createElement('div');
        el.className = 'viewer-tooth-badge';
        el.textContent = String(labelByTooth.get(id) ?? fdi);
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

  function updateLabelCoordinates() {
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 200;

    for (const item of dynamicLabels) {
      if (item.isVisible && !item.isVisible()) {
        item.el.hidden = true;
        continue;
      }

      const worldPos = item.getPosition();
      const { x, y, visible } = projectToScreen(worldPos, camera, width, height);

      if (!visible || x < -50 || x > width + 50 || y < -50 || y > height + 50) {
        item.el.hidden = true;
      } else {
        item.el.hidden = false;
        item.el.style.setProperty('--x', `${x.toFixed(1)}px`);
        item.el.style.setProperty('--y', `${y.toFixed(1)}px`);
      }
    }
  }

  function renderChips() {
    chipsBar.replaceChildren();
    if (selectedTeeth.size === 0) {
      chipsBar.hidden = true;
      return;
    }
    chipsBar.hidden = false;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'viewer-chips-title';
    titleSpan.textContent = T.selectedTeeth;
    chipsBar.appendChild(titleSpan);

    const sorted = [...selectedTeeth].sort((a, b) => Number(a) - Number(b));
    for (const id of sorted) {
      const fdi = universalToFdi(id) ?? id;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'viewer-fdi-chip';
      chip.dataset.id = id;
      chip.append(textSpan('', `#${fdi}`), textSpan('chip-remove', '✕'));
      chip.title = T.removeSelectionTitle(fdi);
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
    clearBtn.textContent = T.clearSelection;
    clearBtn.addEventListener('click', () => {
      selectedTeeth.clear();
      renderChips();
      options.onSelectionChange?.(new Set(selectedTeeth));
    });
    chipsBar.appendChild(clearBtn);
  }

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
    lines.push({ tag: 'strong', text: T.toothPrefix(fdi) });
    if (currentPlan) {
      lines.push({ text: T.cumulativeMove(moved) });
    }
    if (locked) lines.push({ className: 'badge-blue', text: T.locked });
    if (removed) lines.push({ className: 'badge-amber', text: T.removed });
    if (toothViols.length > 0) {
      lines.push({ className: 'badge-danger', text: T.violations(toothViols) });
    }

    replaceTooltipContent(tooltip, lines);

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
