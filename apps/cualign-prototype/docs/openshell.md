# OpenShell — 도구 실행 샌드박스

> 공식 문서: [NVIDIA OpenShell: Manage Sandboxes](https://docs.nvidia.com/openshell/sandboxes/manage-sandboxes)  
> 소스코드 및 정책 스펙: [NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell)

OpenShell은 자율 AI 에이전트를 위한 커널 수준(Linux Landlock + eBPF) 격리 런타임이다.
cuAlign은 서버(`nat serve`) 전체를 샌드박스 내부에서 안전하게 구동하고, 인가된 NVIDIA NIM 엔드포인트 이외의 모든 아웃바운드 및 파일시스템 코드 수정을 차단하도록 설계되었다.

---

## 1. 정책 구성 (`openshell/server-policy.yaml`)

`server-policy.yaml` (`version: 1`):
- **파일시스템 (Landlock)**: 소스코드(`/app`), 시스템 바이너리는 `read_only`. 파일 쓰기는 계획 산출물 저장소(`/sandbox`, `CUALIGN_OUT=/sandbox/out`) 및 `/tmp`로만 엄격히 제한.
- **프로세스**: 비특권 non-root 사용자 `sandbox (uid: 10001)`.
- **네트워크 (L7 Egress Enforcement)**:
  - 프로토콜: `protocol: rest`
  - 허용 대상: `integrate.api.nvidia.com:443` 호스트에 대한 `POST /v1/chat/completions`만 허용.
  - 그 외 모든 외부 접속(텔레메트리, 임의 호스트 등)은 eBPF 터널에서 차단.
  - API 키는 `--provider nvidia` 옵션을 통해 주입되며, 샌드박스 내부에는 `openshell:resolve:env:...` 플레이스홀더만 존재하여 키 유출을 원천 방지(`src/cualign/keys.py`).

---

## 2. 샌드박스 수명주기 관리 (Sandbox Lifecycle)

```bash
# 1. 샌드박스 이미지 빌드 및 생성
docker build -t cualign-sandbox:local -f Dockerfile.openshell .
openshell sandbox create --name cualign-server \
  --policy openshell/server-policy.yaml \
  --provider nvidia \
  --forward 8000 \
  -- cualign-sandbox:local

# 2. 실행 상태 및 헬스체크 확인
openshell status
curl -s http://localhost:8000/ui/  # HTTP 200 OK

# 3. 샌드박스 내 명령 실행 (Exec)
openshell sandbox exec -n cualign-server -- cualign plan "moderate 케이스 계획 짜줘"

# 4. 샌드박스 정지 및 삭제
openshell sandbox stop -n cualign-server
openshell sandbox delete -n cualign-server
```

---

## 3. 실측 검증 기록 (macOS · colima Docker · OpenShell 0.0.116)

| 검증 항목 | 공식 스펙 및 기대 동작 | 실측 결과 |
|---|---|:---:|
| **Lifecycle 기동** | `sandbox create` 및 포트 포워딩(`8000`) 정상 수립 | ✅ UI `http://127.0.0.1:8000/ui/` 200 정상 반환 |
| **NIM L7 Egress** | `integrate.api.nvidia.com`의 `POST /v1/chat/completions` 통과 | ✅ **22건 ALLOWED** (`[policy:nvidia_nim_chat engine:l7]`) |
| **비허용 아웃바운드** | 텔레메트리 등 외부 임의 접속 차단 | 🛡️ **3건 DENIED** (`events.telemetry.data.nvidia.com:443`) |
| **Landlock 코드 보호** | 샌드박스 내부에서 `/app` 코드 수정 시도 차단 | 🛡️ `Permission denied` (읽기 전용 보호 확인) |
| **출력 디렉터리 격리** | 생성된 계획 STL 및 JSON은 `/sandbox/out`에만 기록 | ✅ `/sandbox/out/plans` 쓰기 성공 |
