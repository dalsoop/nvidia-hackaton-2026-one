# 화면↔에이전트 계약 (초안)

> 상태: **제안. 팀 결정 필요.** 2026-09-24 작성. 구조 배경은 [MONOREPO.md](MONOREPO.md).
> 표기: **확정** = PRD 또는 팀 문서(Drive 1팀/docs `TEAM_CUALIGN_SCOPE.md`)에 근거 · **제안** = 이 문서의 설계 · **미정** = PRD §7 등 팀 결정 전.

## 1. 목적

화면(Electron)이 **대화 텍스트를 파싱하지 않고** 계획·검증·파일 상태를 받게 한다.
현재 UI는 스트림 텍스트에서 `plan_id`를 정규식으로 뽑는다(`static/app.js` `PLAN_RE`). 이 계약은 그 자리를 구조화된 이벤트로 바꾼다.
원본은 `packages/contract/schema/*.json`(JSON Schema)이며 TS 타입과 pydantic 모델은 생성한다.

## 2. 엔터티

공통: 모든 객체에 `contract_version`(예: `"0.1"`)을 둔다. 길이 단위는 mm, 각도는 도, 좌표계는 케이스별 `frame`을 따른다.

### Case

| 필드 | 타입 | 상태 | 비고 |
|---|---|---|---|
| `case_id` | string | 현재 있음 | |
| `jaws` | `["upper"]` \| `["upper","lower"]` | **확정**(팀 문서: 상·하악) | 현재 코드는 상악만 |
| `teeth` | `{id:int, jaw, numbering}` 배열 | 제안 | `numbering`: `universal` \| `fdi`. 현재 내부는 Universal |
| `units` | `"mm"` | 제안 | |
| `frame` | `{origin, occlusal_plane, source}` | 제안 | 상·하악 정합 여부 `registered: bool` 포함 |
| `crowding_mm` | number | 현재 있음 | `load_case` 결과 |
| `source` | `synthetic` \| `upload` \| `scan` | 제안 | 현재는 `list_cases()` 행의 `kind`(`synthetic`·`stl-folder`·`loaded`)뿐이고 `load_case` 결과에는 없음. `kind`→`source` 변환 규칙을 정해야 함 |

### Constraints (공통 제약 객체)

| 필드 | 타입 | 상태 | 비고 |
|---|---|---|---|
| `allow_extraction` | bool \| null | **확정**(PRD 조건 확인) | null = 아직 모름 → 되묻기 |
| `months` / `stage_cap` | int \| null | **확정** | `stage_cap = round(months*30.4/7)` |
| `order` | `simultaneous` \| `anterior_first` \| `sequential` | 현재 있음 | |
| `lock` | int[] | 현재 있음 | |
| `ipr_exclude` | int[] | 현재 있음 | |
| `provenance.<필드>` | `{set_by: dentist\|agent_default, turn, confirmed_by_dentist: bool}` | **확정**(팀 문서: 조건 변경은 의사 확인) · 형식은 제안 | 에이전트는 `confirmed_by_dentist=false`인 변경을 계산에 쓰지 않는다 |
| `constraints_id` | string | 제안 | 수정마다 새 id, 이전 id 보존 |

### Target · Plan · Stage

| 객체 | 필드 | 상태 |
|---|---|---|
| Target | `target_id`, `case_id`, `strategy`, `constraints_id`, `space_gain_mm`, `space_deficit_mm`, `removed[]`, `locked[]`, `notes[]` | 현재 `propose_target` 결과에 대부분 있음. `constraints_id` 제안 |
| Plan | `plan_id`, `parent_plan_id`, `case_id`, `target_id`, `strategy`, `order`, `n_stages`, `months`, `constraints` (스냅샷) | `parent_plan_id`·스냅샷은 제안(수정 계보) |
| Plan.`status` | `draft` \| `rule_passed` \| `rule_failed` \| `error` | 제안. 현재는 `passed: bool`뿐 |
| Plan.`dentist_review` | `not_reviewed` \| `reviewing` \| `selected` | **확정**: 규칙 통과 ≠ 임상 승인, 자동 승인 표시 금지. 값 목록·승인 UI는 **미정**(PRD §7 검토 확정) |
| Stage | `index`, `moves: {tooth_id: [dx,dy,dz]}`, (예정) `rotations` | 현재 `plan_json.stages`. 평행 이동만 |

### Violation · ReviewMemo · Export

