// Viewer stage scrubber bar skeleton (J5 contract)

export function createStageBar(container, { max = 0, value = 0, violations = [], onChange = null } = {}) {
  function setStage(n) {}
  function destroy() {}

  return {
    setStage,
    destroy
  };
}
