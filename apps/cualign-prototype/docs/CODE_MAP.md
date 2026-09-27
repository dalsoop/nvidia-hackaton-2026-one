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
| `src/cualign/core/synth.py` | 환자 데이터 없이 재현하는 합성 케이스 생성. 테스트·에이전트 평가·CLI용이며 첫 화면에는 내놓지 않음 |
| `src/cualign/core/samples.py` | 첫 화면 샘플 3건(Poseidon3D 실제 상악 스캔)과 치과의사 처방. 처방을 케이스의 초기 계획 조건으로 넣음 |
| `src/cualign/core/samples/poseidon-*/` | 샘플 스캔(치아별 STL·잇몸·`SOURCE.txt`). `scripts/import_poseidon.py`로 만들었고 패키지에 포함 |
| `src/cualign/core/samples/ATTRIBUTION.md` | 샘플 스캔의 출처·라이선스(CC-BY-4.0)·변경 내용. 자산과 함께 보존 |
| `src/cualign/core/store.py` | 케이스·계획·부모·검토·승인 스냅샷 저장, 출력 시 승인 검사 |
| `src/cualign/core/skills.py` | `skills/<이름>/SKILL.md`를 읽어 `load_skill` 도구로 에이전트에 전달 |
| `src/cualign/core/constraints.py` | 공통 조건 모델·명시적 패치·치아/한도 검증 |
| `src/cualign/core/service.py` | API·에이전트 공통 조건 보존 계산 경로 |
| `src/cualign/core/patients.py` | 가명 환자·환자별 스캔 저장(로컬 `out/patients`), 재사용하지 않는 ID, 스캔 revision·확인 기록, 케이스 ID `P0001-S1` → 스캔 폴더 |
| `src/cualign/core/intake.py` | 업로드한 치아별 스캔을 코어 좌표계로 정렬(잇몸·치관 경계 기준, 원본은 `original/`), 좌우 번호 점검·뒤집기 |
| `src/cualign/core/gum.py` | 3D 표시용 잇몸 생성. 검증·출력 대상은 아님 |
| `src/cualign/core/print_model.py` | 단계별 프린트용 상악 모형: 스캔 잇몸 변형·높이 지도 합성·닫힌 메시 검사 |
| `src/cualign/core/templates/2.stl`~`15.stl` | 합성 치아와 뷰어에 쓰는 크라운 형상 14개 |
| `src/cualign/core/templates/ATTRIBUTION.md` | 위 형상 자산의 출처·라이선스 표기. 자산과 함께 보존 |
| `src/cualign/core/segmentation.py` | 외부 분리 모델 호출·라벨을 치아별 메시로 변환하는 선택적 어댑터 |

### 에이전트·서버·UI