| 객체 | 필드 | 상태 |
|---|---|---|
| Violation | `type` (`space_deficit`\|`collision`\|`move_limit`\|`stage_cap`), `stage` (int\|null), `teeth[]`, `value`, `limit`, `unit` | 현재 필드명 제각각(`mm`·`overlap_mm3`·`n`) → `value`/`unit`으로 통일 제안 |
| ReviewMemo | `plan_id`, `status` (`ok`\|`failed`), `text` (ok일 때만), `error` | **확정**: 계획 성공과 메모 성공 구분(KNOWN_ISSUES). 형식은 제안 |
| Export | `plan_id`, `kind` (`per_tooth_stl`\|`full_arch_model`), `n_files`, `per_stage: bool`, `url` | **확정**: 결과물은 단계별 전체 치열 모델(팀 문서). 현재 구현은 `per_tooth_stl`만. 실패안 내보내기 허용은 **미정**(PRD §7) |

## 3. 대화 이벤트 스트림

전송: SSE(`POST /v1/turns` → `text/event-stream`) 제안. 양방향 확인이 필요하면 WebSocket. 기존 NAT `/chat/stream`은 이전 기간 동안 유지.
모든 이벤트: `{contract_version, session_id, turn_id, seq, type, ts, data}`.

| type | data | 화면 동작 |
|---|---|---|
| `turn_started` | `{user_text, constraints}` | 입력 잠금 |
| `question` | `{text, needs_answer: true, topics: ["extraction","duration"]}` | 답변 입력 요청. 이 턴은 계획 없음 |
| `tool_call` | `{call_id, agent: planner\|reviewer, name, args}` | 진행 표시(펼치기) |
| `tool_result` | `{call_id, ok, result \| error, retry_of?}` | 진행 표시. 재시도는 `retry_of`로 묶음 |
| `plan_created` | `Plan` | 3D 뷰어·계획 목록 갱신 |
| `validation_result` | `{plan_id, status, violations[]}` | 위반 치아·단계 강조 |
| `condition_change_proposed` | `{field, from, to, reason, requires_confirmation: true}` | 확인 버튼. 확인 전 계산에 반영 금지 (**확정** 원칙, UI 형식 **미정**) |
| `review_memo` | `ReviewMemo` | 메모 패널. `failed`면 실패 표시 |
| `export_ready` | `Export` | 다운로드 버튼. `kind`를 그대로 표기 |
| `error` | `{code, message, recoverable}` | 시스템 오류 표시(규칙 실패와 구분) |
| `turn_finished` | `{answer_text, presented_plan_id \| null}` | 최종 답변 표시. 화면은 `presented_plan_id`로 선택 |

### 예: "moderate 케이스로. 발치 없이 12개월 안에, 앞니 먼저."

```json
{"seq":1,"type":"turn_started","data":{"user_text":"moderate 케이스로. 발치 없이 12개월 안에, 앞니 먼저.","constraints":{"allow_extraction":false,"months":12,"stage_cap":52,"order":"anterior_first","lock":[],"ipr_exclude":[]}}}
{"seq":2,"type":"tool_call","data":{"call_id":"c1","agent":"planner","name":"load_case","args":{"case_id":"moderate"}}}
{"seq":3,"type":"tool_result","data":{"call_id":"c1","ok":true,"result":{"case_id":"moderate","crowding_mm":4.3}}}
{"seq":4,"type":"tool_call","data":{"call_id":"c2","agent":"planner","name":"propose_target","args":{"strategy":"expansion","lock":[],"ipr_exclude":[]}}}
{"seq":5,"type":"tool_result","data":{"call_id":"c2","ok":true,"result":{"target_id":"t1","space_deficit_mm":1.6}}}
{"seq":6,"type":"plan_created","data":{"plan_id":"p1","parent_plan_id":null,"strategy":"expansion","n_stages":10,"months":2.3,"status":"draft","dentist_review":"not_reviewed"}}
{"seq":7,"type":"validation_result","data":{"plan_id":"p1","status":"rule_failed","violations":[{"type":"space_deficit","stage":null,"teeth":[],"value":1.6,"limit":0.5,"unit":"mm"}]}}
{"seq":8,"type":"plan_created","data":{"plan_id":"p3","parent_plan_id":null,"strategy":"expansion_ipr","n_stages":7,"months":1.6,"status":"draft","dentist_review":"not_reviewed"}}
{"seq":9,"type":"validation_result","data":{"plan_id":"p3","status":"rule_passed","violations":[]}}
{"seq":10,"type":"tool_call","data":{"call_id":"c9","agent":"planner","name":"reviewer","args":{"plan_id":"p3"}}}
{"seq":11,"type":"review_memo","data":{"plan_id":"p3","status":"ok","text":"1) 한 줄 요약: …"}}
{"seq":12,"type":"turn_finished","data":{"answer_text":"전략: expansion_ipr · 총 7장 · …","presented_plan_id":"p3"}}
```

