"""The question card after each agent turn (#90): parsing, the tail of the conversation, and the endpoint."""
import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.agent import followup
from cualign.server import api


class FakeLLM:
    def __init__(self, text, delay=0):
        self.text, self.delay, self.calls = text, delay, []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        await asyncio.sleep(self.delay)
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


def test_tail_keeps_the_last_turns_only():
    msgs = [{"role": "system", "content": "ctx"}] + [{"role": "user", "content": "x" * 5000}] * 10
    t = followup.tail(msgs)
    assert len(t) == followup.MAX_TURNS and all(len(m["content"]) == followup.MAX_CHARS for m in t)


def test_next_question_sends_the_tail_and_parses():
    llm = FakeLLM(GOOD)
    q = asyncio.run(followup.next_question(llm, [{"role": "assistant", "content": "계획을 만들었습니다."}]))
    assert q["question"] == "발치 없이 갈까요?"
    assert llm.calls[0][0]["role"] == "system" and "계획을 만들었습니다." in llm.calls[0][1]["content"]


def test_next_question_is_none_on_timeout_or_empty():
    assert asyncio.run(followup.next_question(FakeLLM(GOOD, delay=0.2), [{"role": "user", "content": "a"}],
                                              timeout_seconds=0.01)) is None
    assert asyncio.run(followup.next_question(FakeLLM(GOOD), [])) is None


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
    assert "Never offer approval, export, download, hold" in followup.INSTRUCTIONS


# #107: ten sentences outside the demo script. `recorded` is the card the live model answered
# (tests/nim_followup_live_check.py writes out/nim-live/followup-10.json); None until that run.
OFF_SCRIPT = [
    ("14번은 움직이지 말고 다시 짜줘.", None),                       # lock a tooth (FDI)
    ("앞니 IPR은 빼고 해줘.", None),                                # IPR exclusion
    ("확장안이랑 IPR안 둘 다 만들어서 비교해줘.", None),            # compare strategies
    ("10개월 안에 끝나게 해줘.", None),                             # time cap
    ("발치 없이 가능해?", None),                                    # non-extraction question
    ("14번과 24번 발치로 다시 계획해줘.", None),                     # extraction prescription
    ("이 계획 단계가 너무 많은 것 같은데.", None),                   # vague complaint
    ("환자가 통증을 호소하는데 어떻게 해야 해?", None),              # off topic: clinical advice
    ("오늘 날씨 어때?", None),                                      # off topic: unrelated
    ("이거 승인하고 STL 뽑아줘.", None),                            # screen action asked in chat
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
