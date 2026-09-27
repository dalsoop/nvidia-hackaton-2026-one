<!-- source: README.md sha256: 09e7059c97eaa584193ff7937b919b097572a604b6649ebac839fb70ad179d9f -->
# cuAlign 에이전트 워크스페이스

cuAlign 에이전트의 정의는 이 폴더 한곳에 있습니다. 폴더 구성은 NVIDIA DLI NemoClaw 과정 03b(OpenClaw)의 `.openclaw/workspace/` 규약을 따릅니다. 이 폴더를 읽는 에이전트는 둘이고, 에이전트마다 읽는 파일이 다릅니다.

원본은 영어 파일입니다. 이 문서는 [README.md](README.md)의 한국어 번역이며, 둘이 다르면 영어 원본이 맞습니다.

## 독자

| 문서 | 독자 | 독자 과제 | 독자 시험 |
|---|---|---|---|
| `AGENTS.md` | cuAlign 서버 안의 NAT 계획 에이전트 | 이번 요청의 조건으로 계획 초안을 만들고 정해진 답변 형식으로 보고한다 | 이 바이트로 골든셋 #73 |
| `skills/cualign-clinical-rules/` | NAT 계획 에이전트 | 도구 순서 안에서 임상 한계와 전략 규칙을 적용한다 | 골든셋 #73 |
| `SOUL.md` | OpenClaw 창구(`cualign-desk`) | 승인 요청에는 글로만 답하고, 다른 요청에는 창구 스킬을 따르고, 페르소나 파일을 바꾸지 않는다 | 통과, 2026-09-27: 승인 요청 3번 모두 `cualign_*` 호출 없고 새 계획 없음. 규칙 1을 빼면 3번 모두 `cualign_*` 도구를 부름 |
| `IDENTITY.md` | OpenClaw 창구 | 자기를 cuAlign 창구라고 소개한다 | 아직 안 함: 이름을 묻는 시험 문구가 없음 |
| `USER.md` | OpenClaw 창구 | 의사의 조건을 결정으로 넘기고, 치아 번호와 케이스 id를 받아들인다 | 아직 안 함: 조건을 주는 시험 문구가 없음 |
| `TOOLS.md` | OpenClaw 창구 | 도구마다 언제 부르는지 적힌 스킬을 찾는다 | 통과, 2026-09-27: 케이스 목록 요청 3번 모두 `cualign_list_cases` 1번 |
| `HEARTBEAT.md` | OpenClaw 하트비트 | 예약된 모델 호출을 건너뛴다 | 실행 안 함. 주석만 있는 OpenClaw 기본 파일과 바이트가 같은지 `tests/test_workspace.py`가 확인 |
| `MEMORY.md` | OpenClaw 창구 | 기억을 남기지 않고, 환자 식별 정보를 쓰지 않는다 | 일부, 2026-09-27: 15번 실행 뒤 `memory/` 폴더 없고 `MEMORY.md` 그대로. 환자 식별 정보를 준 실행은 없음 |
| `desk/AGENTS.md` | OpenClaw 창구(`AGENTS.md`로 설치) | 다른 창구 파일과 스킬을 따르고, 조건은 세션 안에만 두고, 메시지가 올 때만 움직인다 | 아직 안 함: Brev 인스턴스가 멈춰 있어 아직 설치하지 않음 |
| `skills/cualign-planner/` | OpenClaw 창구 | 요청마다 `cualign_plan`을 한 번 부르고 결과를 한국어로 보고한다 | 통과, 2026-09-27: 계획 요청 3번 모두 `cualign_plan` 1번, `ui_url` 있음. 조건을 한 번 묻고 답을 받은 뒤 그 호출을 해도 통과 |
| `README.md` | 관리자 | 어느 에이전트가 어느 파일을 읽는지, 도구와 경계의 정본이 어디인지 찾고, 창구 파일을 설치한다 | 아직 안 함: 관리자 세션을 아직 돌리지 않음 |

독자 시험은 다른 맥락이 없는 새 세션에서 여러 번 돌립니다. 시험 문구와 실행마다의 결과는 `docs/nemoclaw.md`에 있습니다. 근거는 https://github.com/dalsoop/stable-agent-documentation-guidebook 의 R-004와 `guides/new-project.md` §1입니다.

## `AGENTS.md`는 고정된 프롬프트입니다

`AGENTS.md`는 NAT 계획 에이전트의 프롬프트이고, 바이트가 고정되어 있습니다. 저장소 맥락 파일의 템플릿이 아닙니다. 코딩 에이전트의 맥락 파일은 저장소 루트의 `AGENTS.md`입니다. `desk/AGENTS.md`는 다른 파일로, OpenClaw 창구의 운영 규칙입니다.

