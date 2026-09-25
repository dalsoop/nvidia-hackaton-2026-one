"""An overloaded NVIDIA API stream (HTTP 200, one error line) is asked again instead of reaching the planner as an
empty answer. The client is the real ChatNVIDIA, the server a local fake (rails_fakes.FakeLLM)."""
import asyncio

import pytest
from langchain_nvidia_ai_endpoints import ChatNVIDIA

import cualign.agent.register  # noqa: F401  applies the patch the way the NAT plugin does
from cualign.agent import nim_stream_patch
from rails_fakes import FakeLLM


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(nim_stream_patch, "DELAYS", (0,) * len(nim_stream_patch.DELAYS))


def answer(fake):
    async def collect():
        llm = ChatNVIDIA(base_url=fake.base_url, model="fake/planner", api_key="fake")
        return "".join([chunk.content async for chunk in llm.astream("hi")])
    return asyncio.run(collect())


def test_overloaded_stream_is_asked_again():
    with FakeLLM("MARK-OK") as fake:
        fake.busy = 2
        assert answer(fake) == "MARK-OK"
    assert len(fake.requests) == 3


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
