# NemoClaw 창구 연결

> 2026-09-26 · 상태: cuAlign 쪽(`/mcp`, 스킬, 프록시 설정)은 오프라인 시험까지 마쳤습니다. NemoClaw 설치와 실제 등록은 **검증 대기**입니다.

NemoClaw 샌드박스 안의 OpenClaw 에이전트가 의사와 대화하는 창구가 되고, cuAlign은 MCP 서버로 계획을 맡습니다.
계획과 규칙 검사는 지금처럼 cuAlign의 NAT 에이전트가 합니다. OpenClaw가 cuAlign 내부 도구(`propose_target` 등)를 직접
부르지 않으므로, 지금까지 검증한 에이전트와 골든셋 A가 그대로 유효합니다.

## 구조

```
의사 ─▶ OpenClaw  [NemoClaw 샌드박스 · 추론 build.nvidia.com nemotron-3-super]
          │  스킬 cualign-planner (nemoclaw/cualign-planner/SKILL.md)
          │  MCP (Streamable HTTP · HTTPS · Bearer 토큰)
          │  OpenShell MCP 프록시: 토큰을 채우고, 막힌 도구를 거부합니다
          ▼
        Caddy  [호스트 · https://<사설 주소>:8443/mcp · 내부 인증기관 · 토큰 확인]
          ▼
        cuAlign 서버  [기존 OpenShell 샌드박스 · 127.0.0.1:8000]
          ├ /mcp          (src/cualign/server/mcp_server.py, 토큰을 다시 확인합니다)
          ├ /chat/stream  (UI와 cualign_plan이 같은 경로를 씁니다)
          └ NAT ReAct 에이전트 + Guardrails + load_skill + 검토 에이전트
```

## MCP 도구와 차단 정책

| 도구 | 하는 일 | NemoClaw 정책 |
|---|---|---|
| `cualign_list_cases` | 샘플 케이스와 밀집량(mm)을 돌려줍니다. | 허용 |
| `cualign_plan` | 서버 안에서 `/chat/stream`으로 요청을 보냅니다. 그래서 UI와 똑같이 `plan_events.open_run`이 서버 문맥을 넣고, 레일과 검토가 돕니다. 답변, 호출한 도구, 선택된 계획(규칙 결과, 단계 수, 개월, 검토 메모), 화면 링크를 돌려줍니다. | 허용 |
| `cualign_get_plan` | 저장된 계획의 요약을 돌려줍니다. | 허용 |
| `cualign_approve_plan` | 승인하지 않습니다. 화면에서 승인하라는 안내와 링크만 돌려줍니다. | `--deny-tool`로 차단 |
| `cualign_export_stl` | 의사가 화면에서 승인한 계획만 다운로드 링크를 돌려줍니다(`STORE.require_approved`). | `--deny-tool`로 차단 |

승인과 내보내기는 세 겹으로 막힙니다. 스킬이 부르지 말라고 지시하고, OpenShell MCP 프록시가 도구 이름으로 거부하고,
서버가 의사 승인 없이는 거절합니다. 시연에서는 "승인해 줘"라는 요청이 프록시에서 거부되는 기록을 보여 줍니다.

## 인증

- 토큰은 agent-vault 카드에 새로 만듭니다. 레포와 로그에는 남기지 않습니다.
- NemoClaw는 `mcp add --env CUALIGN_MCP_TOKEN`으로 토큰을 OpenShell 공급자 저장소에 넣고, 샌드박스에는 자리표시자만 둡니다.
- Caddy는 호스트에서 원래 토큰으로 `Authorization` 헤더를 확인합니다.
- cuAlign 서버는 OpenShell 샌드박스 안에서 돌기 때문에 원래 토큰을 받을 수 없습니다. 공급자 비밀은 프로세스에 자리표시자로만 들어가고, `--env`는 비밀이 아닌 값에만 쓰게 되어 있기 때문입니다. 그래서 서버는 토큰의 SHA-256 값(`CUALIGN_MCP_TOKEN_SHA256`)만 받아 비교합니다. 로컬 개발에서는 `CUALIGN_MCP_TOKEN`도 받습니다.
- 둘 다 없으면 `/mcp`는 503을 돌려줍니다. 기존 UI와 API는 영향을 받지 않습니다.

## 설정 순서

### 1. cuAlign 샌드박스에 토큰 해시 넣기

```sh
cd apps/cualign-prototype
# 토큰은 agent-vault 카드에서 읽어 셸 변수로만 둡니다(화면에 출력하지 않습니다).
HASH=$(printf %s "$CUALIGN_MCP_TOKEN" | shasum -a 256 | cut -d' ' -f1)
openshell sandbox create --name cualign --from Dockerfile.openshell \
  --policy openshell/server-policy.yaml --provider nvidia --forward 8000 \
  --env CUALIGN_MCP_TOKEN_SHA256=$HASH --env CUALIGN_PUBLIC_URL=http://127.0.0.1:8000 \
  --detach --no-tty --no-auto-providers -- \
  /app/.venv/bin/nat serve --config_file /app/configs/workflow.yml --host 0.0.0.0 --port 8000
```

`/mcp`는 샌드박스로 들어오는 요청이므로 `openshell/server-policy.yaml`의 나가는 요청 규칙은 바꾸지 않습니다.

### 2. Caddy로 HTTPS 열기

