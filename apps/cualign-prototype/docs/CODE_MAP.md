# 코드·파일 안내

제품 범위는 [PRD](PRD.md), 기술 구조·데이터 계약·한계는 [TRD](TRD.md),
설치·실행은 [README](../README.md), NVIDIA별 연결과 검증 수준은 [NVIDIA 활용](NVIDIA_STACK.md)을 참조한다.

## 실행 흐름

`server/static/`의 웹 UI → NAT 대화 경로 → `agent/register.py`의 계산 도구 → `core/`의 계획·검증 →
`core/store.py`의 결과 → `server/api.py`를 통한 3D 표시·파일 다운로드.
`configs/workflow.yml`은 모델·계획 에이전트·검토 에이전트·도구를 연결한다.

## 파일별 역할

### 계산·데이터

| 파일 | 목적·내용 |
|---|---|
| `src/cualign/core/planner.py` | 전략별 목표 생성, 단계 분할, 규칙 검사, 비교, STL 내보내기 |
| `src/cualign/core/case.py` | 치아별 메시 로딩, 케이스 구성, 이웃 치아 겹침 계산 |
| `src/cualign/core/arch.py` | 치열궁 곡선과 위치·길이 계산 |
| `src/cualign/core/limits.py` | 계산 한계값, 전략·치아 집합, 장수·기간 환산 |
| `src/cualign/core/rail_patterns.py` | 정규식 레일 목록(처방·확정 문구, 식별정보). import 없는 데이터 |
| `src/cualign/core/synth.py` | 환자 데이터 없이 재현하는 합성 케이스 생성 |
| `src/cualign/core/store.py` | 케이스·계획·부모·검토·승인 스냅샷 저장, 출력 시 승인 검사 |
| `src/cualign/core/constraints.py` | 공통 조건 모델·명시적 패치·치아/한도 검증 |
| `src/cualign/core/service.py` | API·에이전트 공통 조건 보존 계산 경로 |
| `src/cualign/core/gum.py` | 3D 표시용 잇몸 생성. 검증·출력 대상은 아님 |
| `src/cualign/core/templates/2.stl`~`15.stl` | 합성 치아와 뷰어에 쓰는 크라운 형상 14개 |
| `src/cualign/core/templates/ATTRIBUTION.md` | 위 형상 자산의 출처·라이선스 표기. 자산과 함께 보존 |
| `src/cualign/core/segmentation.py` | 외부 분리 모델 호출·라벨을 치아별 메시로 변환하는 선택적 어댑터 |

### 에이전트·서버·UI

| 파일 | 목적·내용 |
|---|---|
| `src/cualign/agent/register.py` | 조건 수정·계산·최종 계획 선택·승인된 출력 도구 |
| `src/cualign/agent/context.py` | 요청별 케이스·조건·부모·후보·검토 예산 컨텍스트 |
| `src/cualign/agent/reviewer.py` | 읽기 전용 검토, 시도/시간 상한, 실패 상태 저장 |
| `src/cualign/agent/react_patch.py` | 특정 NAT 응답 파싱 실패를 처리하는 호환 가드 |
| `src/cualign/agent/nim_stream_patch.py` | NIM 스트림 첫 줄의 오류(과부하 503 등)를 빈 답 대신 재요청·예외로 바꾸는 호환 가드 |
| `configs/workflow.yml` | 계획·검토 에이전트, 모델, 도구, 지시문 연결 |
| `src/cualign/server/worker.py` | NAT 서버에 결과 API·UI·계획 이벤트 연결, 진행 표시를 도구 이름·인자·«완료» 로 줄임(워크플로 단계 제거·도구 결과 제거) |
| `src/cualign/server/plan_events.py` | 요청 컨텍스트 검증과 최종 SSE 계획 이벤트 |
| `src/cualign/server/static/plan-stream.js` | 분할된 UTF-8/SSE·NAT 오류 조립과 이벤트 식별 |
| `src/cualign/server/api.py` | 케이스 업로드·계획 조회·규칙 폴백·파일 다운로드 |
| `src/cualign/server/rails.py` | 대화 입력 범위 검사와 출력 검사(NeMo Guardrails 호출) |
| `src/cualign/server/rails_middleware.py` | 위 검사를 NAT 워크플로 미들웨어로 걸고, 그 전에 정규식 목록(요청의 식별정보·답의 처방 문구)을 보고, 답을 출력 판정까지 쥐었다가 거절문으로 바꾸고, 턴별 레일 상태를 남기고, 에이전트 예외를 종류만 남긴 오류로 바꿈 |
| `src/cualign/server/static/index.html` | 케이스 선택, 대화, 3D 뷰어, 결과 영역의 화면 구조 |
| `src/cualign/server/static/app.js` | 대화 스트림, 계획 선택, 3D 단계 표시, 업로드·다운로드 연결 |
| `src/cualign/server/static/style.css` | 현재 PoC의 레이아웃·색·표시 스타일 |
| `guardrails/config.yml` | 검사 모델과 적용할 레일의 설정 |
| `guardrails/prompts.yml` | 범위·출력 검사에 쓰는 판정 프롬프트 |
| `src/cualign/cli.py` | 계산·벤치마크·서버 실행 명령 |
| 패키지별 `__init__.py` | 패키지 로딩·공개 함수 연결. 코드 보존 시 함께 유지 |

