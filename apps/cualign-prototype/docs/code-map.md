# 코드·파일 안내

제품 범위는 [PRD](prd.md), 기술 구조·데이터 계약·한계는 [TRD](trd.md),
설치·실행은 [README](../README.ko.md), NVIDIA별 연결과 검증 수준은 [NVIDIA 활용](nvidia-stack.md)을 참조한다.
여러 세션이 워크트리로 나눠 동시에 고칠 때는 [병렬 세션 운영 방식](parallel-work.md)을 먼저 읽는다.

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
| `src/cualign/core/synth.py` | 환자 데이터 없이 재현하는 합성 케이스 생성. 테스트·에이전트 평가·CLI용이며 첫 화면에는 내놓지 않음 |
| `src/cualign/core/samples.py` | 첫 화면 샘플 3건(Poseidon3D 실제 상악 스캔)과 치과의사 처방. 처방을 케이스의 초기 계획 조건으로 넣음 |
| `src/cualign/core/samples/poseidon-*/` | 샘플 스캔(치아별 STL·잇몸·`SOURCE.txt`). `scripts/import_poseidon.py`로 만들었고 패키지에 포함 |
| `src/cualign/core/samples/ATTRIBUTION.md` | 샘플 스캔의 출처·라이선스(CC-BY-4.0)·변경 내용. 자산과 함께 보존 |
| `src/cualign/core/store.py` | 케이스·계획·부모·검토·승인 스냅샷 저장, 출력 시 승인 검사 |
| `src/cualign/core/recorded.py` | 샘플 케이스의 녹화된 에이전트 답(`samples/recorded/<case>/<step>.json`) 읽기·검사. 재생은 규칙 엔진으로 계획을 다시 계산하고 답의 단계 수·개월을 그 값으로 맞춤. 선택 필드 `reasoning` 은 실호출 턴의 추론 이벤트(000097 셋업) |
| `src/cualign/core/skills.py` | `workspace/skills/<이름>/SKILL.md`를 읽어 `load_skill` 도구로 에이전트에 전달 |
| `src/cualign/core/constraints.py` | 공통 조건 모델·명시적 패치·치아/한도 검증. 발치는 처방된 치아 목록(`extraction`, #56); `allow_extraction`은 계산값 |
| `src/cualign/core/service.py` | API·에이전트 공통 조건 보존 계산 경로 |
| `src/cualign/core/manual.py` | 직접 이동: 치아별 축(`frames`), 치료 전 위치의 출발 목표(`scan_start`), 손으로 옮긴 목표 만들기(`apply_edits`), 드래그 중 겹침·최소 단계 검사(`check`) |
| `src/cualign/core/patients.py` | 가명 환자·환자별 스캔 저장(로컬 `out/patients`), 재사용하지 않는 ID, 스캔 revision·확인 기록, 케이스 ID `P0001-S1` → 스캔 폴더 |
| `src/cualign/core/intake.py` | 업로드한 치아별 스캔을 코어 좌표계로 정렬(잇몸·치관 경계 기준, 원본은 `original/`), 좌우 번호 점검·뒤집기 |
| `src/cualign/core/gum.py` | 3D 표시용 잇몸 생성. 검증·출력 대상은 아님 |
| `src/cualign/core/gum_fill.py` | 뷰어용으로 스캔 잇몸의 치아 자리 홈을 덮은 잇몸(`/api/cases/{id}/gum`) |
| `src/cualign/core/print_model.py` | 단계별 프린트용 상악 모형: 스캔 잇몸 변형·높이 지도 합성·닫힌 메시 검사 |
| `src/cualign/core/templates/2.stl`~`15.stl` | 합성 치아와 뷰어에 쓰는 크라운 형상 14개 |
| `src/cualign/core/templates/ATTRIBUTION.md` | 위 형상 자산의 출처·라이선스 표기. 자산과 함께 보존 |
| `src/cualign/core/segmentation.py` | 외부 분리 모델 호출·라벨을 치아별 메시로 변환하는 선택적 어댑터 |
| `src/cualign/core/ipr_cut.py` | 처방된 접촉면만큼 치관 메시를 평면으로 깎은 치열(원본 스캔은 그대로). 목표·단계·충돌 검사·내보내기가 이 치열을 씀 |
| `src/cualign/core/fdi.py` | 화면 경계의 치아 번호 변환(코드·파일은 Universal, 의사는 FDI) |

### 에이전트·서버·UI

| 파일 | 목적·내용 |
|---|---|
| `src/cualign/agent/register.py` | 조건 수정·계산·최종 계획 선택·승인된 출력 도구. `context_preload` 설정(케이스 요약·한도·스킬을 서버 문맥에 미리 실음, #48)과 그 값을 만드는 `case_view`·`limits_view`·`context_preload` |
| `src/cualign/agent/context.py` | 요청별 케이스·조건·부모·후보·비교 여부·검토 예산 컨텍스트 |
| `src/cualign/agent/steps.py` | 턴의 단계(`setup`·`target`·`stages`)별로 쓸 수 있는 도구를 서버가 제한하고, 목표 배열 요약을 만듦 |
| `src/cualign/agent/reviewer.py` | 읽기 전용 검토, 시도/시간 상한, 실패 상태 저장, 의사 요청 재검토(`manual`), 저장 전 메모 출력 검사(`MEMO_CHECK`), 수치의 뜻을 알려주는 필드 설명(`FIELD_NOTES`) |
| `src/cualign/agent/followup.py` | 매 턴 뒤 화면 칩이 될 «다음에 정할 것» 질문·선택지 JSON을 경량 모델에서 만드는 지시문·파서(`POST /api/followup`, #90·#102). 워크플로·레일 밖이며 실패는 `None` |
| `src/cualign/agent/react_patch.py` | 특정 NAT 응답 파싱 실패를 처리하는 호환 가드. 스트림에서 플래너의 추론(`reasoning_content`·`<think>`)을 뽑아 턴의 추론 중계로 넘김 |
| `src/cualign/agent/react_history_patch.py` | NAT ReAct 네이티브 도구 호출 모드가 다음 프롬프트에서 빠뜨리는 «실제로 부른 도구·인자»를 기록에 붙이는 호환 가드(같은 도구 반복 방지) |
| `src/cualign/agent/nim_stream_patch.py` | NIM 스트림 첫 줄의 오류(과부하 503 등)와 스트림 요청의 HTTP 429·5xx 를 빈 답·즉시 실패 대신 재요청·예외로 바꾸고, 스트림이 아닌 호출(검토)의 429·5xx 를 짧게 재요청하는 호환 가드. 간격·코드·대체 모델은 `configs/workflow.yml` 의 `nim_retry` 에서 읽음(`NimRetryConfig`) |
| `src/cualign/agent/overload.py` | 실패가 NVIDIA API 과부하인지 판정하는 하나의 기준(서버의 화면 안내와 골든셋 A 의 «판정 불가» 가 같이 씀) |
| `configs/workflow.yml` | 계획·검토 에이전트, 모델, 도구 연결. 계획 에이전트 지시문은 `workspace/AGENTS.md` 를 `file://` 로 그대로 읽음 |
| `src/cualign/server/worker.py` | NAT 서버에 결과 API·UI·계획 이벤트 연결, 진행 표시를 도구 이름·인자·«완료» 로 줄임(워크플로 단계 제거·도구 결과 제거), 추론 이벤트는 `type: reasoning` 으로 보냄, 검토 재요청에 워크플로 reviewer 설정·모델 연결 |
| `src/cualign/server/plan_events.py` | 요청 컨텍스트 검증과 최종 SSE 계획 이벤트(과부하로 죽은 턴의 `plan_error` `kind`·안내 문장 포함), 에이전트가 건너뛴 검토의 서버 실행. `open_run` 이 서버 문맥 시스템 메시지를 만들고 `preload` 로 케이스 요약·한도·스킬을 덧붙임(#48) |
| `src/cualign/server/static/manual.js` | 직접 이동 화면: 3D 화살표·회전 고리, 「이동」 탭 숫자 표, 편집 막대(되돌리기·전부 되돌리기·적용), 서버 검사 표시, 모드를 끄면 저장 |
| `src/cualign/server/static/manual-rx.js` | 셋업 직접 이동의 우클릭 메뉴: 발치·IPR…(면·양 폼)·취소 → `POST …/setup/conditions`, 발치 치관 들림·페이드 |
| `src/cualign/server/static/plan-stream.js` | 분할된 UTF-8/SSE·NAT 오류 조립과 이벤트 식별 |
| `src/cualign/server/api.py` | 환자·스캔 업로드·입력 확인(`/check`)·계획 조회·규칙 폴백·검토 재요청·파일 다운로드 |
| `src/cualign/server/export_jobs.py` | 승인 순간부터 내보내기 ZIP(단계 STL·프린트 모형)을 백그라운드로 만들고 계획별로 보관 |
| `src/cualign/server/mcp_server.py` | NemoClaw용 MCP 서버(`/mcp`): 토큰 확인, `cualign_plan`은 서버 안에서 `/chat/stream`으로 요청해 UI와 같은 경로를 탐, 승인 도구는 승인하지 않고 내보내기 도구는 의사 승인을 요구 |
| `src/cualign/server/rails.py` | 대화 입력 범위 검사와 출력 검사(NeMo Guardrails 호출) |
| `src/cualign/server/rail_patterns.py` | 정규식 레일 목록(처방·확정 문구, 식별정보). import 없는 데이터. NeMo Guardrails 기능이 아닌 하네스 검사라 `core/`가 아니라 여기 둠(#79) |
| `src/cualign/server/rails_middleware.py` | 위 검사를 NAT 워크플로 미들웨어로 걸고, 그 전에 정규식 목록(요청의 식별정보·답의 처방 문구)을 보고, 답을 출력 판정까지 쥐었다가 거절문으로 바꾸고, 턴별 레일 상태를 남기고, 에이전트 예외를 종류만 남긴 오류로 바꿈. 답을 쥐는 동안 플래너의 추론은 문장·60자 단위, 1초에 한 번 이하로 진행 이벤트로 먼저 보냄(`ReasoningRelay`, 식별정보 조각은 버림). 검토 메모에도 같은 출력 검사를 제공. 레일이 꺼져 있어도, 선택한 계획이 규칙 검증에 실패했는데 답의 첫머리가 위반이 없다고 하면 그 구절을 실제 규칙 상태로 바꿈(비교 턴 제외, #91) |
| `src/cualign/keys.py` | NVIDIA 키 사용 가능 여부. OpenShell provider placeholder(`openshell:resolve:env:`)도 키로 인정해 샌드박스에서 Guardrails가 꺼지지 않게 함 |
| `src/cualign/sandbox_compat.py` | 샌드박스 프록시 변수가 있을 때만 aiohttp 세션이 프록시를 따르게 함(NIM 비동기 클라이언트) |
| `src/cualign/winjob.py` | Windows 에서 `serve` 가 끝나면 `nat serve` 도 끝나게 함(kill-on-close 잡, 띄운 `uv.exe`·셸 감시). 프로세스 목록에 python 이 둘씩 보이는 이유(venv 런처) |
| `src/cualign/server/static/index.html` | 케이스 선택, 대화, 3D 뷰어, 결과 영역의 화면 구조 |
| `src/cualign/server/static/app.js` | 진입점: 아래 모듈을 한 파일 시절 순서로 import(최상위 실행 순서 = 옛 app.js 순서), 뒤 모듈 함수를 앞 모듈에 넘기는 `wire`, 주소 라우팅(`route`·`setHash`·popstate), 직접 이동 생성(`setManualEdit`), `init`, `window.__cualign` |
| `src/cualign/server/static/state.js` | `state` 객체, FDI ↔ Universal, `api()`, 조건 폼 필드 읽기(`FIELD_READ`), IPR 접촉면 도우미, 라벨 표(`STRATEGY_KO`·`RULE_KO`·`REVIEW_KO`). 아무것도 import 하지 않음 |
| `src/cualign/server/static/viewer.js` | three.js 장면·카메라·조명·컨트롤·렌더 루프, 잇몸 변형, 치관·IPR 절삭 치관, 시점 버튼, 설계 흐름 단계 띠(`setStep`), `applyStage` |
| `src/cualign/server/static/pick.js` | 3D 포인터: 호버 툴팁, 클릭으로 치아 고르기, 단계 슬라이더 표식, 새 계획 유지/되돌리기, 3D 포커스 |
| `src/cualign/server/static/conditions.js` | 조건 폼 읽기·채우기·계획과 비교, 동작 버튼 상태(`updateActions`), 승인·검토 |
| `src/cualign/server/static/start.js` | 시작 화면·환자 흐름: 화면 전환, 열 너비 조절, 환자·스캔 업로드·입력 확인, 케이스 목록·상세 |
| `src/cualign/server/static/plans.js` | 레일, 케이스 열기(`activateCase`·`openCase`·`restoreProgress`·`loadMesh`), 계획 목록·`loadPlan` |
| `src/cualign/server/static/chat.js` | 대화 기록: 메시지·마크다운, 검토 질문, 추론 줄, 도구 줄(원문·인자·소요 시간은 「자세히」) |
| `src/cualign/server/static/turns.js` | 에이전트 턴: 다음 단계 칩, `send` 와 스트림(과부하 실패 뒤 «다시 보내기»), 단계 착지, 녹화 재생, 규칙 폴백, 단계 재생 |
| `src/cualign/server/static/controls.js` | 대화 입력·머리·3D 조작의 이벤트 리스너(옛 app.js 「wiring」 절) |
| `src/cualign/server/static/panes.js` | 화면의 계획: 결과·범례, 단계·규칙·조건 탭, 탭 전환, 스캔 탭 치아 도표 |
| `src/cualign/server/static/export.js` | 내보내기 팝오버, 토스트, STL 빌드 폴링·다운로드 |
| `src/cualign/server/static/validate-sweep.js` | 규칙 검증 도구 연출: 도구 시작에 치아를 치열 순서로 60ms씩 왕복해 옅게 밝힘(도구 이벤트에 치아가 없어 연출), 끝에 계획의 실제 `violations` — 없으면 전체 초록 한 번, 있으면 위반 치아 붉게. 선택 강조의 발광(emissive)을 매 프레임 덮어쓰고 재질은 새로 만들지 않음. `app.js` 의 `toolMoment` 가 훅 |
| `src/cualign/server/static/scan-reveal.js` | 셋업 턴 연출: 대화창에 에이전트의 첫 줄(추론·도구 줄·답, 없으면 8초 뒤)이 붙는 순간 `startNumbers` 치아 번호 순회(17→27, 0.1초), 「처방을 읽었습니다」 줄이 붙는 순간 `applyPrescription` 발치 치아가 화면 위쪽으로 들리며 0.6초에 페이드(끝나면 `extracted` → 셋업 착지)·「발치」 표식·IPR 도구 커서(커서가 지난 치관부터 절삭, `cutShown`), 단계 재생이 처음 1단계에 닿을 때 IPR 커서 한 번. `app.js` 는 훅만 부름, `?nofx=1` 로 끔 |
| `src/cualign/server/static/scan-reveal.js` | 셋업 턴 연출: 전송 즉시 `startNumbers` 치아 번호 순회(17→27, 0.1초), 대화창에 「처방을 읽었습니다」 줄이 붙는 순간 `applyPrescription` 발치 치아 들림/페이드·「발치」 표식·IPR 도구 커서(커서가 지난 치관부터 절삭, `cutShown`), 단계 재생이 처음 1단계에 닿을 때 IPR 커서 한 번. `app.js` 는 훅만 부름, `?nofx=1` 로 끔 |
| `src/cualign/server/static/stage-grow.js` | 계획을 만드는 도구(`plan_stages`·`compare_strategies`) 연출 「단계가 자라난다」: 목표 배열 흰 고스트, 이동 순서대로 치아를 짚는 커서(`scan-reveal.js` 의 `CURSOR_SVG`)와 한 칸 미끄러짐, 계획이 오면 단계 표가 같은 리듬으로 채워지고 칩이 「단계 나누는 중 · k/N」, 계획이 화면에 오고 표가 다 찰 때까지(뒤따르는 `select_plan` 은 착지시키지 않음, 같은 턴의 `validate` 만 앞당김) 이어지다가 마지막 단계로 착지하며 슬라이더 끝·▶ 깜박임·「▶ 처음부터 재생」. 재생은 한 바퀴(약 8초) 뒤 착지(Esc·칩 클릭으로 즉시). `app.js` 는 도구 줄 훅·재생 착지 한 줄·렌더 루프 `tick` 만, `?nofx=1`·동작 줄이기면 끔 |
| `src/cualign/server/static/stage-grow.js` | 단계 도구(`plan_stages`) 연출 「단계가 자라난다」: 목표 배열 흰 고스트, 이동 순서대로 치아를 짚는 커서(`scan-reveal.js` 의 `CURSOR_SVG`)와 한 칸 미끄러짐, 계획이 오면 단계 표가 같은 리듬으로 채워지고 칩이 「단계 나누는 중 · k/N」, 착지에서 0단계로 돌아가며 슬라이더 0·▶ 깜박임. 재생은 한 바퀴(약 8초) 뒤 착지(Esc·칩 클릭으로 즉시). `app.js` 는 도구 줄 훅·재생 착지 한 줄·렌더 루프 `tick` 만, `?nofx=1`·동작 줄이기면 끔 |
| `src/cualign/server/static/target-reveal.js` | 목표 도구(`propose_target`) 연출 「치열궁을 따라 자리 잡는다」: 앞니 가운데서 양끝으로 초록 치열궁 선(0.6초, 결과 전엔 지금 치아 중심을 매끈하게 한 추정 곡선 → 착지에서 결과 곡선), 이동량 큰 치아부터(발치 옆 치아 먼저) 커서가 짚으면 0.35초에 목표로(한 바퀴 6초), 셋업 위치는 고스트로 남았다 착지에서 걷힘, 칩 「목표 배열 계산 중 · 확보 공간 x / 총생 mm」. 실 턴은 결과 착지(`step_done` target)에서 남은 치아 0.4초에 착지, 재생은 6초 뒤 착지(Esc·칩 클릭으로 즉시). `app.js` 는 생성 한 줄뿐 — 도구 줄(`#transcript .step.tool[data-tool=propose_target]`)과 `state.targetId`·`state.step` 을 스스로 보고, `scene.onBeforeRender` 에서 그림. `?nofx=1`·동작 줄이기면 끔 |
| `src/cualign/server/static/three-load.js` | three.js CDN 로드. 실패(오프라인)면 모든 호출을 받아 넘기는 대역을 내주고 `app.js` 가 3D 자리에 「3D 를 그릴 수 없습니다」 카드를 띄운다(WebGL 없음도 같은 카드) |
| `src/cualign/server/static/drawers.js` | ≤1280 사이드바·≤1024 대화 패널 서랍 열고 닫기(경계 손잡이 클릭·Enter, 3D 누름·Esc 로 닫기). 폭 규칙은 `style.css` 끝 「반응형」 절 |
| `src/cualign/server/static/style.css` | 현재 PoC의 레이아웃·색·표시 스타일 |
| `src/cualign/server/static/icons/`, `samples/`, `*.png` | 3D 시점 아이콘, 시작 화면 샘플 미리보기, 로고·파비콘 |
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
| `tests/test_rails_middleware.py`, `tests/rails_fakes.py` | 가짜 레일·가짜 모델로 전 경로 차단·오류 기록·멈춤 스위치·정규식 레일·출력 보류·진행 표시·추론 이벤트·예외 문구·검토 건너뛴 턴·메모 레일·과부하 안내 이벤트 검사 |
| `tests/test_rail_patterns.py` | 정규식 목록이 걸려야 할 문장·넘겨야 할 문장·스킬 본문 검사 |
| `tests/test_skill_tool.py` | Skill 이름 검증·도구 등록(검토 에이전트 제외)·지시문 연결 검사 |
| `tests/test_winjob.py` | Windows 전용: `serve` 대역을 죽이거나 띄운 프로세스가 사라지면 그 자식(`nat serve` 대역)도 끝나는지 실제 프로세스로 검사 |
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
| `tests/test_rule_status.py` | 실패한 계획을 «규칙 위반은 없습니다» 로 연 답이 실제 상태로 바뀌어 나가는지(레일 켬·끔, UI 스트림·골든셋 실행기), 통과한 계획·계획 없는 답·비교 답은 그대로인지, `core/planner.py` 의 모든 위반 종류에 지시문과 같은 한국어 이름이 있는지(#91) |
| `tests/test_context_preload.py` | 서버 문맥에 미리 싣는 케이스 요약·한도·스킬이 설정대로 들어가고, 끄거나 블록이 없으면 전과 같은지(#48) |
| `tests/plan-stream.test.mjs`, `tests/browser_flow.py` | 스트림 파서·브라우저 선택/재계획/검토 재요청/승인·지연 응답 검사 |
| `tests/nim_review_live_check.py` | 실제 워크플로(NIM 검토·Guardrails)로 미실행·실패 계획의 검토 재요청 확인. 원격 사용량 발생 |
| `docs/verification.md` | 새 환경 재현 결과와 미검증 범위 |
| `docs/development.md`, `docs/roadmap.md` | 개발 진입점과 네 기능 작업·검증 범위 |
| `docs/known-issues.md` | reviewer 오류의 관측·재현 조건·영향과 인수 시 주의점 |
| `docs/design-references.md` | 기존 UI·형상 조사에서 계승한 설계 관찰과 출처 |
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
| `docs/nemoclaw.md`, `nemoclaw/` | NemoClaw 창구 연결: 구조, MCP 도구와 차단 정책, Caddy·등록 절차 |
| `workspace/` | 에이전트 정의의 유일한 원천(OpenClaw 워크스페이스 규약). 파일별 독자·독자 과제는 `workspace/README.md` |
| `workspace/skills/cualign-clinical-rules/SKILL.md` | 도메인 규칙 검사 절차 |
| `workspace/skills/cualign-planner/SKILL.md` | OpenClaw 창구 스킬(NemoClaw) |
| `workspace/skills/skillspector-report-static.md`, `workspace/skills/skillspector-report.md` | 당시 정적·의미 스캔 결과 |
| `scripts/scan_skill.py` | 위 스캔 재실행 스크립트 |
| `scripts/import_tooth_templates.py` | 형상 원본에서 템플릿을 준비한 변환 과정 |
| `docs/segmentation.md` | 선택적 분리 어댑터의 연결·미검증 상태 |
| `CONTRIBUTING.md` | 개발 환경·검증·기여 안내 |
| `SECURITY.md` | 보안 범위·데이터 취급 안내 |
