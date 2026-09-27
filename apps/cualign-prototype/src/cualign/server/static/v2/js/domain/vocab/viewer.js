// Centralized Korean vocabulary dictionary for 3D Viewer (J5)

export const VIEWER_T = {
  views: {
    occlusal: '교합면',
    frontal: '정면',
    right: '우측',
    left: '좌측',
    back: '설측',
    base: '바닥',
    viewSuffix: (view) => `${view}에서 본 모습`
  },
  layers: {
    ghost: '치료 전 겹쳐 보기',
    heat: '이동량 색',
    ipr: 'IPR',
    numbers: '치아 번호',
    gum: '잇몸'
  },
  stageBar: {
    firstTitle: '처음 단계 (Home)',
    playPauseTitle: '재생 / 일시정지 (Space)',
    lastTitle: '최종 단계 (End)',
    ariaLabel: '3D 단계 제어기',
    noPlan: '계획 없음',
    beforeTreatment: (total) => `치료 전 · 총 ${total}단계`,
    beforeTreatmentWithMonths: (total, months) => `치료 전 · 총 ${total}단계 · 예상 ${months}개월`,
    stageLabel: (k, total) => `단계 ${k} / ${total}`,
    stageLabelWithMonths: (k, total, months) => `단계 ${k} / ${total} · 예상 ${months}개월`,
    collisionCount: (n) => `충돌 ${n}건`,
    moveLimitCount: (n) => `이동한계 초과 ${n}건`,
    stageViolationTitle: (stage, details) => `단계 ${stage}: ${details.join(', ')}`
  },
  arch: {
    upper: '상악',
    lower: '하악',
    archInfo: (archName, teethCount, viewDescription) => `${archName} · 치아 ${teethCount}개 · ${viewDescription}`
  },
  overlay: {
    selectedTeeth: '선택한 치아:',
    clearSelection: '모두 해제',
    removeSelectionTitle: (fdi) => `치아 ${fdi}번 선택 해제`,
    toothPrefix: (fdi) => `치아 #${fdi}`,
    cumulativeMove: (mm) => `누적 이동: ${typeof mm === 'number' ? mm.toFixed(2) : mm} mm`,
    locked: '고정',
    removed: '발치',
    collision: '충돌',
    moveLimit: '장당 이동 한계 초과',
    iprTitle: (mm, pairStr) => `IPR ${mm}mm (${pairStr})`,
    violations: (list) => `위반: ${list.join(', ')}`
  }
};
