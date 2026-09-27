# NemoClaw 창구 연결

> 2026-09-26 · 상태: cuAlign 쪽(`/mcp`, 스킬, 프록시 설정)은 오프라인 시험까지 마쳤습니다. colima VM에서 사설 CA와 토큰으로 `https://192.168.5.2:8443/mcp`에 MCP `initialize`가 통과했습니다. OpenClaw 온보딩은 colima에서 [2/8] 단계에 막혀 있어, 실제 등록은 Linux(Brev)에서 확인할 때까지 **검증 대기**입니다. 시험한 버전은 NemoClaw v0.0.124와 OpenShell 0.0.116입니다.

NemoClaw 샌드박스 안의 OpenClaw 에이전트가 의사와 대화하는 창구가 되고, cuAlign은 MCP 서버로 계획을 맡습니다.
계획과 규칙 검사는 지금처럼 cuAlign의 NAT 에이전트가 합니다. OpenClaw가 cuAlign 내부 도구(`propose_target` 등)를 직접
부르지 않으므로, 지금까지 검증한 에이전트와 골든셋 A가 그대로 유효합니다.

## 구조

```
의사 ─▶ OpenClaw  [NemoClaw 샌드박스 · 추론 build.nvidia.com nemotron-3-super]
          │  스킬 cualign-planner (workspace/skills/cualign-planner/SKILL.md)
          │  MCP (Streamable HTTP · HTTPS · Bearer 토큰)
          │  OpenShell MCP 프록시: 토큰을 채우고, 막힌 도구를 거부합니다
          ▼
        Caddy  [호스트 · https://192.168.5.2:8443/mcp · 사설 CA 인증서 · 토큰 확인]
          ▼
        cuAlign 서버  [기존 OpenShell 샌드박스 · 127.0.0.1:8000]
          ├ /mcp          (src/cualign/server/mcp_server.py, 토큰과 Host를 다시 확인합니다)
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
- 서버 하나에 토큰 환경 변수는 하나만 둡니다. 이름이 `NEMOCLAW_`, `OPENCLAW_`, `OPENSHELL_`로 시작하면 NemoClaw가 거부하므로 `CUALIGN_MCP_TOKEN`을 씁니다.
- MCP SDK는 DNS 리바인딩을 막으려고 `Host` 헤더를 확인합니다. 로컬 주소(`127.0.0.1`, `localhost`)는 늘 허용하고, NemoClaw가 부르는 주소는 `CUALIGN_MCP_ALLOWED_HOSTS`에 쉼표로 적습니다. 목록에 없으면 421 `Invalid Host header`를 돌려줍니다.

## 설정 순서

### 1. cuAlign 샌드박스에 토큰 해시 넣기

```sh
cd apps/cualign-prototype
# 토큰은 agent-vault 카드에서 읽어 셸 변수로만 둡니다(화면에 출력하지 않습니다).
HASH=$(printf %s "$CUALIGN_MCP_TOKEN" | shasum -a 256 | cut -d' ' -f1)
openshell sandbox create --name cualign --from Dockerfile.openshell \
  --policy openshell/server-policy.yaml --provider nvidia --forward 8000 \
  --env CUALIGN_MCP_TOKEN_SHA256=$HASH --env CUALIGN_PUBLIC_URL=http://127.0.0.1:8000 \
  --env CUALIGN_MCP_ALLOWED_HOSTS=192.168.5.2,192.168.5.2:8443 \
  --detach --no-tty --no-auto-providers -- \
  /app/.venv/bin/nat serve --config_file /app/configs/workflow.yml --host 0.0.0.0 --port 8000
```

`/mcp`는 샌드박스로 들어오는 요청이므로 `openshell/server-policy.yaml`의 나가는 요청 규칙은 바꾸지 않습니다.

### 2. Caddy로 HTTPS 열기

NemoClaw는 `127.0.0.1` 같은 루프백 주소를 거부합니다. 사설 주소(RFC1918 등)여야 하고, TLS 인증서가 URL의 호스트와 맞아야 합니다.
`nemoclaw/Caddyfile`은 `/mcp` 경로와 토큰이 맞는 요청만 cuAlign으로 넘기고, 나머지는 404로 돌려줍니다.

인증서는 이 연결에만 쓰는 사설 CA로 따로 만듭니다. 서버 인증서에는 IP SAN `192.168.5.2`와 용도 `serverAuth`를 넣습니다.
`192.168.5.2`는 colima VM에서 본 호스트 게이트웨이 주소이고 LAN에는 없습니다.

```sh
D=~/.config/cualign-mcp-tls; mkdir -p $D && cd $D
openssl req -x509 -newkey rsa:3072 -nodes -days 365 -subj "/CN=cuAlign MCP private CA" \
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign \
  -keyout ca.key -out ca.pem
