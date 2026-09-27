# cuAlign 에이전트 워크스페이스

cuAlign 에이전트의 정의는 모두 이 폴더에 있다. 페르소나, 운영 지시문, 사용자, 도구 메모, 기억 정책, 스킬이 여기에 있다.
폴더 구성은 NVIDIA DLI NemoClaw 과정 03b(OpenClaw)의 `.openclaw/workspace/` 규약을 따른다. 옛 위치에는 사본이나
안내 문서를 남기지 않았다.

## 파일 지도

| 파일 | 역할 | 옛 위치(옮겨 온 곳) |
|---|---|---|
| `SOUL.md` | 페르소나, 경계, 말투, 가치 | 스킬 두 개의 안전 경계 절, `AGENTS.md`의 경계 문장, `guardrails/policy/…_v1.0.0.md`의 관할 메모. 런타임 설정은 옮기지 않고 가리키기만 한다 |
| `AGENTS.md` | 계획 에이전트의 운영 지시문. NAT가 이 파일을 그대로 읽는다 | `configs/workflow.yml`의 `workflow.additional_instructions` (본문 전체, 바이트 그대로) |
| `IDENTITY.md` | 이름, 정체, 분위기, 이모지 | `configs/workflow.yml`(모델), `docs/nemoclaw.md`(구조), `skills/cualign-planner`("front desk") |
| `USER.md` | 사용하는 사람과 선호 | `guardrails/policy/…_v1.0.0.md`(배포 가정, 허용 목록), `guardrails/prompts.yml`(범위 예시), 규칙 스킬의 답변 언어 근거 |
| `TOOLS.md` | 도구별 사용 메모(색인) | `src/cualign/agent/register.py`의 도구 docstring, 두 스킬의 도구 절, `docs/nemoclaw.md`의 차단 정책 |
| `HEARTBEAT.md` | 주기 작업: 없음, 그 이유 | `configs/workflow.yml`(반복·검토 상한), `AGENTS.md`(승인), 창구 스킬(요청당 한 번) |
| `MEMORY.md` | 장기 기억: 쓰지 않음, 그 이유와 규칙 | `src/cualign/agent/context.py`(요청 로컬 상태), `AGENTS.md`(서버 문맥), 안전 정책의 PII 범주 |
| `skills/cualign-clinical-rules/` | 계획 에이전트가 따르는 임상 한계·전략 규칙(`SKILL.md`, `skill-card.md`) | `skills/cualign-clinical-rules/` (`git mv`) |
| `skills/cualign-planner/` | OpenClaw 창구 스킬(`SKILL.md`, `skill-card.md`) | `nemoclaw/cualign-planner/` (`git mv`) |
| `skills/skillspector-report*.md` | 규칙 스킬의 과거 SkillSpector 검사 결과(2026-09-22 스냅샷) | `skills/` (`git mv`) |

각 파일 끝의 주석에 문장별 출처가 있다.

제자리에 둔 것: `guardrails/`(NeMo Guardrails 런타임 설정과 안전 정책)와 `openshell/*.yaml`(샌드박스 정책)은
실행 설정이라 옮기지 않았다. `SOUL.md`의 경계 절이 이 파일들을 가리킨다.

## 연결

- **NAT 계획 에이전트:** `configs/workflow.yml`에 `additional_instructions: file://../workspace/AGENTS.md`가 있다.
  NAT의 설정 로더가 `file://` 참조를 파일 내용으로 바꾼다. `tests/test_workspace.py`는 NAT가 읽은 문자열이
  옮기기 전 지시문과 바이트 단위로 같은지 해시로 확인한다. 골든셋(#73)이 그 문구에 맞춰져 있기 때문이다.
  `AGENTS.md`를 고치면 이 해시가 깨진다. 문구를 바꾸려면 골든셋을 다시 돌리고 해시를 함께 갱신한다.
- **스킬:** `src/cualign/core/skills.py`가 `workspace/skills/<이름>/SKILL.md`를 읽는다(`load_skill` 도구, 서버 문맥 미리 싣기).
- **이미지:** `Dockerfile`과 `Dockerfile.openshell`이 `workspace/`를 `/app/workspace`로 복사한다.

## OpenClaw 샌드박스에 설치하기

OpenClaw는 샌드박스 안 `.openclaw/workspace/`의 파일을 대화 문맥에 넣는다. 창구 샌드박스(`docs/nemoclaw.md`의
`cualign-desk`)에는 다음을 넣는다.

1. 스킬: `nemoclaw cualign-desk skill install workspace/skills/cualign-planner` (`docs/nemoclaw.md` 4절의 명령).
2. `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`를 샌드박스의 `.openclaw/workspace/`에
   복사한다. 복사는 샌드박스 경계 위의 운영자 터미널에서 한다.
3. `SOUL.md`는 읽기 전용으로 둔다. 소유자는 운영자로 두고 샌드박스 사용자에게 쓰기 권한을 주지 않는다. 바꿀 때는 이
   저장소에서 MR로 고치고 다시 복사한다. 과정 04a는 에이전트가 자기 `SOUL.md`를 고치는 것(persona tamper)을 위험으로
   보고, 쓰기 제한과 리뷰 가능한 이력을 권한다.
4. 넣지 않는 것: `AGENTS.md`와 `skills/cualign-clinical-rules`는 cuAlign 서버 안 계획 에이전트의 것이다. 창구에는
   `cualign__` 도구가 없다. 창구가 계획을 직접 계산하지 않게 하려고 넣지 않는다.

2단계 복사와 3단계 권한 설정은 아직 실제 샌드박스에서 확인하지 않았다. `docs/nemoclaw.md`의 상태와 같이 **검증 대기**다.

## 과정 규약과 다른 점

| 과정 규약 | 여기 | 이유 |
|---|---|---|
| `memory/YYYY-MM-DD.md`에 날마다 기록, `MEMORY.md`로 정리 | 쓰지 않음. `memory/` 폴더 없음 | 조건과 계획 이력은 서버가 가진다. 대화 기억이 서버의 확정 조건과 어긋나면 조건이 몰래 바뀐다. 진료 대화에 환자 정보가 섞일 수 있다 |
| `HEARTBEAT.md`에 주기 작업 목록 | 없음 | 요청 때만 움직이고, 스스로 할 다음 행동(승인·내보내기)은 의사의 몫이다 |
| 에이전트 하나가 워크스페이스 하나를 읽음 | 에이전트 둘: NAT 계획 에이전트(`AGENTS.md`, 규칙 스킬), OpenClaw 창구(나머지와 창구 스킬) | 계획과 규칙 검사는 검증된 NAT 에이전트에 남기고, 창구는 MCP로 맡긴다(`docs/nemoclaw.md`) |
| `AGENTS.md`는 자유롭게 고치는 운영 규칙 | 바이트를 고정한 NAT 지시문 | 골든셋(#73)이 이 문구에 맞춰져 있다. 그래서 안에 적힌 옛 경로(`skills/cualign-clinical-rules/SKILL.md`)도 그대로 두었다. 스킬 이름으로 찾으므로 동작에는 영향이 없다 |
| 경계는 `SOUL.md`에 적음 | `SOUL.md`는 선언하고, 강제는 Guardrails·OpenShell 정책 파일이 한다 | 런타임 설정은 제자리가 정본이다. 문장을 복사하면 두 곳이 어긋난다 |
| 이모지 | 정하지 않음 | 원래 자료에 없다 |
