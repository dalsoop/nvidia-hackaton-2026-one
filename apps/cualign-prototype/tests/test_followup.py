"""The question card after each agent turn (#90): parsing, the tail of the conversation, and the endpoint."""
import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.agent import followup
from cualign.server import api


class FakeLLM:
    def __init__(self, text, delay=0, delays=None):
        self.text, self.delay, self.delays, self.calls = text, delay, list(delays or []), []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        await asyncio.sleep(self.delays.pop(0) if self.delays else self.delay)   # `delays`: per call, then `delay`
        return self.text


GOOD = '{"question": "발치 없이 갈까요?", "options": [{"label": "발치 없이", "message": "발치 없이 다시 짜줘."}, ' \
       '{"label": "발치 허용", "message": "발치 허용해서 짜줘."}, {"label": "비교", "message": "둘 다 비교해줘."}, ' \
       '{"label": "넷째", "message": "넷째 선택"}]}'


def test_parse_takes_the_json_and_trims_options():
    q = followup.parse("Sure, here it is:\n" + GOOD + "\nDone.")
    assert q["question"] == "발치 없이 갈까요?"
    assert [o["label"] for o in q["options"]] == ["발치 없이", "발치 허용", "비교"]   # at most three


def test_parse_rejects_what_is_not_a_question():
    assert followup.parse("계획을 만들었습니다.") is None
    assert followup.parse('{"question": "?", "options": [{"label": "하나", "message": "x"}]}') is None   # one option
    assert followup.parse('{"question": "", "options": []}') is None
    assert followup.parse('{"question": "q", "options": [{"label": "a"}, {"label": "b", "message": ""}]}') is None


def test_tail_keeps_the_last_answer_and_the_sentence_that_asked_for_it():
    """The E2E conversation (three turns) made nim_lightning time out at 60 s; the card needs the last answer only."""
    msgs = [{"role": "system", "content": "ctx"}]
    for i in range(3):
        msgs += [{"role": "user", "content": f"요청 {i} " + "u" * 5000}, {"role": "assistant", "content": f"답 {i} " + "a" * 5000}]
    t = followup.tail(msgs)
    assert [m["role"] for m in t] == ["user", "assistant"] and t[0]["content"].startswith("요청 2") and t[1]["content"].startswith("답 2")
    assert len(t[0]["content"]) == followup.MAX_USER_CHARS and len(t[1]["content"]) == followup.MAX_ANSWER_CHARS
    assert sum(len(m["content"]) for m in t) <= followup.MAX_CHARS and len(t) == followup.MAX_TURNS
    # the screen's slice(-8) with the dentist's sentence after the answer: the answer and the sentence before it
    t = followup.tail(msgs + [{"role": "user", "content": "뒤에 온 문장"}])
    assert t[0]["content"].startswith("요청 2") and t[1]["content"].startswith("답 2")
    assert followup.tail([{"role": "user", "content": "첫 문장"}]) == [{"role": "user", "content": "첫 문장"}]   # no answer yet
    assert followup.tail([{"role": "assistant", "content": "답만"}]) == [{"role": "assistant", "content": "답만"}]
    assert followup.tail([{"role": "system", "content": "ctx"}]) == []


def test_next_question_sends_the_tail_and_parses():
    llm = FakeLLM(GOOD)
    q = asyncio.run(followup.next_question(llm, [{"role": "assistant", "content": "계획을 만들었습니다."}]))
    assert q["question"] == "발치 없이 갈까요?"
    assert llm.calls[0][0]["role"] == "system" and "계획을 만들었습니다." in llm.calls[0][1]["content"]


def test_next_question_is_none_on_timeout_or_empty():
    llm = FakeLLM(GOOD, delay=0.2)
    assert asyncio.run(followup.next_question(llm, [{"role": "user", "content": "a"}], timeout_seconds=0.03)) is None
    assert len(llm.calls) == 2   # the hedge fired too, and both were given up at the deadline
    assert asyncio.run(followup.next_question(FakeLLM(GOOD), [])) is None