openssl req -newkey rsa:2048 -nodes -subj "/CN=192.168.5.2" -keyout server.key -out server.csr
printf 'subjectAltName=IP:192.168.5.2\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' > server.ext
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 365 \
  -extfile server.ext -out server.pem
```

Caddy는 `192.168.5.2:8443`에서 듣습니다. Lima가 그 주소를 Mac의 루프백으로 넘기는 구성이면 `CUALIGN_MCP_BIND=127.0.0.1`로 둡니다.

```sh
CUALIGN_MCP_HOST=192.168.5.2 CUALIGN_MCP_BIND=192.168.5.2 \
  CUALIGN_MCP_CERT=$D/server.pem CUALIGN_MCP_KEY=$D/server.key CUALIGN_MCP_TOKEN=... \
  caddy run --config nemoclaw/Caddyfile --adapter caddyfile
```

Caddy는 `Host` 헤더를 그대로 넘기므로, 1단계의 `CUALIGN_MCP_ALLOWED_HOSTS`에 `192.168.5.2`와 `192.168.5.2:8443`이 있어야 합니다.

사설 CA의 `ca.pem`만 `NEMOCLAW_CORPORATE_CA_BUNDLE`로 온보딩 전에 넘깁니다. 이미 만든 샌드박스라면 `nemoclaw cualign-desk rebuild`로 다시 만들어야 CA가 들어갑니다.

### 3. NemoClaw 설치와 OpenClaw 온보딩

NemoClaw는 Mac 호스트가 아니라 colima VM(Ubuntu) 안에 설치합니다. macOS에서 온보딩하면 `~/.config/openshell/gateway.env`의 포트와 DB 경로를 덮어쓰고 Homebrew OpenShell 게이트웨이를 재시작합니다. 그러면 지금 돌고 있는 cuAlign 샌드박스가 게이트웨이를 잃습니다. VM 안에서는 NemoClaw가 자기 게이트웨이와 Node를 따로 두므로 Mac의 설정이 바뀌지 않습니다.

```sh
# 설치 전에 OpenShell 설정을 백업합니다. 지금 돌고 있는 cuAlign 샌드박스는 지우지 않습니다.
cp -R ~/.config/openshell ~/.config/openshell.bak-nemoclaw
# 아래는 colima VM 안(colima ssh)에서 실행합니다. 키는 표준 입력으로 넘기고 화면에 찍지 않습니다.
curl -fsSL https://www.nvidia.com/nemoclaw.sh | NEMOCLAW_NON_INTERACTIVE=1 \
  NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 NEMOCLAW_AGENT=openclaw NEMOCLAW_PROVIDER=build \
  NEMOCLAW_SANDBOX_NAME=cualign-desk NEMOCLAW_POLICY_TIER=restricted \
  OPENSHELL_DOCKER_NETWORK_NAME=nemoclaw-docker \
  NEMOCLAW_CORPORATE_CA_BUNDLE=<사설 CA 하나만 담은 PEM 경로> bash
```

- `OPENSHELL_DOCKER_NETWORK_NAME`을 따로 주어야 cuAlign 샌드박스가 쓰는 `openshell-docker` 네트워크와 겹치지 않습니다.
- 인증서 파일에는 사설 CA 하나만 담습니다. 여러 인증서를 합친 신뢰 저장소는 거부됩니다.
- 설치기는 Node가 22.19보다 낮으면 nvm으로 Node 22를 설치합니다. VM 안에만 설치되므로 Mac의 Node는 바뀌지 않습니다.

### 4. MCP 등록과 스킬 설치

```sh
nemoclaw cualign-desk mcp add cualign \
  --url https://192.168.5.2:8443/mcp --env CUALIGN_MCP_TOKEN \
  --trusted-private-host 192.168.5.2 \
  --deny-tool cualign_approve_plan --deny-tool cualign_export_stl
