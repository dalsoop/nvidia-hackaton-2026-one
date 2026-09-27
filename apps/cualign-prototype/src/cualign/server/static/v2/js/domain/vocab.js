// Centralized Korean vocabulary dictionary for cuAlign UI v2

export const T = {
  appName: 'cuAlign',
  tagline: '투명교정 에이전트',

  // Rail navigation
  rail: {
    steps: {
      cases: '케이스',
      intake: '환자·스캔',
      check: '입력 확인',
      workspace: '작업대',
      approve: '승인',
      export: '내보내기'
    },
    kindPatient: '환자',
    kindSample: '샘플',
    kindPatientTitle: '환자 케이스 · 스캔을 올리고 번호를 확인한 뒤 계획합니다',
    kindSampleTitle: '샘플 케이스 · 스캔 올리기와 입력 확인 없이 바로 작업대로 갑니다',
    lockPlan: '계획 후',
    lockViolation: '위반 해결 후',
    lockExport: '승인 후',
    lockConfirm: '번호 확인 후',
    lockScan: '스캔 후',
    statusReady: '대기',
    opensAfter: (label, note) => `${label} · ${note} 열립니다`
  },

  // Case & plan status
  status: {
    scan_check: '스캔 확인 필요',
    scan_check_desc: '올린 스캔의 치아 번호를 아직 확인하지 않음',
    needs_plan: '계획 필요',
    needs_plan_desc: '이 케이스에 저장된 계획이 없음',
    violation: '위반 있음',
    violation_desc: '대표 계획이 규칙을 어김',
    ready: '승인 대기',
    ready_desc: '규칙을 통과했고 아직 승인 전',
    approved: '승인됨',
    approved_desc: '승인 기록이 있음 · STL 내보내기 가능'
  },

  // Case list & filters
  cases: {
    title: '케이스',
    filter: '필터',
    filterStatus: '상태',
    filterKind: '종류',
    sample: '샘플',
    anonymizedPatient: '가명 환자',
    colCase: '케이스',
    colStatus: '상태',
    colPlan: '대표 계획',
    colViolation: '위반',
    colPlansCount: '계획',
    colPrescription: '처방',
    newPatient: '새 환자',
    currentCase: '현재 케이스'
  },

  // Counting functions
  violations: (n) => `위반 ${n}건`,
  stagesCount: (n) => `${n}장`,
  monthsCount: (n) => `${n}개월`,
  teethCount: (n) => `치아 ${n}개`,
  plansCount: (n) => `계획 ${n}개`,
  itemsCount: (n) => `${n}건`,

  // Intake & check
  intake: {
    uploadTitle: '상악 스캔 파일 올리기',
    dropHint: '치아별 STL(2.stl … 15.stl, Universal 번호) · 선택: gingiva.stl',
    confirmButton: '확인하고 계획 시작',
    mirrorButton: '좌우 뒤집기',
    unsupportedScan: '지원하지 않는 스캔은 계획용으로 확인할 수 없습니다.',
    scanUnreadable: '스캔을 읽지 못했습니다.'
  },

  // Workspace & panels
  workspace: {
    rules: '규칙',
    conditions: '조건',
    stages: '단계 표',
    agent: '에이전트',
    recalculateWithConditions: '이 조건으로 계산',
    approveButton: '승인',
    approvedState: '승인됨',
    exportStlButton: 'STL 내보내기',
    requestReviewRetry: '검토 다시 요청',
    passed: '통과',
    failed: '실패',
    skipped: '미실행',
    stalePlanNotice: '스캔 번호가 바뀐 뒤의 이전 계획입니다. 새 입력으로 다시 계획하세요.',
    requireDoctorConfirm: '의사의 명시적 확인이 필요합니다.'
  },

  // Topbar
  topbar: {
    newPatient: '새 환자',
    noActiveCase: '케이스 선택 안 됨'
  },

  // Common errors and notifications
  errors: {
    network: '네트워크 연결에 실패했습니다.',
    notFound: '요청한 대상을 찾을 수 없습니다.',
    server: '서버 오류가 발생했습니다.'
  }
};
