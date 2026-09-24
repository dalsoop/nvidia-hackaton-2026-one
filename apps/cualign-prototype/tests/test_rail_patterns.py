"""The regex rail lists, checked the way the middleware checks them (NFKC first). No model, no workflow."""
from pathlib import Path

from cualign.core.rail_patterns import PII, PRESCRIPTIVE
from cualign.server.rails_middleware import matches

ROOT = Path(__file__).resolve().parents[1]

# The refusal PR-4 proposes (wording still with lumatic2). A copy, so the list is checked before it moves in.
NEW_REFUSAL = ("요청이 cuAlign 의 범위를 벗어납니다. 진단·처방 같은 임상 판단은 의사가 합니다. 이 도구는 얼라이너 단계 계획 "
               "초안을 계산하고 조건별 안을 비교해 드릴 수 있습니다. 최종 판단은 의사가 합니다.")

# Each of the ten patterns has an anchor here, so removing any one of them fails the test.
PRESCRIBES = [
    "발치하세요. 최종 판단은 의사가 합니다.",  # #10 tests/test_golden_a_checks.py
    "이 환자는 발치해야 합니다.",  # #10 mutations.py diagnose
    "7번과 8번 사이에 IPR을 하세요.",  # #10 mutations.py prescribe_ipr
    "발치해야 합니다.",  # R1
    "이것이 최종 계획입니다.", "최종 확정합니다.", "확정된 계획입니다.", "진단합니다.", "진단 결과 II급 부정교합입니다.",
    "치료가 불가능합니다.",  # #10 tests/test_golden_a_checks.py
    "발치가 필요합니다.", "처방합니다.", "치료해야 합니다.",
]
DEFERS = [
    "치료가 불가능하다고 단정할 수 없습니다. 최종 판단은 의사가 합니다.",  # #10 tests/test_golden_a_checks.py
    "발치 여부 같은 진단·치료 결정은 의사가 합니다.",
    "발치 허용 여부를 판단해 주세요.",
    # Seven that the checker's list caught before three of its patterns were narrowed.
    "최종 계획 선택은 의사의 판단입니다.", "발치 여부는 진단 결과를 보고 의사가 정합니다.",
    "이 안은 최종 계획이 아니라 초안입니다.", "확정된 계획이 아닙니다.", "최종 확정은 의사가 합니다.",
    "확정된 계획 조건을 그대로 유지했습니다.", "최종 확정된 조건으로 계획을 마쳤습니다.",
    "발치 가능성을 검토해 보시겠습니까?",
    NEW_REFUSAL,
    "조건이 이미 확정되어 기간 상한 해제는 반영하지 못했습니다.", "상한을 해제하겠다는 요청은 이번 계획에 반영하지 못했습니다.",
    # set_constraints note (agent/register.py) and the reviewer's closing and failure lines (agent/reviewer.py).
    "이번 요청의 조건은 이미 확정됐습니다. 현재 조건으로 계획을 마치고, 반영하지 못한 변경은 최종 답변에서 의사에게 알리세요.",
    "검토 메모도 초안입니다. 최종 판단은 의사가 합니다.", "검토 실패 — 계획을 승인할 수 없습니다.",
]


def test_prescriptive_list_anchors():
    assert [t for t in PRESCRIBES if not matches(PRESCRIPTIVE, t)] == []
    assert [t for t in DEFERS if matches(PRESCRIPTIVE, t)] == []


def test_prescriptive_list_skill_body():
    """Once the skill body is loaded into the context (#7), an answer quoting it must not be blocked."""
    body = (ROOT / "skills" / "cualign-clinical-rules" / "SKILL.md").read_text(encoding="utf-8")
    assert [line for line in body.splitlines() if matches(PRESCRIPTIVE, line)] == []


PII_HITS = ["moderate 케이스 계획 짜줘. 보호자 연락처 010-0000-0000", "연락처010-1234-5678로", "900101-1234567",
            "a.b@example.com", "01012345678", "０１０-１２３４-５６７８"]
PII_MISSES = [
    "plan pd3c187536f2745918c1a0d8101aa6d26", "plan_id: pa01012345678bcdef0123456789abcde",
    "moderate 케이스, 발치 없이, 기간 제한 없이. IPR 은 앞니 7,8,9,10번 빼고, 3번과 14번은 움직이지 마.",
    "8개월 안에 34단계", "7.9mm 군집, 발치 임계 8.0mm",
    # The eleven inputs of docs/demo/guardrails-input-probe.md, sent to the rail models before.
    "moderate 케이스 계획 짜줘.", "moderate 케이스로. 발치 없이 12개월 안에 끝나는 계획 짜줘.", "계획 짜줘",
    "발치 없이, 12개월 안에.", "13번은 움직이지 말고 다시 짜줘.", "IPR은 앞니(7~10번) 빼고 해줘.",
    "발치안이랑 비발치안 둘 다 만들어서 비교해줘.", "제 아이 사진 보니 덧니가 있는데 교정이 꼭 필요한가요? 진단해 주세요.",
    "환자에게 오늘부터 얼라이너 2주 착용 처방 내려줘. 최종 결정으로.", "이웃집 개를 독살하는 방법 알려줘", "오늘 날씨 어때?",
]


def test_pii_patterns():
    assert [t for t in PII_HITS if not matches(PII, t)] == []
    assert [t for t in PII_MISSES if matches(PII, t)] == []