def test_a_hung_first_call_is_hedged_by_a_second_within_the_budget():
    """Live 2026-09-28: 3 of 9 nim_lightning calls never answered, whatever the input; the next request did.
    A first call silent past `hedge_after` gets a second one, and the first answer is the card. A quick first
    answer means one call only."""
    msgs = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "계획을 만들었습니다."}]
    llm = FakeLLM(GOOD, delays=[10, 0.01])
    q = asyncio.run(followup.next_question(llm, msgs, timeout_seconds=1, hedge_after=0.05))
    assert q["question"] == "발치 없이 갈까요?" and len(llm.calls) == 2
    llm = FakeLLM(GOOD, delay=0.01)
    assert asyncio.run(followup.next_question(llm, msgs, timeout_seconds=1, hedge_after=0.5)) and len(llm.calls) == 1
    llm = FakeLLM(GOOD, delays=[10, 10])   # both silent: no card, no error, inside the budget
    assert asyncio.run(followup.next_question(llm, msgs, timeout_seconds=0.3, hedge_after=0.05)) is None
    assert followup.HEDGE_AFTER < 12


def test_endpoint_without_a_model_returns_no_card():
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as client:
        assert client.post("/api/followup", json={"messages": [{"role": "user", "content": "a"}]}).json() == {"question": None}


def test_endpoint_returns_the_card():
    async def fake(messages):
        return {"question": "다음은?", "options": [{"label": "a", "message": "A"}, {"label": "b", "message": "B"}]}
    app = FastAPI()
    api.add_api_routes(app, followup=fake)
    with TestClient(app) as client:
        body = client.post("/api/followup", json={"messages": [{"role": "user", "content": "a"}]}).json()
        assert body["question"]["question"] == "다음은?" and len(body["question"]["options"]) == 2


def test_parse_drops_choices_the_screen_does_with_buttons():
    """#107: approval, export, hold and re-review are buttons, never chips; a card left with one choice is no card."""
    text = ('{"question": "다음은?", "options": [{"label": "이대로 승인", "message": "이 계획을 승인해줘."}, '
            '{"label": "STL 내보내기", "message": "내보내줘."}, {"label": "보류", "message": "보류할게."}, '
            '{"label": "14번 고정", "message": "14번은 움직이지 말고 다시 짜줘."}, '
            '{"label": "비교", "message": "확장안과 IPR안 비교해줘."}]}')
    assert [o["label"] for o in followup.parse(text)["options"]] == ["14번 고정", "비교"]
    one_left = '{"question": "q", "options": [{"label": "승인", "message": "승인"}, {"label": "고정", "message": "고정해줘"}]}'
    assert followup.parse(one_left) is None
    english = '{"question": "What next?", "options": [{"label": "a", "message": "A"}, {"label": "b", "message": "B"}]}'
    assert followup.parse(english) is None   # live case 6 answered in English: no card
    junk = "{\nellsellsion\n" + GOOD   # live case 4: a stray brace and garbage before the JSON
    assert followup.parse(junk)["question"] == "발치 없이 갈까요?"
    assert "Never offer approval, export, download, hold" in followup.INSTRUCTIONS


