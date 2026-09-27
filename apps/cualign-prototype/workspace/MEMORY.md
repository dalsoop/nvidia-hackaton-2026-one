# MEMORY — 쓰지 않는다

이 워크스페이스는 장기 기억을 쓰지 않는다. `memory/` 폴더도 두지 않는다.

## 왜 쓰지 않는가

- 기억해야 할 것은 이미 서버에 있다. 확정 조건, 부모 계획, 검토 상태, 승인 상태는 cuAlign 서버가 저장한다. 요청마다
  서버 문맥(`case_id`, `base_plan_id`, 확정 조건)이 첫 시스템 메시지로 들어온다.
- 조건은 서버 문맥에서 읽는다. 대화 기억에서 조건을 되살리면 서버에 확정된 조건과 어긋날 수 있다. 그러면 조건이 몰래
  바뀌게 된다.
- 요청별 상태(`src/cualign/agent/context.py`의 `PlanRun`)는 요청이 끝나면 사라진다. 의도한 설계다.

## 지키는 규칙

- **환자를 식별할 수 있는 정보는 이 파일과 `memory/`에 절대 쓰지 않는다.** 이름, 전화번호, 주민등록번호, 생년월일,
  주소, 이메일, 이름과 묶인 차트 번호 모두 해당한다.
- 초안만 만든다. 진단하거나 처방하지 않는다.
- 금지된 조건을 몰래 풀지 않는다.
- 승인은 의사가 cuAlign 화면에서만 한다.

기억을 켜려면 팀이 결정해야 한다. 켜더라도 환자와 무관한 팀 선호만 적는다.

<!-- 출처: workspace/AGENTS.md(서버 문맥, "Never silently relax these constraints", 승인); src/cualign/agent/context.py
(PlanRun, 요청 로컬 ContextVar); guardrails/policy/cualign_clinical_scope_v1.0.0.md(PII/Privacy 범주); SECURITY.md(외부 전송). -->