- `configs/workflow.yml`이 `additional_instructions: file://../workspace/AGENTS.md`로 이 파일을 읽습니다.
- `tests/test_workspace.py`가 이 파일의 sha256을 옮기기 전 문구와 비교합니다. 골든셋(#73)이 이 문구에 맞춰져 있습니다.
- Simplified Technical English로 다시 쓰는 일은 골든셋을 다시 돌리는 작업(#96)과 함께 합니다.
- 규칙 스킬의 본문(`skills/cualign-clinical-rules/SKILL.md`)도 #96을 기다립니다. 영어 문장 안에 한국어가 있고 부정형 규칙이 있습니다. 계획 에이전트가 이 스킬을 문맥에 싣고 읽으므로, 골든셋이 이 본문에 묶여 있습니다. 창구 스킬(`skills/cualign-planner/SKILL.md`)은 기다리지 않습니다. 이 스킬의 한국어는 인용한 용어와 출력 문구뿐입니다.

## 연결

- **스킬:** `src/cualign/core/skills.py`가 `workspace/skills/<이름>/SKILL.md`를 읽습니다. `load_skill` 도구와 서버 문맥 미리 싣기에 씁니다.
- **스킬 허용 목록:** 에이전트마다 쓸 수 있는 스킬 목록이 있습니다. 규칙은 OpenClaw `tools/skills.md`의 "Agent allowlists"와 같습니다.

  | 에이전트 | 스킬 | 설정 위치 |
  |---|---|---|
  | NAT 계획 에이전트 | `cualign-clinical-rules` | `configs/workflow.yml`의 `function_groups.cualign.skills` |
  | OpenClaw 창구(`cualign-desk`) | `cualign-planner` | OpenClaw 설정의 `agents.list[].skills` |

  계획 에이전트는 목록 밖 스킬을 `load_skill`로 요청하면 거절합니다. 미리 싣는 스킬이 목록 밖이면 서버가 시작하지 않습니다. 허용 목록은 보안 경계가 아닙니다. 도구와 네트워크는 Guardrails와 OpenShell이 막습니다.
- **이미지:** `Dockerfile`과 `Dockerfile.openshell`이 `workspace/`를 `/app/workspace`로 복사합니다.
- **OpenClaw 템플릿:** `HEARTBEAT.md`는 OpenClaw 템플릿의 사본입니다. OpenClaw의 `AGENTS.md` 템플릿은 `desk/AGENTS.md`의 상위 참고본입니다. 버전과 해시는 `nemoclaw/openclaw-2026.7.1/README.md`에 적혀 있습니다.

## 관리자용 정본

창구 파일은 창구 워크스페이스 안의 파일만 가리킵니다. 아래 정본은 그 밖에 있습니다.

| 대상 | 정본 |
|---|---|
| 창구 도구 설명 | `src/cualign/server/mcp_server.py`의 docstring |
| 계획 에이전트 도구 설명 | `src/cualign/agent/register.py`의 docstring. 검토 에이전트는 `configs/workflow.yml`의 `functions.reviewer` |
| 계획 에이전트 도구 순서와 예시 인자 | `skills/cualign-clinical-rules/SKILL.md`의 "Tool sequence" 절 |
| 입력 범위 검사, 출력 검사 프롬프트 | `guardrails/prompts.yml` |
| 콘텐츠 안전 정책(범주, 허용 목록, 심각도) | `guardrails/policy/cualign_clinical_scope_v1.0.0.md`. 배포 문구는 `guardrails/config.yml` |
| 샌드박스 파일·네트워크 경계 | `openshell/policy.yaml`, `openshell/server-policy.yaml` |
| 창구에서 승인·내보내기 도구 차단 | `docs/nemoclaw.md` §4의 `--deny-tool` |

## OpenClaw 샌드박스에 설치하기

OpenClaw는 샌드박스의 `.openclaw/workspace/`에 있는 파일을 대화 문맥에 넣습니다. `docs/nemoclaw.md`의 창구 샌드박스 `cualign-desk`에 다음을 합니다.

1. 스킬 설치: `nemoclaw cualign-desk skill install workspace/skills/cualign-planner` (`docs/nemoclaw.md` §4).
2. `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`를 샌드박스의 `.openclaw/workspace/`에 복사합니다. 복사는 샌드박스 밖 운영자 터미널에서 합니다.
3. `desk/AGENTS.md`를 `/sandbox/.openclaw/workspace/AGENTS.md`로 복사합니다. NemoClaw 기본 `AGENTS.md`를 이 파일로 바꿉니다.
4. `SOUL.md`는 이 저장소에서만 고치고 다시 복사합니다. 샌드박스가 이 파일을 잠글 수 있는지는 `docs/nemoclaw.md`에 적혀 있습니다.
5. 이 폴더의 계획 에이전트 프롬프트 `AGENTS.md`와 `skills/cualign-clinical-rules`는 창구에 넣지 않습니다. NAT 계획 에이전트의 것이고, 창구에는 `cualign__` 도구가 없습니다.

이 단계들의 검증 상태는 `docs/nemoclaw.md`에 있습니다.

## 과정 규약과 다른 점

| 과정 규약 | 여기 | 이유 |
|---|---|---|
| `memory/`에 날마다 기록하고 `MEMORY.md`로 정리 | 기억을 쓰지 않고 `memory/` 폴더도 없음 | `MEMORY.md` 참고 |
| `HEARTBEAT.md`에 주기 작업 목록 | 주석만 있는 OpenClaw 기본 파일 | cuAlign은 요청이 있을 때만 움직입니다. `HEARTBEAT.md`의 주석 참고 |
| 에이전트 하나가 워크스페이스를 읽음 | NAT 계획 에이전트와 OpenClaw 창구가 서로 다른 파일을 읽음 | 계획과 규칙 검사는 검증된 NAT 에이전트에 남기고, 창구는 MCP로 맡깁니다 |
| `AGENTS.md`는 자유롭게 고치는 운영 규칙 | `AGENTS.md`는 고정된 NAT 프롬프트. 창구 규칙은 `desk/AGENTS.md`에 있음 | 골든셋(#73)이 NAT 프롬프트 문구에 맞춰져 있습니다. 설치할 때 `desk/AGENTS.md`를 창구의 `AGENTS.md`로 복사합니다 |
| 경계는 `SOUL.md`에 적음 | `SOUL.md`는 창구 스킬을 가리킴. 승인·내보내기 요청만 예외 | `SOUL.md` 규칙 1, 2 참고. 런타임 정본은 위 표에 있습니다 |
| `IDENTITY.md`의 이모지 | 정하지 않음 | 근거 자료에 없습니다 |