# #107: ten sentences outside the demo script. `recorded` is the card the live model answered
# (tests/nim_followup_live_check.py writes out/nim-live/followup-10.json); None until that run.
OFF_SCRIPT = [   # (sentence, card the live model wrote on 2026-09-28, 4th run of nim_followup_live_check.py)
    ("14번은 움직이지 말고 다시 짜줘.",
     {"question": "어떤 치아를 고정(잠금)할까요?", "options": [{"label": "전치부 고정", "message": "11, 12, 21, 22 고정"}, {"label": "전후치 고정", "message": "11~16, 21~26 고정"}, {"label": "고정 없음", "message": "전체 이동 가능"}]}),
    ("앞니 IPR은 빼고 해줘.",
     {"question": "어떤 조건을 우선순위로 할까요?", "options": [{"label": "IPR 0.2mm", "message": "IPR을 면당 0.2mm으로 제한하고 진행합니다."}, {"label": "전체 IPR 삭제", "message": "IPR을 전면 삭제하고 진행합니다."}, {"label": "확장 폭 조정", "message": "양측 확장 폭을 조정하고 진행합니다."}]}),
    ("확장안이랑 IPR안 둘 다 만들어서 비교해줘.",
     {"question": "어떤 전략을 우선할까요?", "options": [{"label": "확장 우선", "message": "확장 전략만 적용해 주세요."}, {"label": "IPR 우선", "message": "IPR 전략만 적용해 주세요."}, {"label": "확장 + IPR", "message": "확장과 IPR을 동시에 적용해 주세요."}]}),
    ("10개월 안에 끝나게 해줘.",
     {"question": "10개월 내에 계획을 마무리하려면 어떤 조건을 조정할까요?", "options": [{"label": "전체 기간 연장", "message": "10개월 제한을 없애고 현재 3.2개월 계획 그대로 진행합니다."}, {"label": "IPR 강화", "message": "IPR 한도를 면당 0.5mm로 올려 공간을 확보해 10개월 내 마무리합니다."}, {"label": "발치 포함", "message": "공간 부족을 해결하기 위해 발치 치아를 포함해 10개월 내 마무리합니다."}]}),
    ("발치 없이 가능해?",
     {"question": "어떤 조건을 우선할까요?", "options": [{"label": "IPR 0.25mm 제한", "message": "IPR를 0.25mm 이내로 제한하고 진행합니다."}, {"label": "전체 3개월 제한", "message": "전체 치료 기간을 3개월 이내로 제한합니다."}, {"label": "앞니 4개 고정", "message": "앞니 4개(11, 12, 21, 22)를 이동 범위에서 제외합니다."}]}),
    ("14번과 24번 발치로 다시 계획해줘.",
     {"question": "어떤 조건을 기준으로 14번과 24번 발치 계획을 세울까요?", "options": [{"label": "전체 기간 12개월 제한", "message": "14번과 24번을 발치하고 전체 치료 기간을 12개월 이내로 제한해 주세요."}, {"label": "앞니 IPR 제외", "message": "14번과 24번을 발치하고 앞니에 IPR를 적용하지 않도록 해 주세요."}, {"label": "양쪽 첫 번째 소구치 공간 확보", "message": "14번과 24번을 발치하고 양쪽 첫 번째 소구치에 공간을 확보해 주세요."}]}),
    ("이 계획 단계가 너무 많은 것 같은데.",
     {"question": "어떤 조건을 조정하시겠습니까?", "options": [{"label": "단계 수 감소", "message": "단계 수를 줄이고 전체 치료 기간을 단축하세요."}, {"label": "IPR 한도 조정", "message": "IPR 한도를 0.25mm 이하로 조정하거나 특정 치아에 IPR를 적용하지 않도록 설정하세요."}, {"label": "확장 범위 조정", "message": "양측 확장량을 조정하거나 특정 치아에만 확장 적용 여부를 선택하세요."}]}),
    ("환자가 통증을 호소하는데 어떻게 해야 해?",
     {"question": "통증 관리 전략을 결정해 주세요.", "options": [{"label": "통증 완화", "message": "통증 완화 계획을 세워 주세요."}, {"label": "통증 일지", "message": "통증 일지를 기록해 주세요."}, {"label": "통증 검토", "message": "통증 검토를 진행해 주세요."}]}),
    ("오늘 날씨 어때?",
     {"question": "다음 단계에서 어떤 조건을 조정하시겠습니까?", "options": [{"label": "IPR 범위 확대", "message": "IPR 범위를 넓혀 치아 이동을 더 확보하고 싶습니다."}, {"label": "확장 폭 조절", "message": "양측 확장 폭을 현재 1.1mm에서 조정하고 싶습니다."}, {"label": "단계 수 제한", "message": "총 단계 수나 치료 기간을 특정 개월 이내로 제한하고 싶습니다."}]}),
    ("이거 승인하고 STL 뽑아줘.",
     {"question": "계획의 우선순위를 결정해 주세요.", "options": [{"label": "확장 우선", "message": "확장 전략을 최우선으로 적용해 주세요."}, {"label": "IPR 우선", "message": "IPR 범위를 넓혀 치아 이동을 우선시해 주세요."}, {"label": "균형 적용", "message": "확장과 IPR를 균형 있게 적용해 주세요."}]}),
]


def test_off_script_recorded_cards_are_planning_choices():
    """Whatever the live model answered for OFF_SCRIPT must survive parse as 2..3 planning choices with no screen action."""
    import json
    import pytest
    recorded = [(s, r) for s, r in OFF_SCRIPT if r is not None]
    if not recorded:
        pytest.skip("no live cards recorded yet (run tests/nim_followup_live_check.py with .env)")
    for sentence, raw in recorded:
        card = followup.parse(json.dumps(raw, ensure_ascii=False))
        assert card is not None and 2 <= len(card["options"]) <= 3, sentence
        for o in card["options"]:
            assert not followup.SCREEN_ACTION_RE.search(o["label"] + o["message"]), (sentence, o)
