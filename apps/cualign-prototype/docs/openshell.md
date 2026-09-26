# OpenShell — 도구 실행 샌드박스

`openshell/policy.yaml` (`version: 1`): 파일시스템 읽기 전용 목록 + `/tmp` 쓰기, `run_as_user: sandbox`, 아웃바운드 **기본 차단** — 명시된 호스트·메서드·경로만 허용.
현재 정책은 접근 경계를 확인한 실험 자산이며, cuAlign 서버에 통합되어 있지 않다.
메시를 NIM에 보내는 설계가 아니다. 서버 통합 시 NIM 호출과 출력 디렉터리의 허용 범위를 별도로 설계해야 한다.

## 실측 (WSL 2 Ubuntu-24.04 · Docker Desktop · OpenShell 0.0.116 · 2026-09-23)

```bash
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
openshell status                                                        # Connected · mTLS
openshell sandbox create --name cualign-demo --policy openshell/policy.yaml
openshell sandbox exec -n cualign-demo -- curl -sS https://example.com  # 기대: 차단
```

| 시험 | 결과 |
|---|---|
| 기본 정책에서 외부 호스트 curl | ✅ `CONNECT tunnel failed, response 403` — 아웃바운드 기본 차단 |
| `/usr/local` 파일 쓰기 | ✅ DENIED |
| `/tmp` 파일 쓰기 | ✅ WROTE — 파일시스템 정책 양방향 |
| L7 규칙(GET 허용 / POST 거부) | ❌ 반대로 나옴 — HTTPS CONNECT 터널을 L7 로 검사하려면 샌드박스 내 프록시 CA 신뢰 설정이 필요한 것으로 보임. alpha 라 여기서 멈춤 |

함정: `wsl.exe` 세션이 끝나면 직전 샌드박스가 Error(exit 143)로 전이한다 — 시연은 한 세션에서 create → exec 까지. 라이브 `policy set` 은 파일시스템 항목 삭제를 거부하므로 정책은 생성 시 `--policy` 로.

위 실험은 외부 호스트 요청과 파일 쓰기 차단에 대한 관측이며 실제 환자 스캔 유출 시험이 아니다.

## 서버 전체를 샌드박스에서 실행하기

`nat serve`(에이전트·Guardrails·UI)를 OpenShell 샌드박스 안에서 실행한다. 파일: `openshell/server-policy.yaml`, `Dockerfile.openshell`.

- 파일: 코드 `/app` 읽기 전용, 쓰기는 `/sandbox`(계획 출력 `CUALIGN_OUT=/sandbox/out`)와 `/tmp`만.
- 네트워크: `integrate.api.nvidia.com`의 `POST /v1/chat/completions` 하나만 허용(L7).
- 키: 샌드박스에 두지 않는다. `--provider nvidia`를 붙이면 환경 변수에는 `openshell:resolve:env:…` placeholder만 들어가고 프록시가 실제 키로 바꾼다.
- 모델 3개(super·lightning·content-safety)를 그대로 쓴다. `inference.local`은 게이트웨이당 모델 하나로 고정되므로 이 구성에 맞지 않는다.

### 실행

```sh
cd apps/cualign-prototype   # 이하 경로는 앱 폴더 기준
openshell provider create --name nvidia --type nvidia --credential NVIDIA_API_KEY   # 한 번만
openshell sandbox create --name cualign --from Dockerfile.openshell \
  --policy openshell/server-policy.yaml --provider nvidia --forward 8000 \
  --detach --no-tty --no-auto-providers -- \
  /app/.venv/bin/nat serve --config_file /app/configs/workflow.yml --host 0.0.0.0 --port 8000
# 브라우저: http://127.0.0.1:8000/ui/
openshell logs cualign --since 10m        # ALLOWED/DENIED 판정 기록
openshell forward stop 8000 cualign && openshell sandbox delete cualign   # 정리
```

`--detach`로 만들 때 명령을 주지 않으면 이미지 `CMD`가 아니라 셸이 메인 프로세스가 된다. 서버 명령을 `--` 뒤에 명시한다.

### 확인한 것 (2026-09-24, macOS · colima Docker 28.4 · OpenShell 0.0.116)

