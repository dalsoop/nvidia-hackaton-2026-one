// Centralized Korean vocabulary dictionary for scan input check screen (J4)

export const CHECK_VOCAB = {
  title: '입력 확인',
  supportedBadge: '계획 가능',
  unsupportedBadge: '지원 불가',
  versionSuffix: (rev) => `상악 (버전 ${rev})`,
  loading: '스캔 점검 결과를 불러오는 중…',
  fetchError: '스캔 점검 정보를 불러오지 못했습니다.',
  meshFailed: '3D 스캔을 불러오지 못했습니다.',

  // Orientation warnings and notes
  reversedTitle: '치아 번호가 좌우 반대로 보입니다.',
  mirrorButton: '좌우 번호 뒤집기',
  mirrorFailed: '좌우 번호 뒤집기에 실패했습니다.',

  orientationNoticeTitle: '주의: 방향 근거 없음',

  // Unsupported scan danger box
  unsupportedTitle: '계획할 수 없는 스캔',
  unsupportedDefaultReason: '스캔 점검 기준을 충족하지 못했습니다.',

  // Inspection terms
  terms: {
    teeth: '치아',
    missing: '누락',
    outside: '범위 밖',
    crowding: '총생',
    rotation: '회전 보정 대상',
    vertical: '높이 보정 대상',
    gingiva: '잇몸 스캔',
    orientation: '방향 정렬'
  },

  // Values & summaries
  scannedGingiva: '스캔 잇몸',
  generatedGingiva: '표시용 생성 잇몸',
  emptyNone: '없음',
  noRotationNeeded: '보정할 회전 없음',
  noVerticalNeeded: '보정할 차이 없음',
  occlusalSide: '교합면 쪽',
  gingivalSide: '잇몸 쪽',
  unspecified: '미지정',

  // Orientation bases
  bases: {
    gingiva: '잇몸 기준',
    cervical: '치관 아래 경계 기준',
    occlusal: '교합면 기준',
    palate: '구개(입천장) 기준',
    none: '근거 없음'
  },
  renumberedSuffix: ' · 번호 좌우 뒤집음',
  rotationSuffix: (deg) => ` · ${deg}° 회전`,
  errorPrefix: '오류: ',

  // Tooth width table
  widthTableTitle: '치아 폭 표 (FDI)',
  tableHeaderTooth: 'FDI 치아',
  tableHeaderWidth: '접촉 폭',
  toothNumber: (fdi) => `${fdi}번`,
  widthMm: (mm) => `${mm} mm`,
  crowdingMm: (mm) => `${mm} mm`,
  teethCountWithFdi: (count, list) => `${count}개 · FDI: ${list || '없음'}`,


  // Primary action & Delete buttons
  btnStartPlan: '번호 확인 — 계획 시작',
  btnUnsupported: '계획할 수 없는 스캔',
  btnDelete: '스캔 삭제',
  confirmDeletePrompt: '이 스캔과 파일을 삭제하시겠습니까? 되돌릴 수 없습니다.',
  deleteConfirm: '삭제 확인',
  cancel: '취소',
  deleteFailed: '스캔 삭제에 실패했습니다.',

  // Confirm errors
  conflict409: '확인 충돌(409): 지원하지 않는 스캔이거나 개정판 충돌이 발생했습니다.',
  planStartFailed: '계획 시작에 실패했습니다.'
};

export default CHECK_VOCAB;