### 실행·검증·근거

| 파일·묶음 | 목적·내용 |
|---|---|
| `pyproject.toml` | 의존성과 패키지·CLI·NAT 등록 설정 |
| `uv.lock` | 재현에 쓰는 의존성 버전 고정 |
| `.env.example` | 필요한 설정 이름·예시. 실제 키는 로컬 `.env`에만 보관 |
| `.gitignore` | 비밀·실행 생성물의 추적 제외 |
| `Dockerfile` | 컨테이너 이미지와 서버 실행 설정 |
| `.github/workflows/ci.yml` | 변경 후 자동 검사 실행 |
| `tests/test_core.py` | 전략·단계·제약·STL 출력 검증 |
| `tests/test_stack_offline.py` | NAT 구성·도구 등록·Guardrails 구성 검사 |
| `tests/test_rails_middleware.py`, `tests/rails_fakes.py` | 가짜 레일·가짜 모델로 전 경로 차단·오류 기록·멈춤 스위치·정규식 레일·출력 보류·진행 표시·예외 문구 검사 |
| `tests/test_rail_patterns.py` | 정규식 목록이 걸려야 할 문장·넘겨야 할 문장·스킬 본문 검사 |
| `tests/test_react_patch.py` | 파서 호환 가드 검증 |
| `tests/test_nim_stream_patch.py` | 과부하 줄을 보내는 가짜 NIM 서버로 재요청·재시도 소진·재시도 불가 오류·연결 정리 검사 |
| `tests/test_segmentation.py` | 라벨→메시 분리 검사. 모델 추론 시험은 아님 |
| `tests/test_packaging.py`, `scripts/check_wheel.py` | wheel의 치아 형상·출처·정적 UI 누락·빈 파일 검사 |
| `tests/test_api.py` | UI 경로·승인→ZIP·잘못된 계획 ID 검사 |
| `tests/test_planning_flow.py`, `test_reviewer.py`, `test_plan_events.py` | 제약·부모·출력 내용·검토 실패·ASGI 요청 컨텍스트 회귀 |
| `tests/test_eval_runs.py` | yymmddhhmmss 스냅샷 검증 및 compare delta 정량 비교 검사 |
| `tests/plan-stream.test.mjs`, `tests/browser_flow.py` | 스트림 파서·브라우저 선택/재계획/승인·지연 응답 검사 |
| `evals/` | 타임스탬프 기반 불변 실행 레코드(`runs/YYMMDDHHMMSS/`)와 정량 비교 도구(`compare.py`, `recorder.py`) |
| `evals/agents/` | 다방면 평가 대상 에이전트 후보군(`production_react`, `reference_rule`, `clarification_first`, `loop_guarded`, `baselines`) |
| `docs/GOALS.md` | 단계별 정량 목표·측정 방법·현재값. 다른 문서는 목표 ID를 가리킴 |
| `docs/VERIFICATION.md` | 새 환경 재현 결과와 미검증 범위 |
| `docs/DEVELOPMENT.md`, `docs/ROADMAP.md` | 개발 진입점과 네 기능 작업·검증 범위 |
| `docs/KNOWN_ISSUES.md` | reviewer 오류의 관측·재현 조건·영향과 인수 시 주의점 |
| `docs/DESIGN_REFERENCES.md` | 기존 UI·형상 조사에서 계승한 설계 관찰과 출처 |
| `bench/bench.py` | 합성 케이스의 규칙 기반 비교 실행 |
| `bench/results.md` | 위 비교의 당시 결과 |
| `scripts/run_scenarios.py` | 다섯 실호출 시나리오 실행 |
| `docs/demo/` | 시나리오 실호출 로그·화면·검사 결과. 기록 당시 버전의 실행 근거 |
| `scripts/run_guardrails.py` | 범위 검사·오탐 확인용 실행 스크립트 |
| `docs/model-swap.md` | 모델·호출 방식별 성공·실패 기록 |
| `docs/clinical-sources.md` | 계산 상수의 참고 출처 |
| `openshell/policy.yaml` | 도구 실행의 네트워크·파일 접근 경계 정책 |
| `docs/openshell.md` | 정책 검증 수준과 서버 통합의 한계 |
| `skills/cualign-clinical-rules/SKILL.md` | 도메인 규칙 검사 절차 |
| `skills/skillspector-report-static.md`, `skills/skillspector-report.md` | 당시 정적·의미 스캔 결과 |
| `scripts/scan_skill.py` | 위 스캔 재실행 스크립트 |
| `scripts/import_tooth_templates.py` | 형상 원본에서 템플릿을 준비한 변환 과정 |
| `docs/segmentation.md` | 선택적 분리 어댑터의 연결·미검증 상태 |
| `CONTRIBUTING.md` | 개발 환경·검증·기여 안내 |
| `SECURITY.md` | 보안 범위·데이터 취급 안내 |
