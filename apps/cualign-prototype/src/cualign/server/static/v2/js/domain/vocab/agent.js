// Vocabulary dictionary for cuAlign Agent interface (J7 contract)

export const T_AGENT = {
  title: '에이전트',
  messageLabel: '메시지',
  messagePlaceholder: '메시지 입력',
  send: '전송',
  ruleCalc: '규칙으로 계산',
  resend: '다시 보내기',
  requestFailed: '계획 요청 실패',
  overloadNotice: 'NVIDIA API가 일시적으로 과부하 상태입니다. 다시 시도해 주세요.',
  makingPlan: (n) => `계획 ${n}을 만드는 중`,
  ruleFallbackNotice: '규칙 기반 폴백 · 처방 조건으로 계획 계산',
  running: '실행 중',
  done: '완료',
  failed: '실패',

  // Tool name mappings for doctor-friendly display
  tools: {
    load_case: '케이스 불러오기',
    set_constraints: '처방 반영',
    propose_target: '목표 배열 제안',
    plan_stages: '단계 계획',
    validate: '규칙 검사',
    export_stl: '출력 파일 생성'
  }
};
