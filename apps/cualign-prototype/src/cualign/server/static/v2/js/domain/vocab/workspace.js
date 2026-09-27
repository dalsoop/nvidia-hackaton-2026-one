const ORDER_LABELS = Object.freeze({
  simultaneous: '이동 동시',
  anterior_first: '앞니 먼저',
  sequential: '순차 이동'
});

export const WORKSPACE_VOCAB = Object.freeze({
  plansTitle: '계획',
  planPanel: '계획 패널',
  stages: '단계 표',
  stagesLabel: (n) => `${n}장`,
  violationsLabel: (n) => `위반 ${n}건`,
  plansCount: (n) => `계획 ${n}개`,
  emptyPlansNote: '저장된 계획이 없습니다.',
  loading: '작업대를 여는 중...',
  viewing: '보는 중',
  view: '보기',
  planTitle: (n) => `계획 ${n}`,
  planApprove: (title) => `${title} 승인`,
  approvedState: '승인됨',
  confirmAndApprove: '조건·3D·검토 확인 — 승인',
  cancel: '취소',
  revokeApproval: '승인 취소',
  exportStlButton: 'STL',
  exportAfterApproval: '승인 후',
  requestReviewRetry: '검토 다시 요청',
  requestingReview: '검토 요청 중...',
  approving: '승인 처리 중...',
  revoking: '승인 취소 중...',
  approvedTime: (time) => `승인 시각 ${time}`,
  approvedDone: '승인됨',
  cannotApproveViolations: (n) => `위반 ${n}건을 해결해야 승인할 수 있습니다`,
  cannotApproveReview: '검토가 완료되어야 승인할 수 있습니다',
  staleBadge: '이전 스캔 기준',
  stalePlanNotice: '스캔 번호가 바뀐 뒤의 이전 계획입니다. 새 입력으로 다시 계획하세요.',
  reviewLine: (title, status) => `${title} 검토 · ${status}`,
  passed: '통과',
  failed: '실패',
  skipped: '미실행 (규칙 폴백)',
  notRequested: '미실행',
  noReviewMemo: '검토 메모가 없습니다.',
  memoExpand: '검토 내용 펼치기',
  memoCollapse: '검토 내용 접기',
  plansLoadFailed: '계획을 불러오지 못했습니다.',
  planStartTitle: '계획을 만들지 못했습니다',
  unknownPlanFailure: '계획 생성 결과가 없습니다.',
  conditionsTitle: '조건',
  noStages: '계획이 없어 단계가 없습니다.',
  recalculateWithConditions: '이 조건으로 다시 계산',
  calculating: '계산 중...',
  agent: '에이전트',
  strategies: Object.freeze({
    expansion: '확장',
    ipr: 'IPR',
    expansion_ipr: '확장 + IPR',
    extraction: '발치',
    unknown: '전략 미정'
  }),
  constraintTags(constraints = {}) {
    const tags = [];
    if (typeof constraints.allow_extraction === 'boolean') {
      tags.push(constraints.allow_extraction ? '발치 허용' : '비발치');
    }
    if (Array.isArray(constraints.lock) && constraints.lock.length) {
      tags.push(`고정 ${constraints.lock.join(', ')}`);
    }
    if (Array.isArray(constraints.ipr_exclude) && constraints.ipr_exclude.length) {
      tags.push(`IPR 제외 ${constraints.ipr_exclude.join(', ')}`);
    }
    if (constraints.ipr_limit_mm != null) tags.push(`면당 ${constraints.ipr_limit_mm} mm`);
    tags.push(constraints.stage_cap == null ? '단계 상한 없음' : `단계 상한 ${constraints.stage_cap}`);
    if (constraints.order) tags.push(ORDER_LABELS[constraints.order] || constraints.order);
    return tags;
  }
});
