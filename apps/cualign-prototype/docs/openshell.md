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