nemoclaw cualign-desk mcp status cualign --json
nemoclaw cualign-desk skill install workspace/skills/cualign-planner
```

`mcp status`는 샌드박스 안에서 MCP `initialize`를 보내 토큰과 경로를 확인합니다. JSON 결과의 `trustedPrivateTarget.state`가 `match`여야 합니다. 샌드박스 셸의 `curl`은 정책상 막히므로, 연결 확인에는 쓰지 않습니다.

### 5. 시연

1. OpenClaw에게 "moderate 케이스, 발치 없이 계획해 줘"라고 요청합니다. cuAlign이 계획하고, OpenClaw가 검토 메모를 인용해 요약합니다.
2. "이 계획 승인해 줘"라고 요청합니다. OpenShell 프록시가 `cualign_approve_plan`을 거부한 기록을 남깁니다.
3. 화면 링크를 열어 의사가 cuAlign UI에서 직접 승인합니다.

## 제약

- NemoClaw는 알파 버전이고, macOS(Apple Silicon, colima)는 "제한적으로 시험됨"입니다.
- NemoClaw는 OpenShell 0.0.116을 요구합니다. 우리가 쓰는 버전과 같습니다.
- Streamable HTTP MCP만 받습니다. `/mcp`는 상태를 두지 않는 JSON 응답 방식입니다.
- colima에서는 온보딩이 [2/8] 게이트웨이 단계에서 멈춥니다(NemoClaw v0.0.124). NemoClaw의 사전 검사가 Docker Desktop만 알아보고, colima를 일반 Linux로 판단해 Docker 브리지 주소를 확인하기 때문입니다. 컨테이너에서 게이트웨이로 가는 실제 경로(`host.openshell.internal:8080`)는 연결됩니다. 이 검사를 끄는 환경 변수는 없으므로, 실제 Linux 호스트(Brev)에서 돌리거나 NemoClaw 쪽 수정을 기다려야 합니다.
- OpenClaw도 같은 NIM을 부르므로 NIM 과부하(#51)의 영향을 받습니다. `cualign_plan` 한 번은 LLM을 약 14번 부르므로 최대 10분까지 기다립니다.

## 검증 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| `/mcp` 도구 5개, 토큰과 Host 확인, 승인·내보내기 거절 | 오프라인 시험 통과 | `tests/test_mcp_server.py` |
| `cualign_plan`이 실제 NAT 워커와 레일을 거쳐 계획함 | 오프라인 시험 통과(가짜 LLM) | `tests/test_rails_middleware.py::test_mcp_plan_runs_the_guarded_workflow` |
| 스킬과 문서의 도구 이름이 서버와 일치함 | 오프라인 시험 통과 | `tests/test_mcp_server.py::test_openclaw_skill_and_proxy_name_the_served_tools` |
| 저장소의 Caddyfile 문법 | 검증 대기 | 이 Mac에 Caddy가 없습니다 |
| NemoClaw 설치 | 통과 | 2026-09-26 colima VM, NemoClaw v0.0.124, OpenShell 0.0.116 |
| OpenClaw 온보딩(`cualign-desk` 샌드박스) | 막힘 | colima에서 [2/8] 게이트웨이 사전 검사가 실패합니다(제약 참고) |
| VM에서 `https://192.168.5.2:8443/mcp`로 사설 CA와 토큰을 써서 MCP `initialize` | 통과 | 시험용 서버, 토큰이 없으면 401 |
| `mcp add`와 `mcp status`의 `trustedPrivateTarget.state: match` | 검증 대기 | 온보딩이 막혀 Linux(Brev)에서 확인해야 합니다 |
| 프록시의 도구 차단 기록 | 검증 대기 | |
| `SOUL.md` 읽기 전용 | 강제되지 않음 | 2026-09-27 실제 창구에서 확인. `/sandbox/.openclaw` 전체가 `read_write`인 동안, 그 아래 `SOUL.md`를 `filesystem_policy.read_only`에 더해도 쓰기, `chmod`, 이름 바꾸기가 모두 됩니다. Landlock은 경로를 따라 권한을 더하기만 합니다. 잠금은 아직 없습니다 |

## 참고

- [NemoClaw: Add an MCP Server](https://github.com/NVIDIA/NemoClaw/blob/main/docs/manage-sandboxes/add-mcp-server.mdx)
- [NemoClaw: About Managed MCP Servers](https://github.com/NVIDIA/NemoClaw/blob/main/docs/deployment/set-up-mcp-bridge.mdx)
- [NVIDIA DLI: Securing Agents with OpenShell and NemoClaw](https://nvdli.github.io/NemoClawDLI/nemoclaw/)
