# OpenShell — 도구 실행 샌드박스

`openshell/policy.yaml` (`version: 1`): 파일시스템 읽기 전용 목록 + `/tmp` 쓰기, `run_as_user: sandbox`, 아웃바운드 **기본 차단** — 명시된 호스트만 허용(엔드포인트에 `protocol`이 없어 메서드·경로 규칙은 검사되지 않는다).
현재 정책은 접근 경계를 확인한 실험 자산이며, cuAlign 서버에 통합되어 있지 않다.
메시를 NIM에 보내는 설계가 아니다. 서버 통합 시 NIM 호출과 출력 디렉터리의 허용 범위를 별도로 설계해야 한다.

## 네 경계

OpenShell 샌드박스의 경계는 네 가지다(NVIDIA DLI NemoClaw [04a Safety](https://nvdli.github.io/NemoClawDLI/nemoclaw/04a-safety.html)).
두 정책 파일의 헤더도 같은 말로 적는다. 필드의 뜻은 OpenShell [정책 스키마](https://docs.nvidia.com/openshell/latest/how-it-works/policies/schema)를 따른다.

| 경계 | 이 저장소의 정책 파일이 정하는 것 | 정하지 않는 것 |
|---|---|---|
| 네트워크 | 목적지(호스트·포트·실행 파일)와, `protocol`이 있는 엔드포인트의 메서드·경로 | 허용된 요청 본문의 의미. `server-policy.yaml`은 NIM chat POST를 허가할 뿐, 그 요청에 담긴 계획 요약·대화를 검사하지 않는다 |
| 파일(Landlock) | 읽기 전용·읽기 쓰기 경로. `compatibility: best_effort` | `best_effort`에서는 Landlock을 적용하지 못하면 샌드박스가 파일 규칙 없이 뜨고 심각도 높은 기록만 남긴다. 적용하지 못하면 시작하지 않는 값은 `hard_requirement`다 |
| 시스콜(seccomp) | 없음 | 정책 스키마에 항목이 없다. OpenShell 런타임 쪽 설정이며 이 저장소는 규칙을 두지 않는다 |
| 프로세스 | `run_as_user`·`run_as_group: sandbox`(서버 이미지는 `Dockerfile.openshell`의 uid·gid 10001, 비루트) | — |

- **바꿀 수 있는 시점:** `filesystem_policy`·`landlock`·`process`는 샌드박스를 만들 때 고정되고, `network_policies`만 실행 중에 바꿀 수 있다.
- **막힌 결과의 해석:** 명령이 막혔다는 결과만으로 어느 경계가 막았는지 단정하지 않는다. 예를 들어 아래 기록의 `/app` 쓰기 거부는 Landlock 이 아니라 비루트 사용자의 파일 권한으로도 날 수 있다. 어느 경계인지는 `openshell logs`의 판정 기록(네트워크는 `policy:`·`engine:`)이나 Landlock 적용 기록으로 확인한다.

## 버전: 0.0.116 으로 고정

이 문서의 기록은 모두 OpenShell **0.0.116** 이다. 설치 스크립트는 버전을 주지 않으면 최신판을 받으므로, 버전을 고정해 설치한다.

```bash
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | OPENSHELL_VERSION=v0.0.116 sh
openshell --version    # openshell 0.0.116
```

0.1.x(0.1.0·0.1.1, 2026-09-26 출시)에서는 이 문서의 절차가 동작하지 않는다(2026-09-27, WSL 2 Ubuntu-20.04 · Docker Desktop 29.6 · OpenShell 0.1.1 에서 확인):

- 기본 이미지(`nvcr.io/nvidia/base/ubuntu:24.04`)에 `sandbox` 사용자가 없어, `policy.yaml`로 만든 샌드박스가 `IdentityResolutionFailed`로 시작하지 않는다.
- `sandbox create --from <Dockerfile>`의 로컬 빌드가 빠졌다(릴리스 노트 #3214). 아래 «실행»의 `--from Dockerfile.openshell`을 그대로 쓸 수 없다.
- 게이트웨이 드라이버 변수는 `OPENSHELL_COMPUTE_DRIVER=docker`다(아래 함정의 `OPENSHELL_DRIVERS`가 아님).
- `sandbox` 사용자를 넣은 이미지로도 감독 프로세스가 `seccomp notification probe … notification launcher disappeared`로 죽었다. 이 환경(WSL 2 + Docker Desktop)만의 문제인지는 확인하지 않았다.

## 실측 (WSL 2 Ubuntu-24.04 · Docker Desktop · OpenShell 0.0.116 · 2026-09-23)

```bash
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | OPENSHELL_VERSION=v0.0.116 sh
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

L7 규칙은 엔드포인트에 `protocol: rest`가 있어야 검사된다. 정책 스키마는 «`protocol`이 없으면 `access`와 `rules`는
효과가 없다»고 적는다. 위 실험 기록의 "L7 규칙이 반대로 나옴"은 `policy.yaml`에 이 필드가 없어서로 보인다. 재실험은 하지 않았다.

### 이 환경에서 알려진 함정

- `--from` 빌드는 docker context를 따르지 않는다. colima는 `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`.
- 이미지에 `iproute2`가 없으면 `Network namespace creation failed ... trusted ip helper not found`.
- `sandbox exec`·`connect` 세션은 이미지 `ENV`를 물려받지 않는다. 서버는 생성 시 메인 명령으로 띄운다.
- 샌드박스 이름은 19자까지. 업스트림 503은 샌드박스 쪽에서 500으로 보일 수 있다.
