// Centralized Korean vocabulary dictionary for workspace and plans (J6 contract)

export const WORKSPACE_VOCAB = Object.freeze({
  // Workspace Layout & Headings
  rules: '규칙',
  conditions: '조건',
  stages: '단계 표',
  agent: '에이전트',
  plansTitle: '계획 목록',
  plansCount: (n) => `계획 ${n}개`,
  stagesCount: (n) => `${n}장`,
  violationsCount: (n) => `위반 ${n}건`,
  emptyPlansNote: '저장된 계획이 없습니다.',
  emptyPlansMessage: '이 케이스에 생성된 계획이 없습니다.',
  noCaseSelected: '케이스가 선택되지 않았습니다.',
  selectCaseDesc: '케이스 목록에서 계획할 케이스를 먼저 선택해주세요.',
  goToCasesButton: '케이스 목록으로 가기',
  loadingCase: (id) => `${id} 케이스를 여는 중...`,

  // Plan Card Status & Buttons
  planTitle: (n) => `계획 ${n}`,
  viewing: '보는 중',
  view: '보기',
  approveButton: '승인',
  approvedState: '승인됨',
  confirmAndApprove: '확인하고 승인',
  cancel: '취소',
  revokeApproval: '승인 취소',
  exportStlButton: 'STL 내보내기',
  requestReviewRetry: '검토 다시 요청',
  requestingReview: '검토 요청 중...',
  approving: '승인 처리 중...',
  revoking: '승인 취소 중...',
  approvedTimePrefix: '승인 시각:',
  approvedTime: (time) => `승인 시각: ${time}`,
  approvedDone: '승인 완료',
  cannotApproveHint: (reasons) => `승인 불가 · ${reasons.join(', ')}`,
  reasonViolations: '규칙 위반 해결 필요',
  reasonReviewNeeded: '검토 완료 필요',

  // Stale status
  staleBadge: '이전 스캔 기준',
  stalePlanNotice: '스캔 번호가 바뀐 뒤의 이전 계획입니다. 새 입력으로 다시 계획하세요.',

  // Review Statuses & Messages
  reviewPrefix: '검토:',
  reviewBadge: (status) => `검토: ${status}`,
  errorPrefix: (err) => `오류: ${err}`,
  passed: '통과',
  failed: '실패',
  skipped: '미실행',
  notRequested: '미실행',
  noReviewMemo: '검토 메모가 없습니다.',
  reviewModelDisconnected: '검토 모델이 연결되지 않았습니다.',
  memoExpand: '메모 펼치기 ▾',
  memoCollapse: '메모 접기 ▴',
  requireDoctorConfirm: '의사의 명시적 확인이 필요합니다.',

  // Strategies
  strategies: {
    expansion: '확장',
    ipr: 'IPR',
    expansion_ipr: '확장 + IPR',
    extraction: '발치',
    unknown: '전략 미정'
  },

  // PlanStart (Activate Failure / 0 Plans Screen)
  planStartTitle: '계획 생성 필요',
  planStartDesc: '케이스 초기 계획을 생성하지 못했거나 저장된 계획이 없습니다.',
  errorCause: '오류 원인:',
  recalculateWithConditions: '이 조건으로 다시 계산',
  calculating: '계산 중...',
  calculationFailed: (msg) => `계산 실패: ${msg}`
});
