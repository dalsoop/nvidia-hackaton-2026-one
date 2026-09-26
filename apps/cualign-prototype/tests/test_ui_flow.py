"""화면 흐름 회귀 (#49): 환자 등록 → 스캔 업로드 → 입력 확인(좌우 번호 뒤집기) → 케이스 활성화 → 계획 시작.

static/app.js 가 부르는 순서와 요청 모양 그대로 실제 서버 경로(/api/*)를 타고, /chat/stream 은 가짜 계획 모델
(rails_fakes)로 대신한다. 키 없이 돈다. 입력과 기대값은 tests/fixtures/ui_flow.json 에서 읽는다.
"""
import json
from pathlib import Path
from uuid import uuid4

from cualign.core.constraints import Constraints
from rails_fakes import SkippingPlanner
from test_patients import _scan_files
from test_rails_middleware import plain, serve, sse_event, store  # noqa: F401  (store: pytest fixture)

DATA = json.loads((Path(__file__).with_name("fixtures") / "ui_flow.json").read_text(encoding="utf-8"))
EXPECT = DATA["expect"]
CONTEXT_PREFIX = "cuAlign server context: "   # plan_events.open_run 이 에이전트에게 주는 시스템 메시지의 머리


def server_context(request):
    """가짜 모델이 받은 요청에서 서버 문맥을 찾아 JSON 으로 돌려준다 (없으면 None). NAT ReAct 는 주입된 시스템
    메시지를 사용자 메시지의 «Previous conversation history» 안에 넣어 보내므로 역할이 아니라 내용으로 찾는다."""
    for m in request["messages"]:
        content = str(m.get("content", ""))
        at = content.find(CONTEXT_PREFIX)
        if at >= 0:
            return json.JSONDecoder().raw_decode(content, at + len(CONTEXT_PREFIX))[0]
    return None


def test_patient_registration_to_plan_start(store, tmp_path, monkeypatch):
    with SkippingPlanner() as llm, serve(tmp_path, monkeypatch, llm) as client:
        # 1. 환자 등록 (가명, 식별정보 없음)
        p = client.post("/api/patients", json=DATA["patient"]).json()
        pid = p["patient_id"]
        assert p["scans"] == []

        # 2. 번호가 좌우로 뒤집힌 합성 스캔 업로드 → 입력 확인 화면은 «확인 필요»
        flipped = _scan_files(gum=True, rename=lambda u: DATA["reversed_numbering_sum"] - u)
        scan = client.post(f"/api/patients/{pid}/scans", files=flipped).json()
        sid, case_id = scan["scan_id"], scan["case_id"]
        assert scan["orientation"]["side"] == EXPECT["side_before_mirror"]
        check = client.get(f"/api/cases/{case_id}/check").json()
        assert check["confirmed"] is False and check["revision"] == 1

        # 게이트: 확인 전에는 어느 계획 경로도 열리지 않는다 (규칙 폴백 = 화면의 «규칙 기반 폴백» 버튼)
        blocked = client.post("/api/plan", json={"case_id": case_id})
        assert blocked.status_code == 400 and EXPECT["gate_message"] in blocked.json()["detail"]

        # 3. 좌우 번호 뒤집기 → 새 revision, 확인 해제 (mirrorBtn)
        scan_url = f"/api/patients/{pid}/scans/{sid}"
        fixed = client.post(f"{scan_url}/mirror").json()
        assert fixed["orientation"]["side"] == EXPECT["side_after_mirror"]
        assert fixed["revision"] == EXPECT["revision_after_mirror"] and fixed["confirmed"] is False
        assert fixed["teeth"] == EXPECT["teeth"]
        # 화면이 뒤처진 revision 으로 확인하면 거절 (startPlan 은 화면의 revision 을 보낸다)
        assert client.post(f"{scan_url}/confirm", json={"revision": check["revision"]}).status_code == 409

        # 4. 번호 확인 — 계획 시작 (startPlan: confirm(revision) → activateCase)
        confirmed = client.post(f"{scan_url}/confirm", json={"revision": fixed["revision"]})
        assert confirmed.status_code == 200 and confirmed.json()["confirmed_at"]
        assert client.get(f"/api/cases/{case_id}/check").json()["confirmed"] is True

        # 5. 케이스 활성화 → 목록의 active, 폼 초기값(fillConstraints)
        info = client.post(f"/api/cases/{case_id}/activate").json()
        assert client.get("/api/cases").json()["active"] == case_id
        assert info["n_teeth"] == EXPECT["n_teeth"]
        assert info["constraints"] == Constraints().model_dump(mode="json")

        # 6. 규칙 폴백으로 단계 상한을 저장하면 다시 열 때 폼에 그 값이 채워진다
        fallback = client.post("/api/plan", json={"case_id": case_id, "stage_cap": DATA["fallback_stage_cap"]}).json()
        assert fallback["case_id"] == case_id and fallback["tried"]
        info = client.post(f"/api/cases/{case_id}/activate").json()
        assert info["constraints"]["stage_cap"] == DATA["fallback_stage_cap"]

        # 7. 조건 폼 편집 뒤 전송 (send: readConstraints → body.cualign). 상한 칸을 비우면 clear_stage_cap.
        form = {**info["constraints"], **DATA["form"]}
        request_id = uuid4().hex
        res = client.post("/chat/stream", json={
            "messages": [{"role": "user", "content": DATA["request"]}],
            "cualign": {"request_id": request_id, "case_id": case_id, "base_plan_id": None, "constraints": form}})
        assert res.status_code == 200, res.text[:300]
        text = plain(res.text)

        # (a) 에이전트는 서버 문맥을 한 번 받고, 그 안의 조건이 폼 값이다
        assert str(llm.requests[0]["messages"]).count(CONTEXT_PREFIX) == 1
        context = server_context(llm.requests[0])
        assert context["case_id"] == case_id and context["base_plan_id"] is None
        assert context["constraints"] == EXPECT["constraints"]

        # (b) 스트림 끝의 plan_context 도 같은 조건이고, 상한은 비어 있다 (clear_stage_cap 이 서버에 닿았다)
        plan_context = sse_event(text, "plan_context")
        assert plan_context["request_id"] == request_id and plan_context["case_id"] == case_id
        assert plan_context["constraints"] == EXPECT["constraints"]
        assert plan_context["constraints"]["stage_cap"] is None

        # (c) 저장소의 케이스 조건도 같다
        assert store.case_constraints[case_id].model_dump(mode="json") == EXPECT["constraints"]

        # (d) 계획이 이 요청·이 케이스·확인된 revision 으로 만들어져 선택됐고, 서버 검토가 붙었다
        selected = sse_event(text, "plan_selected")
        assert selected["request_id"] == request_id and selected["case_id"] == case_id
        plan = store.plans[selected["plan_id"]]
        assert plan["case_id"] == case_id
        assert store.targets[plan["target_id"]]["input_revision"] == fixed["revision"]
        assert selected["review"]["status"] == EXPECT["review_status"]
