# HANDOFF — 세션 간 인계 (git-tracked, session-end 소유)

## 이어서 할 일
> 2026-09-28 세션 종료 시 기록

- #90 통합 이슈를 닫는다 — 오늘 갈래(#120~#149)가 전부 main. 보류 3건(스캔 경계 잇몸 트림, mesh 응답에서 원본 `gum` 제거, 앞니 밖 고유 회전 측정기 중단)을 닫기 댓글에 옮긴다.
- #75(규칙 폴백 버튼 자리)·#72(샘플 처방 계획 검증)를 확인해 닫는다 — 각각 #127·#148, #57(#143)로 해소.
- Orca 워크트리 4개(core-target·screen-v2·server-policy·screen-start)를 거둔다 — 브랜치 전부 머지됨. `~/projects/nvidia-hackaton-2026-one-wt/` 아래 5개(fdi·case-list·case-list-api·fast-tests·screen-flow-2)는 이전 세션 것이라 브랜치 머지 여부를 `git branch --merged main` 으로 보고 거둔다.
- PR #145(`/ui/v2`, dalsoop 다른 세션)와 #148 새 흐름 UI 의 겹침을 그 세션에서 판정한다.
- 429 가 잦아들면 `tests/nim_record_samples.py poseidon-000097 --only cap` 한 번 — 「상한 안이라 그대로」 문장이 든 답으로 교체(현재 녹화도 계획·조건은 정확).

### 현재 상태 / 주의점
- 커밋: main `f21b730`(#149) push 됨. 미커밋 잔여 없음. 오늘 머지 PR: #120 #123 #124 #125 #127 #128 #130 #131~#144 #146~#149.
- 열린 PR: #94(seo077, OpenShell 문서) · #145(dalsoop `/ui/v2`) — 이 세션 갈래 아님.
- 시연 기준 000097 「심한 덧니」: 27단계·약 6.2개월(순서 조정 스테이징 #144, 사용자가 단계 증가 수용), 녹화 5 step 전부 있음(#147). 시연 흐름: 케이스 열기(스캔만) → 「이 케이스의 처방 넣기」 칩 → 셋업 → 목표 → 단계 → 8개월 안에/비교 → 승인·내보내기, 각 턴 8초 뒤 「건너뛰기」.
- 계약 정본은 세션 보고에 있다: `orca/workspaces/…/server-policy/.report/15-step-flow.md`(step·step_done·targets·replay·export-status·PLANNER_VERSION), `core-target/apps/cualign-prototype/.report/8-ipr-cut.md`(mesh `teeth_cut`·`ipr_cut`), `12-ipr-surfaces.md`(`ipr_surfaces` FDI 입력·Universal 저장), `14-two-phase.md`(`phase_boundary`·`delays`). 워크트리를 거두기 전에 필요한 것은 `apps/cualign-prototype/docs/` 로 옮긴다.
- 저장 계획(`apps/cualign-prototype/out/plans`)은 계산 코어 지문이 다르면 샘플은 자동 폐기(#146). 8000 데모 서버는 main 체크아웃에서 `uv run --frozen python -m cualign.cli serve --port 8000`.
- `tests/browser_flow.py` 는 다른 무거운 실행과 겹치면 30초 대기가 초과된다 — 단독 실행. 실행은 `uv run --frozen --with playwright --with pytest python tests/browser_flow.py`(pytest 없으면 import 오류).
- NIM 키를 여러 세션이 동시에 쓰면 429 폭주로 후속 카드 null·검토 timeout — 시연 전엔 다른 세션의 NIM 호출을 멈춘다.
- 문서 위생 검사기(`scripts/doc_drift_check.py`)·`ROADMAP.md` 없음 — 해당 없음.