NemoClaw는 `127.0.0.1` 같은 루프백 주소를 거부합니다. 사설 주소(RFC1918 등)여야 하고, TLS 인증서가 URL의 호스트와 맞아야 합니다.
`nemoclaw/Caddyfile`은 `/mcp` 경로와 토큰이 맞는 요청만 cuAlign으로 넘기고, 나머지는 404로 돌려줍니다.

두 가지 주소를 후보로 둡니다.

| 후보 | `CUALIGN_MCP_HOST` | `CUALIGN_MCP_BIND` | 설명 |
|---|---|---|---|
| A | `192.168.5.2` | `127.0.0.1` | colima VM에서 본 호스트 주소(`host.lima.internal`)입니다. VM 밖으로 포트가 열리지 않습니다. |
| B | 이 Mac의 LAN IP | 같은 LAN IP | A가 안 될 때 씁니다. 방화벽으로 게이트웨이 외의 접근을 막아야 합니다. |

```sh
CUALIGN_MCP_HOST=192.168.5.2 CUALIGN_MCP_BIND=127.0.0.1 CUALIGN_MCP_TOKEN=... \
  caddy run --config nemoclaw/Caddyfile --adapter caddyfile
```

Caddy 내부 인증기관의 루트 인증서를 `NEMOCLAW_CORPORATE_CA_BUNDLE`로 NemoClaw에 넘깁니다. 인증기관을 바꾸면 샌드박스를 다시 만들어야 합니다.

### 3. NemoClaw 설치와 OpenClaw 온보딩

```sh
# 설치 전에 OpenShell 설정을 백업합니다. 지금 돌고 있는 cuAlign 샌드박스는 지우지 않습니다.
cp -R ~/.config/openshell ~/.config/openshell.bak-nemoclaw
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash      # Node 22.19 이상, npm 10 이상이 필요합니다
NEMOCLAW_PROVIDER=build NEMOCLAW_CORPORATE_CA_BUNDLE=<root.crt 경로> nemoclaw onboard
```

### 4. MCP 등록과 스킬 설치

```sh
nemoclaw cualign-desk mcp add cualign \
  --url https://192.168.5.2:8443/mcp --env CUALIGN_MCP_TOKEN \
  --trusted-private-host 192.168.5.2 \
  --deny-tool cualign_approve_plan --deny-tool cualign_export_stl
nemoclaw cualign-desk mcp status cualign
nemoclaw cualign-desk skill install nemoclaw/cualign-planner
```

`mcp status`는 샌드박스 안에서 MCP `initialize`를 보내 토큰과 경로를 확인합니다. 샌드박스 셸의 `curl`은 정책상 막히므로, 연결 확인에는 쓰지 않습니다.

### 5. 시연

1. OpenClaw에게 "moderate 케이스, 발치 없이 계획해 줘"라고 요청합니다. cuAlign이 계획하고, OpenClaw가 검토 메모를 인용해 요약합니다.
2. "이 계획 승인해 줘"라고 요청합니다. OpenShell 프록시가 `cualign_approve_plan`을 거부한 기록을 남깁니다.
3. 화면 링크를 열어 의사가 cuAlign UI에서 직접 승인합니다.

## 제약

- NemoClaw는 알파 버전이고, macOS(Apple Silicon, colima)는 "제한적으로 시험됨"입니다.
- NemoClaw는 OpenShell 0.0.116을 요구합니다. 우리가 쓰는 버전과 같습니다.
- Streamable HTTP MCP만 받습니다. `/mcp`는 상태를 두지 않는 JSON 응답 방식입니다.
- 이 Mac의 Node는 22.18.0이라 설치 전에 22.19 이상으로 올려야 합니다.
- OpenClaw도 같은 NIM을 부르므로 NIM 과부하(#51)의 영향을 받습니다. `cualign_plan` 한 번은 LLM을 약 14번 부르므로 최대 10분까지 기다립니다.

## 검증 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| `/mcp` 도구 5개, 토큰 확인, 승인·내보내기 거절 | 오프라인 시험 통과 | `tests/test_mcp_server.py` |
| `cualign_plan`이 실제 NAT 워커와 레일을 거쳐 계획함 | 오프라인 시험 통과(가짜 LLM) | `tests/test_rails_middleware.py::test_mcp_plan_runs_the_guarded_workflow` |
| 스킬과 문서의 도구 이름이 서버와 일치함 | 오프라인 시험 통과 | `tests/test_mcp_server.py::test_openclaw_skill_and_proxy_name_the_served_tools` |
| Caddyfile 문법 | 검증 대기 | 이 Mac에 Caddy가 없습니다 |
| NemoClaw 설치, OpenClaw 온보딩 | 검증 대기 | |
| 후보 A 주소로 `mcp add`와 `mcp status` 통과 | 검증 대기 | |
| 프록시의 도구 차단 기록 | 검증 대기 | |

## 참고

- [NemoClaw: Add an MCP Server](https://github.com/NVIDIA/NemoClaw/blob/main/docs/manage-sandboxes/add-mcp-server.mdx)
- [NemoClaw: About Managed MCP Servers](https://github.com/NVIDIA/NemoClaw/blob/main/docs/deployment/set-up-mcp-bridge.mdx)
- [NVIDIA DLI: Securing Agents with OpenShell and NemoClaw](https://nvdli.github.io/NemoClawDLI/nemoclaw/)
