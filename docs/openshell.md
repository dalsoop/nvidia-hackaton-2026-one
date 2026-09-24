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
이 레포 자체를 샌드박스 안에서 `nat serve`로 띄우는 것은 미검증이다.

## 서버 전체를 샌드박스에서 실행하기 (초안)

> 초안 상태다. 아래 "확인한 것"은 별도 최소 에이전트로 같은 조건을 시험한 결과이고,
> cuAlign 서버를 샌드박스에서 띄워 시나리오를 끝까지 돌린 검증은 아직 없다.

### 목표

`nat serve`(에이전트·Guardrails·UI)를 OpenShell 샌드박스 안에서 실행한다.

- 파일: 코드 `/app` 읽기 전용, 쓰기는 `/sandbox`(계획 출력 `CUALIGN_OUT=/sandbox/out`)와 `/tmp`만.
- 네트워크: `integrate.api.nvidia.com`의 `POST /v1/chat/completions` 하나만 허용.
- 키: 샌드박스 안에 두지 않는다. provider를 붙이면 환경 변수에는 placeholder만 들어가고 프록시가 실제 키로 바꾼다.
- 모델 3개(super·lightning·content-safety)를 그대로 쓴다. `inference.local`은 게이트웨이당 모델 하나로 고정되므로 이 구성에 맞지 않는다.

파일: `openshell/server-policy.yaml`, `Dockerfile.openshell`.

### 실행 (예정)

```sh
openshell provider create --name nvidia --type nvidia --credential NVIDIA_API_KEY
openshell sandbox create --name cualign --from Dockerfile.openshell \
  --policy openshell/server-policy.yaml --provider nvidia --forward 8000 --no-auto-providers
# 브라우저: http://localhost:8000/ui/
openshell logs cualign --since 10m    # ALLOWED/deny 판정 기록
```

### 확인한 것 (2026-09-24, macOS · colima Docker 28.4 · OpenShell 0.0.116)

별도 최소 에이전트 이미지(`python3.12`)로 같은 네트워크 규칙과 `--provider nvidia`를 시험했다.

| 항목 | 결과 |
|---|---|
| 샌드박스 안 `NVIDIA_API_KEY` | `openshell:resolve:env:…_NVIDIA_API_KEY` placeholder. 실제 키 아님 |
| `nemotron-3-super-120b-a12b` 직접 호출 | 200 (다른 시점에 NVIDIA 쪽 503 과부하도 관측) |
| `nemotron-3.5-content-safety` 직접 호출 | 200, `User Safety: safe` |
| 로그 | `ALLOWED POST http://integrate.api.nvidia.com:443/v1/chat/completions [policy:nvidia_nim engine:l7]` |
| 정책 파서 | `openshell-prover check openshell/server-policy.yaml --boundary openshell/server-policy.yaml` → `within_boundary` |

L7 규칙은 엔드포인트에 `protocol: rest`가 있어야 검사된다(정책 스키마). 위 실험 기록의 "L7 규칙이 반대로 나옴"은
기존 `policy.yaml`에 이 필드가 없어서일 가능성이 있다. 재확인은 하지 않았다.

### 남은 확인

- [ ] `Dockerfile.openshell`로 샌드박스 생성 → `nat serve` 기동 → `--forward 8000`으로 UI 접속
- [ ] 시나리오 1개 실호출 (에이전트 super + Guardrails content-safety)
- [ ] 계획 JSON이 `/sandbox/out`에 쓰이고 `/app` 쓰기는 거부되는지
- [ ] 허용하지 않은 호스트(예: `example.com`)와 GET 요청이 거부되고 로그에 남는지
- [ ] NeMo Guardrails가 기동 시 외부에서 모델·임베딩을 내려받는지. 받는다면 이미지에 포함하거나 허용 목록에 추가
- [ ] 결과를 `docs/NVIDIA_STACK.md`의 OpenShell 행과 `docs/VERIFICATION.md`에 반영

### 이 환경에서 알려진 함정

- `--from` 빌드는 docker context를 따르지 않는다. colima는 `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`.
- 이미지에 `iproute2`가 없으면 `Network namespace creation failed ... trusted ip helper not found`.
- `sandbox exec`·`connect` 세션은 이미지 `ENV`를 물려받지 않는다. 서버는 생성 시 메인 명령으로 띄운다.
- 샌드박스 이름은 19자까지. 업스트림 503은 샌드박스 쪽에서 500으로 보일 수 있다.
