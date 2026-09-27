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
