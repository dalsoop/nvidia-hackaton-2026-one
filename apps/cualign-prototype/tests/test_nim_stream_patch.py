"""An overloaded NVIDIA API stream (HTTP 200, one error line) is asked again instead of reaching the planner as an
empty answer, and an overloaded call that is not streamed (a real HTTP 503: the review) is asked again instead of
failing at once. The client is the real ChatNVIDIA, the server a local fake (rails_fakes.FakeLLM)."""
import asyncio
import gc

import pytest
from langchain_nvidia_ai_endpoints import ChatNVIDIA

import cualign.agent.register  # noqa: F401  applies the patch the way the NAT plugin does
from cualign.agent import nim_stream_patch
from rails_fakes import FakeLLM


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(nim_stream_patch, "DELAYS", (0,) * len(nim_stream_patch.DELAYS))
    monkeypatch.setattr(nim_stream_patch, "REQUEST_DELAYS", (0,) * len(nim_stream_patch.REQUEST_DELAYS))


def answer(fake):
    async def collect():
        llm = ChatNVIDIA(base_url=fake.base_url, model="fake/planner", api_key="fake")
        text = "".join([chunk.content async for chunk in llm.astream("hi")])
        del llm
        gc.collect()  # while the loop runs, so a connection dropped unreleased logs "Unclosed connection"
        return text
    return asyncio.run(collect())


def test_overloaded_stream_is_asked_again():
    with FakeLLM("MARK-OK") as fake:
        fake.busy = 2
        assert answer(fake) == "MARK-OK"
    assert len(fake.requests) == 3


def test_overload_answer_is_read_to_its_end(caplog):
    """The live server logged "Unclosed connection" after re-requests: the overload answer was closed before its
    stream ended. Here the fake keeps it open a moment after the error line."""
    with FakeLLM("MARK-OK") as fake:
        fake.busy, fake.busy_hold = 2, 0.3
        assert answer(fake) == "MARK-OK"
    assert "Unclosed connection" not in caplog.text


def test_overload_that_outlasts_the_retries_raises(caplog):
    """429 is the case to watch: NAT's own retry runs the whole call again when the message says "429"."""
    with FakeLLM("MARK-OK") as fake:
        fake.busy, fake.busy_error = 99, {"message": "Too Many Requests", "code": 429}
        with pytest.raises(nim_stream_patch.NIMStreamError) as raised:
            answer(fake)
    assert len(fake.requests) == len(nim_stream_patch.DELAYS) + 1
    assert "429" not in str(raised.value) and "Too Many" not in str(raised.value)
    assert "Too Many Requests" in caplog.text  # the API error goes to the log


def test_error_that_is_not_retryable_raises_at_once(caplog):
    with FakeLLM("MARK-OK") as fake:
        fake.busy, fake.busy_error = 99, {"message": "MARK-BAD request", "code": 400}
        with pytest.raises(nim_stream_patch.NIMStreamError):
            answer(fake)
    assert len(fake.requests) == 1
    assert "MARK-BAD" in caplog.text


def whole_answer(fake):
    """The call as reviewer.py makes it: not streamed."""
    async def call():
        llm = ChatNVIDIA(base_url=fake.base_url, model="fake/review", api_key="fake")
        return (await llm.ainvoke("hi")).content
    return asyncio.run(call())


def test_overloaded_request_is_asked_again():
    with FakeLLM("MARK-OK") as fake:
        fake.busy = 2
        assert whole_answer(fake) == "MARK-OK"
    assert len(fake.requests) == 3


def test_overloaded_request_that_outlasts_the_retries_raises_the_api_error():
    """The original exception is kept: reviewer.py labels the failure by the "503" in it."""
    with FakeLLM("MARK-OK") as fake:
        fake.busy = 99
        with pytest.raises(Exception, match=r"^\[503\]"):
            whole_answer(fake)
    assert len(fake.requests) == len(nim_stream_patch.REQUEST_DELAYS) + 1


def test_request_error_that_is_not_retryable_raises_at_once():
    with FakeLLM("MARK-OK") as fake:
        fake.busy, fake.busy_error = 99, {"message": "MARK-BAD request", "code": 400}
        with pytest.raises(Exception, match=r"^\[400\]"):
            whole_answer(fake)
    assert len(fake.requests) == 1