(축약 예시: 모든 이벤트의 공통 필드 `contract_version`·`session_id`·`turn_id`·`ts`와 `ipr` 시도 p2, reviewer 호출(c9)의 `tool_result`, reviewer 내부 `get_plan` 호출은 생략했다. 수치는 형식 예시.)

## 4. 골든셋과의 연결

골든셋 A의 `Trace`(`evals/golden_a/trace.py`)는 이 스트림에서 **그대로 만들어져야** 한다. 그러면 로그 파싱 없이 실제 앱을 채점한다.

| Trace | 이벤트 |
|---|---|
| `Turn.user` | `turn_started.user_text` |
| `ToolCall(name,args,agent)` | `tool_call` |
| `ToolCall.result` / `.error` | 같은 `call_id`의 `tool_result`. `retry_of`가 있는 결과는 새 호출이 아니라 `Turn.errors`의 재시도 기록 |
| 계획 등록부(판정기 `plan_registry`) | `plan_created`·`validation_result`. 지금은 `plan_stages`·`validate` 도구 결과에서 복원하므로, 이 두 이벤트는 해당 `tool_result`와 같은 값을 담아야 한다 |
| `Turn.answer` | `turn_finished.answer_text` |
| 제시한 계획 | `turn_finished.presented_plan_id` (지금은 답변 텍스트에서 추정) |
| `Turn.errors` | `error` |
| `Turn.parse_retries` | `error{code:"parse_retry"}` 개수 |
| 메모 성공/실패 | `review_memo.status` |
| 내보내기 종류 | `export_ready.kind` |

`presented_plan_id`·`review_memo.status`·`export_ready.kind`가 생기면 골든셋의 텍스트 추정 검사(`_presented_plan`, `REVIEW_FAIL_RE`, `EXPORT_*_RE`)를 구조 검사로 바꿀 수 있다.

## 5. 버전 규칙

- `contract_version`은 `major.minor`. 필드 **추가**는 minor, 이름 변경·삭제·의미 변경은 major.
- 받는 쪽은 모르는 필드를 무시한다. 모르는 `type` 이벤트는 로그만 남긴다.
- 스키마 변경 PR은 화면·에이전트 양쪽 리뷰 필수(MONOREPO §4), 예제 JSON과 골든셋 어댑터를 같이 갱신한다.

## 6. 현재 코드의 간격과 이 계약이 닫는 것

| KNOWN_ISSUES·TRD 항목 | 현재 | 계약 |
|---|---|---|
| 계획과 화면 연결 | UI가 텍스트에서 `plan_id` 추출 | `plan_created`·`turn_finished.presented_plan_id` |
| 비교·수정의 조건 유지 | 공통 제약 객체 없음, 조건은 지시문·대화 기록 의존 | `Constraints` + `constraints_id`, 모든 도구가 같은 객체를 받음 |
| 비교가 고정·IPR 제외를 못 받음 | `compare_strategies(allowed, stage_cap, order)` | 비교도 `Constraints`를 받게 도구 입력 변경 필요 |
| 수정 계보 없음 | `plan_id` 순번만 | `parent_plan_id` |
| reviewer 실패가 종료 코드 0에 묻힘 | 텍스트로만 드러남 | `review_memo.status=failed`, `error` 이벤트 |
| 규칙 통과와 의사 검토 혼동 | `passed` 하나 | `status`와 `dentist_review` 분리 |
| 출력물 종류 모호 | ZIP 이름만 | `export_ready.kind` (`per_tooth_stl`/`full_arch_model`) |
| 사용자·케이스 격리 | 프로세스 전역 `STORE` | `session_id` 필드만 예약. 격리 구현은 범위 밖 |

## 7. 미정 (팀 결정 필요)

| 항목 | 출처 |
|---|---|
| 비교를 처음부터 제시할지, 요청 시만 할지 | PRD §7 |
| 조건 변경 확인 UI(버튼·대화 답변) | PRD §7, 팀 문서는 "의사 확인"만 확정 |
| `dentist_review` 값과 승인 단계를 예선에 둘지 | PRD §7 |
| 실패안 내보내기 허용 | PRD §7 |
| 하악·교합 정합 입력 형식 | 팀 문서(상·하악) vs 현재 상악 전용 |
| `full_arch_model`의 잇몸·받침 형상과 파일 단위(단계당 1파일, 악궁별 분리 여부) | 팀 문서 "출력용 모델" |
