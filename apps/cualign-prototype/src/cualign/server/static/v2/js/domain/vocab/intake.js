// Korean vocabulary and copy definitions for intake & upload screens (J3)

export const TOOTH_NAMES = Object.freeze({
  1: '우측 제3대구치 (사랑니)',
  2: '우측 제2대구치',
  3: '우측 제1대구치',
  4: '우측 제2소구치',
  5: '우측 제1소구치',
  6: '우측 견치 (송곳니)',
  7: '우측 측절치',
  8: '우측 중절치 (앞니)',
  9: '좌측 중절치 (앞니)',
  10: '좌측 측절치',
  11: '좌측 견치 (송곳니)',
  12: '좌측 제1소구치',
  13: '좌측 제2소구치',
  14: '좌측 제1대구치',
  15: '좌측 제2대구치',
  16: '좌측 제3대구치 (사랑니)'
});

export const INTAKE_TEXTS = Object.freeze({
  patientListTitle: '환자 목록',
  patient: '환자',
  newPatientTitle: '새 환자 등록',
  aliasPlaceholder: '별칭 (필수, 예: 환자 A)',
  memoPlaceholder: '메모 (선택, 최대 200자)',
  aliasRequired: '별칭을 입력하세요.',
  submitNewPatient: '새 환자 등록',
  noPatients: '등록된 환자가 없습니다.',
  deletePatientBtn: '환자 삭제',
  deletePatientTitle: '환자 삭제',
  confirmDeletePatient: (alias, pid) => `환자 ${alias} (${pid})와 모든 스캔을 삭제하시겠습니까? 되돌릴 수 없습니다.`,
  confirmDeleteScan: (sid) => `스캔 ${sid}를 삭제하시겠습니까?`,
  deleteConfirmBtn: '삭제 확인',
  cancelBtn: '취소',
  scanListTitle: '스캔 목록',
  noScans: '아직 등록된 스캔이 없습니다. 아래에서 상악 치아 스캔을 올려주세요.',
  confirmedBadge: '확인 완료',
  unconfirmedBadge: '확인 필요',
  checkScanBtn: '입력 확인',
  deleteScanBtn: '삭제',
  deleteScanTitle: '스캔 삭제',
  scanCountText: (count) => `스캔 ${count}`,
  patientMeta: (pid, date, memo) => `${pid} · 등록 ${date}${memo ? ' · ' + memo : ''}`,
  scanMaxilla: (sid) => `${sid} · 상악`,
  scanMeta: ({ teethCount, hasGingiva, uploadedAt, isConfirmed, plansCount }) => {
    const teethPart = `치아 ${teethCount}개${hasGingiva ? ' · 잇몸 포함' : ''}`;
    const datePart = uploadedAt;
    const statusPart = isConfirmed ? `번호 확인됨 · 계획 ${plansCount}개` : '번호 확인 전';
    return `${teethPart} · ${datePart} · ${statusPart}`;
  },
  uploadTitle: '상악 스캔 파일 올리기',
  dropHint: '치아별 STL(2.stl … 15.stl, Universal 번호) · 선택: gingiva.stl',
  dropzoneAriaLabel: '스캔 파일 드롭 영역',
  dropzonePrimary: '치아별 STL 파일을 이곳에 끌어다 놓거나 클릭하여 선택',
  dropzoneSecondary: '파일명: 2.stl … 15.stl (Universal 상악 번호) · 선택: gingiva.stl (잇몸)',
  dropzoneLimits: (fileMb, totalMb) => `파일당 최대 ${fileMb}MB · 1회 업로드 최대 ${totalMb}MB`,
  summaryTeethCount: (count, hasGum) => `상악 치아 ${count}개${hasGum ? ' · 잇몸 파일 포함' : ''}`,
  validationPassedBadge: '검사 통과',
  uploading: '스캔 올리는 중 — 치아를 읽고 있습니다...',
  uploadBtn: '스캔 올리기',
  reselectBtn: '다시 선택',
  noPatientSelected: '선택된 환자가 없습니다.',
  tableTitle: 'Universal ↔ FDI 치아 번호 대응표',
  tableNote: 'cuAlign 파일명: Universal 번호(2.stl~15.stl) · 화면 차트: FDI 번호',
  tableColUniversal: 'Universal',
  tableColFdi: 'FDI',
  tableColName: '치아 명칭 (상악)',
  tableColFileName: '권장 파일명',
  tableColStatus: '선택 상태',
  badgeSelected: '선택됨',
  badgeOptionalWisdom: '선택(사랑니)',
  badgeNotIncluded: '미포함',
  badgeSelect: '선택',
  defaultToothName: (u) => `상악 치아 ${u}`,
  gingivaMeshLabel: '상악 잇몸 메시 (선택 사항)'
});

export const UPLOAD_MESSAGES = Object.freeze({
  selectFiles: '올릴 스캔 파일을 선택해 주세요.',
  duplicateTooth: (name) => `${name}: 같은 번호의 파일이 두 개 있습니다.`,
  sizeExceeded: (fileMb, totalMb) => `파일이 너무 큽니다(파일당 ${fileMb}MB, 한 번에 ${totalMb}MB까지).`,
  lowerArch: (files) => `${files}: 하악(Universal 17~32) 번호입니다. 지금은 상악 스캔만 받습니다.`,
  monolithicScan: (files) => `${files}: 한 덩어리 악궁 스캔으로 보입니다. 지금은 치아별로 나뉜 파일(2.stl … 15.stl, 선택 gingiva.stl)만 받습니다. 자동 치아 분리는 실험 단계입니다.`,
  noTeeth: '치아별 STL(<치아번호>.stl, Universal 상악 2~15)을 한 개 이상 올려 주세요. 잇몸 파일만으로는 계획할 수 없습니다.'
});
