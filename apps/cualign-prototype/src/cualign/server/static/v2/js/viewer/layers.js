// Layer toggles and tooth appearance (ghost overlay, heat tint, IPR, numbers, gum)

import * as THREE from 'three';
import {
  getViolationsAtStage,
  calculateMaxMovement,
  calculateMovementHeat
} from './math.js';

export const COLOR_IVORY = 0xe9e3d6;
export const COLOR_HEAT = 0x76b900;
export const COLOR_RED = 0xe52020;
export const COLOR_AMBER = 0xef9100;
export const COLOR_BLUE = 0x4f8fd6;
export const COLOR_EMISSIVE = 0x2f4a00;

/**
 * Creates the layer visual manager for the 3D viewer.
 *
 * @param {object} param0
 * @param {THREE.Group} param0.ghostGroup
 * @param {object} param0.teethManager
 * @returns {object}
 */
export function createLayersManager({ ghostGroup, teethManager }) {
  const state = {
    ghost: false,     // 치료 전 겹쳐 보기 (ghost overlay)
    heat: true,       // 이동량 색 (heat tint)
    ipr: true,        // IPR 라벨
    numbers: false,   // 치아 번호 표시 (상시)
    gum: true         // 잇몸 표시
  };

  const ivoryColor = new THREE.Color(COLOR_IVORY);
  const heatColor = new THREE.Color(COLOR_HEAT);

  /**
   * Updates material appearance and layer visibilities for the current stage.
   *
   * @param {object|null} plan
   * @param {number} stage
   * @param {Set<string>} [selectedTeeth=new Set()]
   */
  function applyAppearance(plan, stage = 0, selectedTeeth = new Set()) {
    const teeth = teethManager.getTeeth();
    const gum = teethManager.getGum();
    const hasPlan = !!plan;

    // Ghost overlay visibility
    ghostGroup.visible = !!state.ghost && stage > 0;

    // Gum visibility
    if (gum) {
      gum.visible = !!state.gum;
    }

    const { byTooth } = getViolationsAtStage(plan?.violations, stage);
    const locked = new Set((plan?.target?.locked ?? []).map(String));
    const maxMove = calculateMaxMovement(plan?.stages);

    for (const [id, m] of Object.entries(teeth)) {
      const isBadCollision = byTooth[id]?.has('collision');
      const isBadMoveLimit = byTooth[id]?.has('move_limit');
      const isLocked = locked.has(id);
      const isSelected = selectedTeeth.has(id);

      // Color coding priority: Collision (red) > Move limit (amber) > Locked (blue) > Movement Heat > Ivory
      if (isBadCollision) {
        m.material.color.setHex(COLOR_RED);
      } else if (isBadMoveLimit) {
        m.material.color.setHex(COLOR_AMBER);
      } else if (isLocked) {
        m.material.color.setHex(COLOR_BLUE);
      } else if (hasPlan && state.heat) {
        const moved = m.userData.moved || 0;
        const heat = calculateMovementHeat(moved, maxMove);
        m.material.color.copy(ivoryColor).lerp(heatColor, heat);
      } else {
        m.material.color.copy(ivoryColor);
      }

      // Selection highlight
      m.material.emissive.setHex(isSelected ? COLOR_EMISSIVE : 0x000000);
    }
  }

  function setLayers(opts = {}) {
    Object.assign(state, opts);
  }

  function getLayers() {
    return { ...state };
  }

  return {
    applyAppearance,
    setLayers,
    getLayers
  };
}
