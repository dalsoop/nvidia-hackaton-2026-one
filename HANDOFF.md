# HANDOFF — 세션 간 인계 (git-tracked, session-end 소유)

## 이어서 할 일
> 2026-09-28 세션 종료 시 기록

- 제출물 논의부터 시작한다 — 다음 세션은 제출 양식·스크린샷·문서 이야기(사용자 예고). 화면 장면 목록은 `apps/cualign-prototype/docs/demo/README.md`.
- 시연 전 8000 을 깨끗이 띄우려면 `apps/cualign-prototype/out/` 을 비우고 main 체크아웃에서 `uv run --frozen python -m cualign.cli serve --port 8000` (E2E 중 만든 케이스 5건이 목록에 남아 있다).
- 계산 코어 후속(제출 뒤): 우클릭 IPR 의 면별 양을 플래너가 계획에 반영(지금은 셋업 절삭 표시·서버 조건까지만, PR #194 「못 한 것」).

### 현재 상태 / 주의점
- 커밋: main `bee3b6b` push 됨, main CI 통과. 열린 PR 은 #145(`/ui/v2`, 예선 후) 하나. 미커밋 잔여 1: `apps/cualign-prototype/workspace/skills/skillspector-report-static.md`(생성 보고서가 재스캔됨 — 커밋하지 않음).
- 오늘 들어간 것: #164~#218 — 직접 이동, 추론 스트림(37초 침묵 해소), 모듈화(app.js → 모듈 12개, 각 600줄 이하), 한 장 14일 환산·「12개월 안에」 칩, 통합 묶음 PR 방식(#203·#214). 병렬 세션 운영 규칙은 `apps/cualign-prototype/docs/parallel-work.md`.
- 시연 흐름(000097): 처방 칩 → 셋업(스캔 연출) → 목표(치열궁 연출) → 단계(자라나는 연출, 착지는 마지막 단계) → 「12개월 안에」는 27 > 26 으로 best_failed 장면(의도) → 비교 → 승인·내보내기. 「건너뛰기」는 에이전트를 실제로 끊고 녹화 답을 10 ms 안에 표시.
- 실 NIM 검증은 사용자 E2E(000097 완료, 000001 일부)뿐. 세션 검증은 가짜 스트림. 「모델이 계획 대신 추론문만 돌려보냄」 오류가 간헐적으로 남(녹화 답으로 대체됨).
- NVIDIA 양식(SOUL/AGENTS/TOOLS/USER/HEARTBEAT/skills)은 `apps/cualign-prototype/workspace/` 에 있음(#89). `memory/` 폴더 대신 `MEMORY.md` 파일 — 심사 기준이 폴더면 빈 `memory/` 추가.
- 헤드리스 브라우저 검증은 GPU(d3d11)로 돈다(#196). SwiftShader 로 돌리면 CPU 100%.
- Orca 워크트리·세션은 전부 거뒀다. 8000 은 main 체크아웃에서 실행 중(세션 종료 시 프로세스는 남음).
- 문서 위생 검사기(`scripts/doc_drift_check.py`)·`ROADMAP.md` 없음 — 해당 없음.