| 파일 | 목적·내용 |
|---|---|
| `src/cualign/agent/register.py` | 조건 수정·계산·최종 계획 선택·승인된 출력 도구. `context_preload` 설정(케이스 요약·한도·스킬을 서버 문맥에 미리 실음, #48)과 그 값을 만드는 `case_view`·`limits_view`·`context_preload` |
| `src/cualign/agent/context.py` | 요청별 케이스·조건·부모·후보·검토 예산 컨텍스트 |
| `src/cualign/agent/reviewer.py` | 읽기 전용 검토, 시도/시간 상한, 실패 상태 저장, 의사 요청 재검토(`manual`), 저장 전 메모 출력 검사(`MEMO_CHECK`), 수치의 뜻을 알려주는 필드 설명(`FIELD_NOTES`) |
| `src/cualign/agent/react_patch.py` | 특정 NAT 응답 파싱 실패를 처리하는 호환 가드 |
| `src/cualign/agent/react_history_patch.py` | NAT ReAct 네이티브 도구 호출 모드가 다음 프롬프트에서 빠뜨리는 «실제로 부른 도구·인자»를 기록에 붙이는 호환 가드(같은 도구 반복 방지) |
| `src/cualign/agent/nim_stream_patch.py` | NIM 스트림 첫 줄의 오류(과부하 503 등)와 스트림 요청의 HTTP 429·5xx 를 빈 답·즉시 실패 대신 재요청·예외로 바꾸고, 스트림이 아닌 호출(검토)의 429·5xx 를 짧게 재요청하는 호환 가드. 간격·코드·대체 모델은 `configs/workflow.yml` 의 `nim_retry` 에서 읽음(`NimRetryConfig`) |
| `src/cualign/agent/overload.py` | 실패가 NVIDIA API 과부하인지 판정하는 하나의 기준(서버의 화면 안내와 골든셋 A 의 «판정 불가» 가 같이 씀) |
| `configs/workflow.yml` | 계획·검토 에이전트, 모델, 도구, 지시문 연결 |
| `src/cualign/server/worker.py` | NAT 서버에 결과 API·UI·계획 이벤트 연결, 진행 표시를 도구 이름·인자·«완료» 로 줄임(워크플로 단계 제거·도구 결과 제거), 검토 재요청에 워크플로 reviewer 설정·모델 연결 |
| `src/cualign/server/plan_events.py` | 요청 컨텍스트 검증과 최종 SSE 계획 이벤트(과부하로 죽은 턴의 `plan_error` `kind`·안내 문장 포함), 에이전트가 건너뛴 검토의 서버 실행. `open_run` 이 서버 문맥 시스템 메시지를 만들고 `preload` 로 케이스 요약·한도·스킬을 덧붙임(#48) |
| `src/cualign/server/static/plan-stream.js` | 분할된 UTF-8/SSE·NAT 오류 조립과 이벤트 식별 |
| `src/cualign/server/api.py` | 환자·스캔 업로드·입력 확인(`/check`)·계획 조회·규칙 폴백·검토 재요청·파일 다운로드 |
| `src/cualign/server/mcp_server.py` | NemoClaw용 MCP 서버(`/mcp`): 토큰 확인, `cualign_plan`은 서버 안에서 `/chat/stream`으로 요청해 UI와 같은 경로를 탐, 승인 도구는 승인하지 않고 내보내기 도구는 의사 승인을 요구 |
| `src/cualign/server/rails.py` | 대화 입력 범위 검사와 출력 검사(NeMo Guardrails 호출) |
| `src/cualign/server/rails_middleware.py` | 위 검사를 NAT 워크플로 미들웨어로 걸고, 그 전에 정규식 목록(요청의 식별정보·답의 처방 문구)을 보고, 답을 출력 판정까지 쥐었다가 거절문으로 바꾸고, 턴별 레일 상태를 남기고, 에이전트 예외를 종류만 남긴 오류로 바꿈. 검토 메모에도 같은 출력 검사를 제공 |
| `src/cualign/keys.py` | NVIDIA 키 사용 가능 여부. OpenShell provider placeholder(`openshell:resolve:env:`)도 키로 인정해 샌드박스에서 Guardrails가 꺼지지 않게 함 |
| `src/cualign/sandbox_compat.py` | 샌드박스 프록시 변수가 있을 때만 aiohttp 세션이 프록시를 따르게 함(NIM 비동기 클라이언트) |
| `src/cualign/server/static/index.html` | 케이스 선택, 대화, 3D 뷰어, 결과 영역의 화면 구조 |
| `src/cualign/server/static/app.js` | 대화 스트림, 계획 선택, 3D 단계 표시, 업로드·다운로드 연결, 과부하 실패 뒤 «다시 보내기»(같은 글·조건을 새 요청으로) |
| `src/cualign/server/static/style.css` | 현재 PoC의 레이아웃·색·표시 스타일 |
| `guardrails/config.yml` | 검사 모델(과부하 재요청 횟수 포함)과 적용할 레일의 설정, content-safety 모델에 보내는 맞춤 정책 본문 |
| `guardrails/prompts.yml` | 범위·출력 검사에 쓰는 판정 프롬프트 |
| `guardrails/policy/` | NVIDIA 카탈로그 스킬 `nemotron-policy-generator` 로 만든 정책 원문·분류 json·프롬프트와 출처(README) |
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
| `Dockerfile.openshell` | OpenShell 샌드박스용 이미지(비root, 출력은 `/sandbox/out`) |
| `.github/workflows/ci.yml` | 변경 후 자동 검사 실행 |
| `tests/test_core.py` | 전략·단계·제약·STL 출력 검증 |
| `tests/test_print_model.py` | 합성 잇몸 띠로 모형의 닫힘·치아 위치·잇몸 추종·잇몸 없음 건너뜀·치아별 출력 불변 검사 |
| `tests/test_stack_offline.py` | NAT 구성·도구 등록·Guardrails 구성 검사 |
| `tests/test_rails_middleware.py`, `tests/rails_fakes.py` | 가짜 레일·가짜 모델로 전 경로 차단·오류 기록·멈춤 스위치·정규식 레일·출력 보류·진행 표시·예외 문구·검토 건너뛴 턴·메모 레일·과부하 안내 이벤트 검사 |
| `tests/test_rail_patterns.py` | 정규식 목록이 걸려야 할 문장·넘겨야 할 문장·스킬 본문 검사 |
| `tests/test_skill_tool.py` | Skill 이름 검증·도구 등록(검토 에이전트 제외)·지시문 연결 검사 |
| `tests/test_keys.py`, `tests/test_sandbox_compat.py` | 키 판정(placeholder 포함)·프록시 호환 가드 검사 |
| `tests/test_react_patch.py` | 파서 호환 가드 검증 |
| `tests/test_react_history.py` | 앞선 호출을 기억해야 넘어가는 가짜 모델로 NAT 실제 그래프를 돌려 같은 도구 반복이 없는지 검사 |
| `tests/test_nim_stream_patch.py` | 과부하 줄(스트림)과 HTTP 429·503(스트림·비스트림)을 보내는 가짜 NIM 서버로 재요청·재시도 소진·재시도 불가 오류·연결 정리·대체 모델·설정 반영 검사 |
| `tests/test_segmentation.py` | 라벨→메시 분리 검사. 모델 추론 시험은 아님 |
| `tests/test_packaging.py`, `scripts/check_wheel.py` | wheel의 치아 형상·출처·정적 UI 누락·빈 파일 검사 |
| `tests/test_api.py` | UI 경로·승인→ZIP·잘못된 계획 ID·검토 재요청 경로 검사 |
| `tests/test_patients.py` | 환자 등록(식별정보 거부)→업로드→입력 확인→번호 확인 뒤에만 계획, 스캐너 좌표 정렬, 좌우 번호 경고·뒤집기, 번호 변경 뒤 이전 계획 차단, ID 비재사용, 삭제 시 파생물 제거, 입력 검증, 경로 ID 거부 |
| `tests/test_ui_flow.py`, `tests/fixtures/ui_flow.json` | 화면 순서 그대로: 환자 등록→번호 뒤집힌 스캔 업로드→입력 확인(뒤집기·revision)→활성화→규칙 폴백→조건 폼으로 `/chat/stream` 까지, 가짜 계획 모델로 키 없이 검사 (#49). 입력·기대값은 JSON 에서 읽음 |
| `tests/test_planning_flow.py`, `test_reviewer.py`, `test_plan_events.py` | 제약·부모·출력 내용·검토 실패·ASGI 요청 컨텍스트 회귀 |
| `tests/test_context_preload.py` | 서버 문맥에 미리 싣는 케이스 요약·한도·스킬이 설정대로 들어가고, 끄거나 블록이 없으면 전과 같은지(#48) |
| `tests/plan-stream.test.mjs`, `tests/browser_flow.py` | 스트림 파서·브라우저 선택/재계획/검토 재요청/승인·지연 응답 검사 |
| `tests/nim_review_live_check.py` | 실제 워크플로(NIM 검토·Guardrails)로 미실행·실패 계획의 검토 재요청 확인. 원격 사용량 발생 |
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
| `openshell/server-policy.yaml` | 서버 전체 샌드박스 정책(쓰기 `/sandbox`·`/tmp`, 네트워크는 NIM chat POST만) |
| `docs/openshell.md` | 정책 검증 수준, 서버 샌드박스 실행 절차와 기록 |
| `docs/nemoclaw.md`, `nemoclaw/` | NemoClaw 창구 연결: 구조, MCP 도구와 차단 정책, Caddy·등록 절차, OpenClaw 스킬 |
| `skills/cualign-clinical-rules/SKILL.md` | 도메인 규칙 검사 절차 |
| `skills/skillspector-report-static.md`, `skills/skillspector-report.md` | 당시 정적·의미 스캔 결과 |
| `scripts/scan_skill.py` | 위 스캔 재실행 스크립트 |
| `scripts/import_tooth_templates.py` | 형상 원본에서 템플릿을 준비한 변환 과정 |
| `docs/segmentation.md` | 선택적 분리 어댑터의 연결·미검증 상태 |
| `CONTRIBUTING.md` | 개발 환경·검증·기여 안내 |
| `SECURITY.md` | 보안 범위·데이터 취급 안내 |

## 웹 UI v2 (`src/cualign/server/static/v2/`)

2차 프로토타입 웹 인터페이스는 해시 기반 SPA 구조로 재설계되어 상단바(Topbar), 좌측 내비게이션(Rail), 주 화면(Screen)의 3분할 셸 위에 구축된다.

### 폴더 구조

- `index.html`: UI v2 엔트리포인트 HTML (셸 DOM 구성, importmap 정의, CSS 번들 링크)
- `styles/`: 디자인 시스템 토큰 및 화면·컴포넌트별 CSS 스타일시트
- `js/`: 애플리케이션 진입점 및 프론트엔드 모듈
  - `main.js`: 해시 라우터 구동, 셸(상단바·레일) 렌더링, 케이스 컨텍스트 동기화, 화면 수명주기 관리
  - `ui/`: 가상 DOM 없는 순수 DOM 생성 및 노드 조작 유틸리티 (`dom.js`)
  - `shell/`: 글로벌 레이아웃 컴포넌트(상단바 `topbar.js`, 좌측 내비게이션 `rail.js`, 라우트 파서 `router.js`)
  - `state/`: 중앙 반응형 상태 저장소(`store.js`) 및 URL 진입 복구용 컨텍스트 로더(`case-context.js`)
  - `api/`: 백엔드 REST 및 SSE 엔드포인트 비동기 통신 클라이언트(`endpoints.js`)
  - `domain/`: 치아 번호 체계 변환(`teeth.js`), 케이스/계획 상태 판정(`status.js`), 한글 공통 문구 사전(`vocab.js`, `vocab/*.js`)
  - `screens/`: 화면 단위 페이지 모듈
    - `cases/`: 케이스 목록 및 상태 필터링, 케이스 상세 서랍 패널
    - `intake/`: 가명 환자 생성 및 목록, 치아별 상악 스캔 STL 업로드, 스캔 정렬 확인 화면
    - `workspace/`: 치료 계획 작업대(계획 카드, 3D 뷰어, 에이전트 대화, 3탭 사이드바)
  - `viewer/`: Three.js 기반 3D 치열/잇몸 뷰어, 카메라 프리셋, 치료 단계 제어 막대, 2D 오버레이 툴팁
  - `agent/`: AI 어시스턴트 대화 패널, `/chat/stream` SSE 실시간 파싱 및 턴 관리

### 모듈별 책임

| 파일 | 목적·내용 |
|---|---|
| `index.html` | UI v2 셸 골격(상단바·레일·스크린 영역), Three.js importmap 로드, 스타일시트 링크 |
| `styles/tokens.css` | 색상, 간격, 타이포그래피, 반응형 브레이크포인트 CSS 변수 정의 |
| `styles/shell.css` | 셸 프레임워크(상단바, 좌측 레일, 메인 스크린) 기본 레이아웃 스타일 |
| `styles/cases.css` | 케이스 목록 그리드, 필터 칩, 검색 바, 우측 상세 서랍 패널 스타일 |
| `styles/intake.css` | 환자 목록, 신규 등록 폼, 치아별 스캔 드래그앤드롭 업로더 스타일 |
| `styles/check.css` | 스캔 정렬 점검, 치아 번호 확인 및 좌우 뒤집기 안내 화면 스타일 |
| `styles/workspace.css` | 작업대 3열 구조(좌측 계획·대화, 중앙 3D 뷰어, 우측 사이드바) 레이아웃 스타일 |
| `styles/viewer.css` | 3D 뷰어 캔버스, 시점 전환 툴바, 하단 치료 단계 제어 막대(stage-bar) 스타일 |
| `styles/agent.css` | AI 에이전트 대화 패널, 추론 과정 접기(thinking), 스트리밍 말풍선, 제안 카드 스타일 |
| `styles/sidebar.css` | 우측 사이드바 3탭(단계별 이동량 매트릭스, 임상 규칙 검사 위반, 치료 조건 폼) 스타일 |
| `js/main.js` | 해시 라우팅 디스패치, 셸 렌더링, 케이스 컨텍스트 복구, 화면 마운트/언마운트 조율 |
| `js/ui/dom.js` | 안전한 DOM 요소 생성 함수 `h()` 및 컨테이너 비우기 `clear()` |
| `js/shell/topbar.js` | 브랜드 표시, 현재 선택된 케이스/환자 라벨, 케이스 상태 배지 렌더링 |
| `js/shell/rail.js` | 좌측 진행 레일 내비게이션(케이스 목록, 인테이크, 확인, 작업대 바로가기 및 잠금 제어) |
| `js/shell/router.js` | 해시 URL 패턴 매칭(`matchRoutePattern`) 및 URL 파라미터 파싱 |
| `js/state/store.js` | 중앙 반응형 상태 컨테이너(`createStore`: `get`, `set`, `subscribe`) |
| `js/state/case-context.js` | URL 직접 진입 시 상단바 및 레일에 필요한 케이스/스캔 메타데이터 비동기 로딩 |
| `js/api/endpoints.js` | 백엔드 REST API 및 `/chat/stream` SSE 통신 래퍼, `ApiError` 정규화 |
| `js/domain/teeth.js` | FDI ↔ Universal 치아 번호 상호 변환 및 상악 기준 치아 목록 상수 |
| `js/domain/status.js` | 케이스 단계 판정(`caseStatus`), 추천 계획 선정(`preferredPlan`), 승인 가능 여부 검사(`canApprove`) |
| `js/domain/vocab.js` | 공통 한국어 UI 레이블 및 시스템 에러 메시지 사전 |
| `js/domain/vocab/*.js` | 화면별(cases, intake, check, workspace, viewer, agent, sidebar) 한국어 문구 사전 |
| `js/screens/cases/index.js` | 케이스 목록 화면 진입점, 목록 뷰와 상세 서랍 뷰의 결합 및 수명주기 관리 |
| `js/screens/cases/data.js` | 케이스/환자/계획 데이터 정규화, 검색 필터링, 정렬, 상태별 집계 순수 함수 |
| `js/screens/cases/list.js` | 케이스 카드 그리드 및 상태별 카운트 헤더 렌더링 |
| `js/screens/cases/filters.js` | 케이스 상태 필터 칩 및 검색 입력창 이벤트 제어 |
| `js/screens/cases/detail.js` | 선택된 케이스의 우측 상세 정보(환자 정보, 처방, 계획 요약, 작업대 이동) 렌더링 |
| `js/screens/intake/patient.js` | 환자 인테이크 메인 화면 조율, 목록과 등록/상세 패널 라우팅 연계 |
| `js/screens/intake/patient-list.js` | 좌측 환자 목록 패널 및 신규 환자 등록 인라인 폼 렌더링 |
| `js/screens/intake/patient-detail.js` | 선택된 환자의 스캔 이력 목록, 스캔 삭제, 업로드 컴포넌트 렌더링 |
| `js/screens/intake/upload.js` | 상악 치아별(2~15번) STL 파일 드래그앤드롭 업로드 인터페이스 |
| `js/screens/intake/upload-rules.js` | 스캔 파일 크기·개수·확장자 유효성 검증 규칙 및 바이트 포맷팅 |
| `js/screens/intake/check.js` | 업로드된 스캔의 정렬 상태·치아 번호 확인, 좌우 반전 스캔 미러링 및 최종 승인 뷰 |
| `js/screens/intake/check-model.js` | 스캔 점검 상태 도출, 좌표계/회전/수직 요약 문자열 포맷팅 순수 로직 |
| `js/screens/workspace/index.js` | 작업대 3열 레이아웃 통합 마운트, 3D 메시 로딩, 계획 선택 및 오류 폴백 처리 |
| `js/screens/workspace/plans.js` | 케이스에 생성된 계획 목록 패널 관리, 계획 선택 및 상세 데이터 동기화 |
| `js/screens/workspace/plan-card.js` | 개별 계획 카드(전략, 기간, 장수, 위반 배지, 승인/재계획/다운로드 액션) 렌더링 |
| `js/screens/workspace/sidebar/index.js` | 우측 사이드바 3탭(단계별 이동, 규칙 검사, 치료 조건) 전환 및 컨테이너 관리 |
| `js/screens/workspace/sidebar/staging.js` | 단계별 치아 이동량(근원심/협설/정출입/회전) 매트릭스 및 충돌 경고 표시 |
| `js/screens/workspace/sidebar/checks.js` | 임상 규칙 검사 위반 항목 목록화 및 위험도·치아별 그룹화 렌더링 |
| `js/screens/workspace/sidebar/conditions.js` | 치료 조건(한도, 발치 치아, IPR 허용) 폼 렌더링 및 조건 재계산 요청 |
| `js/screens/workspace/sidebar/conditions-model.js` | 조건 변경 diff 추출 및 기본 제약값 모델 |
| `js/screens/workspace/sidebar/plan-state.js` | 사이드바 렌더링을 위한 계획 ID 추출, 위반 수 계산, 활성 계획 보조 함수 |
| `js/screens/workspace/sidebar/violations.js` | 임상 위반 데이터의 치아쌍/개별치아/유형별 그룹화 순수 로직 |
| `js/viewer/index.js` | Three.js 캔버스 생성, 씬·오버레이·레이어 조율, 외부 제어 인터페이스(`createViewer`) 제공 |
| `js/viewer/scene.js` | Three.js Scene, 카메라, OrbitControls, 조명, 렌더링 루프 관리 |
| `js/viewer/teeth.js` | 치아별 STL 메시 로딩 및 단계별 피벗 기준 6자유도 변환 적용 |
| `js/viewer/layers.js` | 잇몸 가시성, 반투명 모드, 치아별 하이라이트/히트맵 레이어 상태 제어 |
| `js/viewer/views.js` | 전치부, 우측면, 좌측면, 교합면 등 정해진 시점으로 카메라 전환 애니메이션 |
| `js/viewer/stage-bar.js` | 단계 슬라이더, 자동 재생/일시정지 제어, 위반 단계 시각화 컴포넌트 |
| `js/viewer/stage-icons.js` | 단계 제어 바 내 재생/일시정지/초기화 SVG 아이콘 렌더링 |
| `js/viewer/overlay.js` | 치아 번호 라벨 및 위반 콜아웃 화면 오버레이 레이어 조율 |
| `js/viewer/overlay-dom.js` | 3D 월드 좌표를 2D 화면 DOM 좌표로 투영해 라벨 및 툴팁 렌더링 |
| `js/viewer/math.js` | 치아 좌표 보간, IPR 접촉면 계산, 단계별 위반 추출, 투영 순수 연산 |
| `js/agent/panel.js` | AI 어시스턴트 대화 패널 마운트, 메시지 스크롤 및 입력창 제어 |
| `js/agent/stream.js` | `/chat/stream` SSE 통신 연결 수명주기, 오류 처리, 턴 상태 갱신 |
| `js/agent/events.js` | SSE 스트림 이벤트 파싱 및 대화 턴 모델 변환 순수 함수 |
| `js/agent/view.js` | 사용자 메시지, 에이전트 추론 과정(Collapsible), 스트리밍 텍스트, 계획 제안 카드 DOM 렌더링 |

### 화면 라우트 표

| 라우트 패턴 | 화면 모듈 | 내비게이션 active / kind | 설명 |
|---|---|---|---|
| `#/cases` | `screens/cases/index.js` | `cases` / `none` | 전체 케이스(샘플 3건 + 등록 환자 스캔) 목록 및 상태 필터 화면 |
| `#/cases/:caseId` | `screens/cases/index.js` | `cases` / `none` | 케이스 목록 화면에서 특정 케이스의 우측 상세 정보 서랍이 열린 상태 |
| `#/patients/:pid` | `screens/intake/patient.js` | `intake` / `patient` | 환자 관리 화면 (`:pid`가 `'new'`인 경우 신규 등록 폼, ID 지정 시 스캔 이력 및 업로드) |
| `#/check/:caseId` | `screens/intake/check.js` | `check` / `patient` | 업로드된 스캔의 좌표계 정렬, 치아 번호 점검, 좌우 반전 확인 및 스캔 확정 |
| `#/workspace/:caseId` | `screens/workspace/index.js` | `workspace` / (`sample` \| `patient`) | 치료 계획 작업대 (계획 카드 목록, 3D 치열 뷰어, 에이전트 대화창, 우측 사이드바) |

### Store 상태 키

중앙 `store.js` 및 화면 수명주기에서 관리하는 주요 상태 키:

| 상태 키 | 타입 | 기본값 / 설명 |
|---|---|---|
| `cases` | `Array` | 케이스 목록 화면에 표시할 샘플 및 환자 케이스 항목 배열 |
| `patients` | `Array` | 등록된 가명 환자 및 하위 스캔 목록 배열 |
| `plans` | `Array` | 현재 케이스에 대해 계산된 치료 계획 요약 목록 |
| `caseId` | `string \| null` | 현재 활성화된 케이스 식별자 (`poseidon-000001`, `P0001-S1` 등) |
| `caseDisplayId` | `string \| null` | 상단바 및 레일에 표시되는 케이스 식별 라벨 |
| `caseTitle` | `string \| null` | 케이스 또는 환자 메모/제목 |
| `currentScan` | `object \| null` | 현재 환자 케이스의 스캔 메타데이터 및 확인 여부 (`confirmed`) |
| `currentCase` | `object \| null` | 현재 샘플 케이스의 메타데이터(처방, 비고 등) |
| `viewingPlanId` | `string \| null` | 현재 3D 뷰어와 사이드바에 표시 중인 계획 식별자 |
| `viewingPlan` | `object \| null` | `getPlan`으로 상세 조회된 현재 활성 계획 객체(단계별 변환 매트릭스, 위반 목록, `input_stale`) |
| `stageIndex` | `number` | 현재 3D 뷰어와 사이드바가 가리키는 치료 단계 인덱스 (`0..N`) |
| `railStage` | `string` | 좌측 레일 내비게이션에 반영할 계획 상태 (`none`, `calculated`, `approved`, `stale`) |
| `sidebarTab` | `string` | 우측 사이드바 활성 탭 (`stages`: 단계별 이동량, `checks`: 규칙 검사, `conditions`: 치료 조건) |
| `layers` | `object` | 3D 뷰어 레이어 가시성 토글 (`gum`, `labels`, `violations`, `heat`) |
| `chat` | `Array` | 에이전트 대화 메시지 턴 및 SSE 스트리밍 기록 배열 |

### 서버 API 대응 표

| 프론트엔드 함수 (`endpoints.js`) | HTTP 메소드 | 백엔드 엔드포인트 (`api.py` / `worker.py`) | 사용 화면 및 역할 |
|---|---|---|---|
| `listCases()` | `GET` | `/api/cases` | 케이스 목록(`cases`): 샘플 케이스 3건 메타데이터 및 초기 처방 조회 |
| `activateCase(caseId)` | `POST` | `/api/cases/{case_id}/activate` | 작업대(`workspace`): 케이스 활성화 및 조건 조회 |
| `caseMesh(caseId)` | `GET` | `/api/cases/{case_id}/mesh` | 작업대(`workspace`): 치아별 초기 3D 메시 로딩 |
| `caseCheck(caseId)` | `GET` | `/api/cases/{case_id}/check` | 입력 확인(`check`), 작업대: 스캔 정렬 및 치아 지원 여부 검사 |
| `uploadCase(files)` | `POST` | `/api/cases/upload` | 케이스 파일 업로드 (기존 v1 호환) |
| `listPatients()` | `GET` | `/api/patients` | 케이스 목록, 인테이크: 등록된 가명 환자 목록 조회 |
| `createPatient(alias, memo)` | `POST` | `/api/patients` | 인테이크(`patient`): 신규 가명 환자 생성 |
| `getPatient(pid)` | `GET` | `/api/patients/{pid}` | 인테이크(`patient`), 메인 셸: 환자 상세 및 스캔 이력 조회 |
| `deletePatient(pid)` | `DELETE` | `/api/patients/{pid}` | 인테이크(`patient`): 환자 및 연관 스캔/케이스 완전 삭제 |
| `uploadScan(pid, files)` | `POST` | `/api/patients/{pid}/scans` | 인테이크(`patient-detail`): 상악 치아별(2~15번) STL 스캔 업로드 |
| `confirmScan(pid, sid, revision)` | `POST` | `/api/patients/{pid}/scans/{sid}/confirm` | 입력 확인(`check`): 스캔 정렬 확인 및 확정 처리 |
| `mirrorScan(pid, sid)` | `POST` | `/api/patients/{pid}/scans/{sid}/mirror` | 입력 확인(`check`): 좌우 반전 스캔 번호 뒤집기(미러링) |
| `deleteScan(pid, sid)` | `DELETE` | `/api/patients/{pid}/scans/{sid}` | 인테이크(`patient-detail`): 특정 스캔 삭제 |
| `listPlans(caseId)` | `GET` | `/api/plans?case_id={caseId}` | 작업대(`plans`): 케이스별 치료 계획 요약 목록 조회 |
| `getPlan(id)` | `GET` | `/api/plans/{plan_id}` | 작업대(`workspace`): 계획 상세(단계별 좌표, 위반, staleness) 조회 |
| `approvePlan(id)` | `POST` | `/api/plans/{plan_id}/approval` | 작업대(`plan-card`): 임상 계획 승인 확정 (`confirmed: true`) |
| `revokeApproval(id)` | `DELETE` | `/api/plans/{plan_id}/approval` | 작업대(`plan-card`): 계획 승인 취소 |
| `requestReview(id)` | `POST` | `/api/plans/{plan_id}/review` | 작업대(`plan-card`): NIM 임상 검토 에이전트 재검토 요청 |
| `stlUrl(id)` | `GET` | `/api/plans/{plan_id}/stl.zip` | 작업대(`plan-card`): 승인된 계획의 단계별 모형 STL 압축 다운로드 |
| `rulePlan(body)` | `POST` | `/api/plan` | 작업대, 에이전트: 규칙 기반 치료 계획 계산 (폴백/수동 생성) |
| `chatStream(body, signal)` | `POST` | `/chat/stream` | 에이전트(`agent`): NIM 대화형 치료 계획 SSE 스트림 연결 |
| `nextFollowup(messages)` | `POST` | `/api/followup` | 에이전트(`agent`): 대화 맥락에 따른 추천 후속 질문 조회 |

### 테스트 위치

| 테스트 파일 | 구분 | 테스트 대상 및 내용 |
|---|---|---|
| `tests/v2/core.test.mjs` | 단위 (Node) | 치아 번호 체계 변환(FDI ↔ Universal), 케이스 상태 및 승인 가능 여부 판정, 공통 문구 |
| `tests/v2/cases.test.mjs` | 단위 (Node) | 케이스 목록 정규화, 상태/유형별 필터링, 정렬, 집계 통계 순수 로직 |
| `tests/v2/upload.test.mjs` | 단위 (Node) | 스캔 파일 크기·개수·확장자 유효성 검사, 치아 번호 매핑, 신규 환자 라우트 판정 |
| `tests/v2/check.test.mjs` | 단위 (Node) | 스캔 점검 상태 도출, 좌표계/회전/수직 정렬 요약 포맷팅, 확인 버튼 활성화 규칙 |
| `tests/v2/viewer.test.mjs` | 단위 (Node) | 치아 3D 위치 보간 연산, 단계별 위반 추출, 틱 위치, 카메라 프리셋, 히트맵 연산 |
| `tests/v2/plans.test.mjs` | 단위 (Node) | 치료 계획 정렬, 계획 카드 배지 상태, 레일 단계 판정, staleness 검사 |
| `tests/v2/sidebar.test.mjs` | 단위 (Node) | 임상 위반 그룹화, 치료 조건 diff 연산, 단계별 치아 이동량 매트릭스 계산 |
| `tests/v2/agent.test.mjs` | 단위 (Node) | SSE 스트림 이벤트 파서, 턴 상태 라이프사이클 전이, 대화 요청 페이로드 직렬화 |
| `tests/browser_flow_v2.py` | E2E (Playwright) | UI v2 전체 브라우저 사용자 흐름: 케이스 목록 탐색 → 환자 등록 → 스캔 업로드 → 스캔 확인 → 작업대 계획 선택 및 승인 |

