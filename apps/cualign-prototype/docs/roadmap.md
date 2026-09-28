# 예선 데모 개선 작업

> 2026-09-25 · `feat/cualign-demo-completion` 브랜치에서 네 기능을 함께 구현한다.
> 대상 앱: `apps/cualign-prototype/`. 검증 범위는 [VERIFICATION](verification.md)을 따른다.
> 오프라인·가짜 모델 브라우저 검증과 NVIDIA 실호출을 구분한다.

| 작업 | 구현 동작 | 검사 |
|---|---|---|
| 조건 수정 후 3D | 최종 선택 이벤트, 부모 계획 기록, 동일 계획으로 3D·카드·다운로드 갱신 | 부모 JSON, 후보 선택, 지연 응답, ZIP 좌표·단계 수 |
| 제약 유지 | 비발치·고정·IPR 면당 한도/제외·단계 상한·순서를 공통 모델로 저장 | 비교·수정·검증 동일 값, 명시적 변경 외 유지, 위반 주입 |
| reviewer 오류 | 읽기 전용 검토, 최대 2회/40초, 성공·실패 저장 및 표시 | 빈 응답·503·잘못된 응답·타임아웃·재호출 상한 |
| 의사 승인·내보내기 | 명시적 승인, 수정안 미승인, API·도구·기존 ZIP 출력 시 승인 검사 | 미승인 거부, 승인 후 출력, 승인 취소, 내용 변경 감지 |

사용 흐름: 케이스 선택 → 조건 입력/대화 → 계획 생성 → 3D·검토·부모 이력 확인 →
조건 수정 → 새 계획 확인 → 의사 승인 → 단계별 치아 STL 다운로드.
뷰어 0은 초기 상태이며 1~N은 실제 계획의 N개 단계다.

프로토타입의 승인 조건은 규칙 통과와 검토 메모 생성 성공이다.
규칙 폴백은 검토 에이전트 미실행임을 표시한 뒤 의사가 승인할 수 있다.
규칙 위반·검토 실패 계획은 승인하지 못한다. 승인은 임상 검증이나 사용자 신원 인증을 뜻하지 않는다.

## 검증과 후속 확인

- Python 회귀 검사는 `uv run pytest -q -p no:warnings`.
- 스트림 파서는 `node --test tests/plan-stream.test.mjs`.
- 브라우저는 `uv run --frozen --with playwright python tests/browser_flow.py`.
  설치된 Chrome 또는 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`을 사용한다. three.js CDN 접근이 필요하다.
  모델은 가짜 응답을 사용하고 결과는 추적 제외된 `out/browser-acceptance/`에 둔다.
- NVIDIA 실호출은 2026-09-25에 `/chat/stream` 2턴으로 확인했다. 결과와 남은 항목은 VERIFICATION에 있다.
- 재시작 복원·사용자 인증·다중 사용자 격리는 이번 구현 범위가 아니다.

[PR #8](https://github.com/dalsoop/nvidia-hackaton-2026-one/pull/8)의 문서 위치·검증 보고 기준과
[PR #9](https://github.com/dalsoop/nvidia-hackaton-2026-one/pull/9)의 앱 위치를 따른다.
[PR #5](https://github.com/dalsoop/nvidia-hackaton-2026-one/pull/5)·
[PR #7](https://github.com/dalsoop/nvidia-hackaton-2026-one/pull/7)·
[PR #10](https://github.com/dalsoop/nvidia-hackaton-2026-one/pull/10)은 확인 시 미병합이므로 반영된 기능으로 계산하지 않는다.
서버·도구 등록·워크플로 파일의 병합 충돌과 #10의 이전 앱 경로를 확인해야 한다.
#10의 503→빈 답변 관측과 KNOWN_ISSUES의 reviewer 파싱 오류가 같은 근본 원인이라고 단정하지 않는다.
Skill API 요건의 확인 수준은 [NVIDIA_STACK](nvidia-stack.md)에 남긴다.
