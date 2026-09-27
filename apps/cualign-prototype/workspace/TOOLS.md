# TOOLS — 도구 사용 메모

도구는 두 곳에 있다. 이 표는 색인이다. 모델이 실제로 받는 도구 설명은 코드의 docstring이다.
NAT 도구는 `src/cualign/agent/register.py`, MCP 도구는 `src/cualign/server/mcp_server.py`에 있다.

## 계획 에이전트(NAT) — 함수 그룹 `cualign`, 이름 앞에 `cualign__`

| 도구 | 언제 · 주의 |
|---|---|
| `get_constraints` | 확정 조건을 읽는다. 서버 문맥에 조건이 있으면 부르지 않는다. |
| `set_constraints` | 이번 요청에서 명시적으로 바꾼 필드만 보낸다. null과 생략은 유지, `[]`는 치아 목록 해제, `clear_stage_cap: true`는 상한 해제. 목표를 만든 뒤에는 거절된다. |
| `clinical_limits` | PoC 계산 한계와 단위. 서버 문맥에 `limits`가 있으면 부르지 않는다. |
| `list_cases`, `load_case` | 케이스 목록과 화면에서 고른 케이스. 서버 문맥에 `case`가 있으면 `load_case`를 부르지 않는다. 케이스를 임의로 바꾸지 않는다. |
| `load_skill` | `cualign-clinical-rules` 지시문. 서버 문맥에 `skill`이 있으면 부르지 않는다. |
| `propose_target` → `plan_stages` | 조건을 정한 뒤 전략별 목표를 만들고 단계를 만든다. `plan_stages`가 검증까지 한다. |
| `validate` | 이미 있는 계획을 다시 확인할 때만 쓴다. |
| `compare_strategies` | 의사가 비교를 요청했을 때만 쓴다. 확정 조건을 모두 유지한다. |
| `select_plan` | 최종 후보를 한 번 고른다. 그다음 `reviewer`를 부른다. |
| `get_plan` | 읽기 전용 조회. |
| `export_stl` | 의사가 화면에서 승인한 계획만 내보낸다. 에이전트는 승인할 수 없다. |
| `reviewer` | 고른 계획에 한 번만 부른다. 최대 2회 시도, 40초 제한. 실패하면 "검토 실패"로 보고한다. 검토 에이전트는 읽기 전용 그룹 `cualign_ro`(`clinical_limits`, `get_plan`)만 쓴다. |

호출 순서와 예시 인자는 `skills/cualign-clinical-rules/SKILL.md`의 Tool sequence 절에 있다.

## 창구(OpenClaw) — MCP 서버 `cualign`

| 도구 | 언제 · 주의 |
|---|---|
| `cualign_list_cases` | 의사가 케이스를 말하지 않았을 때 먼저 부른다. |
| `cualign_plan` | 계획을 만들거나 고칠 때 요청당 한 번 부른다. 서버는 UI와 같은 경로(`/chat/stream`)로 계획 에이전트를 부른다. |
| `cualign_get_plan` | 이미 있는 계획을 물을 때 부른다. |
| `cualign_approve_plan`, `cualign_export_stl` | 부르지 않는다. 샌드박스 정책(`--deny-tool`)이 둘 다 막는다. |

절차와 보고 형식은 `skills/cualign-planner/SKILL.md`에 있다.

<!-- 출처: src/cualign/agent/register.py(도구 docstring); configs/workflow.yml(functions.reviewer, function_groups.cualign_ro);
workspace/skills/cualign-clinical-rules/SKILL.md(Tool sequence); workspace/skills/cualign-planner/SKILL.md(Tools);
docs/nemoclaw.md(MCP 도구와 차단 정책). -->