| 항목 | 결과 |
|---|---|
| UI | 호스트 `http://127.0.0.1:8000/ui/` 200 (`--forward 8000`) |
| 되묻기 요청 `moderate 케이스 계획 짜줘.` | 200, 9.1초, "발치는 허용되나요? 치료 기간 상한은 몇 개월인가요?" |
| 시나리오 1 (발치 없이 12개월, 앞니 먼저) | 200, 47초. expansion → ipr → expansion_ipr 순서로 전환해 위반 없음(p3, 14단계), 검토 에이전트 호출 |
| Guardrails | 범위 밖 요청("처방전 써줘")에 `rails.py`의 `REFUSAL` 응답 |
| 파일 | 계획이 `/sandbox/out/plans`에 저장, `/app` 쓰기는 `Permission denied` |
| 네트워크 로그 | `ALLOWED POST …/v1/chat/completions [policy:nvidia_nim_chat engine:l7]` 22건, `DENIED … events.telemetry.data.nvidia.com:443` 3건(NAT 텔레메트리) |
| 키 | 샌드박스 안 `NVIDIA_API_KEY`는 placeholder |
| 정책 파서 | `openshell-prover check openshell/server-policy.yaml --boundary openshell/server-policy.yaml` → `within_boundary` |

### 통합 브랜치 재확인 (2026-09-26, macOS · colima Docker 29.5 · OpenShell 0.0.116)

| 항목 | 결과 |
|---|---|
| 되묻기 요청 `moderate 케이스 계획 짜줘.` | 200, 19초, "발치는 허용되나요? 치료 기간 상한은 몇 개월인가요?" |
| 시나리오 1 (발치 없이 12개월, 앞니 먼저) | 200, 89초. expansion_ipr, 16단계, 위반 없음, stage_cap 52, 검토 통과 |
| 비교 요청 (`/generate/stream`) | 단계 기록에 `cualign__load_skill` → `load_case` → `compare_strategies` → `select_plan` → `reviewer` |
| 네트워크 | `ALLOWED … /v1/chat/completions` 47건, 샌드박스 안에서 `https://example.com`은 `403 Forbidden` |
| 파일·키 | `/app` 쓰기 `Permission denied`, `NVIDIA_API_KEY`는 `openshell:` placeholder |

colima처럼 `/var/run/docker.sock`이 실제 데몬을 가리키지 않으면 게이트웨이가 드라이버를 찾지 못한다
(`no compute driver configured`). `~/.config/openshell/gateway.env`에 `OPENSHELL_DRIVERS=docker`와
`DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`을 두고 `brew services restart openshell`로 다시 띄운다.
`openshell sandbox create`도 이미지를 로컬에서 빌드하므로 같은 `DOCKER_HOST`를 셸에 설정한다.

### 샌드박스에서 동작하도록 고친 것

- `src/cualign/keys.py`: Guardrails와 `cualign serve`가 키를 `nvapi-` 접두어로만 판정해, placeholder일 때 **Guardrails가 조용히 꺼졌다**. placeholder도 키가 있는 것으로 본다.
- `src/cualign/sandbox_compat.py`: NIM 비동기 클라이언트(langchain-nvidia-ai-endpoints)가 aiohttp 세션을 `trust_env` 없이 만들어 `HTTPS_PROXY`를 무시하고 DNS 오류(`ClientConnectorDNSError`)로 실패했다. 프록시 변수가 있을 때만 aiohttp 세션 기본값을 `trust_env=True`로 둔다. 샌드박스 밖에서는 아무것도 바꾸지 않는다.
- `Dockerfile.openshell`: 의존성 설치를 소스 복사보다 먼저 두어 코드 수정 후 재빌드 시간을 줄였다.

L7 규칙은 엔드포인트에 `protocol: rest`가 있어야 검사된다(정책 스키마). 위 실험 기록의 "L7 규칙이 반대로 나옴"은
기존 `policy.yaml`에 이 필드가 없어서일 가능성이 있다. 재확인은 하지 않았다.

### 이 환경에서 알려진 함정

- `--from` 빌드는 docker context를 따르지 않는다. colima는 `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`.
- 이미지에 `iproute2`가 없으면 `Network namespace creation failed ... trusted ip helper not found`.
- `sandbox exec`·`connect` 세션은 이미지 `ENV`를 물려받지 않는다. 서버는 생성 시 메인 명령으로 띄운다.
- 샌드박스 이름은 19자까지. 업스트림 503은 샌드박스 쪽에서 500으로 보일 수 있다.
