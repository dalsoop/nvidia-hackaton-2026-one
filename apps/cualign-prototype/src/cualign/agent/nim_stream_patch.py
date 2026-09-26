"""Workaround for langchain-nvidia-ai-endpoints (1.4): an overloaded NIM stream becomes an empty answer.

When the NVIDIA API is overloaded it answers a streaming request with HTTP 200 and a single line,

    {"error": {"message": "Service temporarily overloaded", "code": 503}}

`_aggregate_msgs` raises only for errors marked "object": "error", so this one is yielded as a message with no
content. NAT's LLM retry sees no exception, and the ReAct agent reads the empty text as a parse failure, asks
again at once and ends the turn when its parse retries run out (measured and fixed this way in #6 by
hoddukzoa12: 24-31% of planner calls, 32 of 41 recovered on the first re-request).

This wraps the async stream: if its first message is a retryable error, or the request itself gets a retryable HTTP
status (the library raises "[429] ..."), the request is sent again after the configured delays. When those are used
up and `fallback_models` is set (#51), the same request goes once to each listed model before giving up. An error that
is not retryable, or one that outlasts everything, is logged and raises NIMStreamError.
Its message carries no status code or API text: NAT's retry matches codes and the text "429", and would run the
whole call again. A stream that started normally is passed through unchanged. Applied once at plugin import
(register.py).

A call that is not streamed (`aget_req`: the review's `ainvoke`) gets the same overload as a real HTTP status,
which `_try_raise_async` raises as `Exception("[503] ...")`. Nothing above it asks again: NAT's retry reads a
status only from an exception attribute or an int first argument, and nim_review has `num_retries: 1` anyway
(#34). Such a call is sent again after the configured request delays (inside the review's per-call budget) and
then the original exception is re-raised, as reviewer.py reads its "503". The rail verdicts do not pass through
here: Guardrails talks to NIM with its own client, whose re-asks are set in guardrails/config.yml.

The delays, codes and fallback models are settings, not constants: configs/workflow.yml holds them under
`middleware.cualign_rails.nim_retry` (the middleware wraps every workflow call), and the middleware's build calls
`configure`. Until then, and in tests that use the client directly, the schema defaults apply.
"""
from __future__ import annotations

import asyncio
import logging
import re

from langchain_nvidia_ai_endpoints import _common
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class NimRetryConfig(BaseModel):
    """The NIM client's re-request policy. Values live in configs/workflow.yml; these defaults are the measured ones."""
    stream_delays: list[float] = Field(default=[1, 2, 4, 8, 16, 32],
                                       description="seconds to wait before each re-request of a streamed call (#6)")
    request_delays: list[float] = Field(default=[1, 2, 4],
                                        description="the same for calls that are not streamed (the review, #34)")
    retry_codes: list[int] = Field(default=[429, 500, 502, 503, 504],
                                   description="HTTP statuses / error codes that are asked again (NAT's own list)")
    fallback_models: list[str] = Field(default=[], description="after the streamed re-requests are used up, the same "
                                       "request goes once to each of these model names before failing (#51)")


# The live policy, read on every call so `configure` and tests (which zero the delays) take effect at once.
DELAYS: tuple[float, ...]
REQUEST_DELAYS: tuple[float, ...]
RETRY_CODES: set[int]
FALLBACK_MODELS: tuple[str, ...]
_STATUS = re.compile(r"^\[(\d{3})\]")  # _format_error starts every message with "[<status>]"


def configure(cfg: NimRetryConfig) -> None:
    global DELAYS, REQUEST_DELAYS, RETRY_CODES, FALLBACK_MODELS
    DELAYS, REQUEST_DELAYS = tuple(cfg.stream_delays), tuple(cfg.request_delays)
    RETRY_CODES, FALLBACK_MODELS = set(cfg.retry_codes), tuple(cfg.fallback_models)


configure(NimRetryConfig())


class NIMStreamError(RuntimeError):
    """The stream's first message was an error from the API."""


def apply() -> None:
    client_cls = _common._NVIDIAAsyncClient
    if getattr(client_cls, "_cualign_patched", False):
        return
    original = client_cls.aget_req_stream

    async def aget_req_stream(self, payload, *args, **kwargs):
        # Request k goes to the primary model while k <= len(DELAYS) + 1; the ones after that go to the fallback
        # models in turn, at once (no wait between the last primary request and the first fallback).
        primary = payload.get("model") if isinstance(payload, dict) else None
        models = [primary, *FALLBACK_MODELS]
        waits = (*DELAYS, *([0] * len(FALLBACK_MODELS)), None)
        for attempt, delay in enumerate(waits, 1):
            model = models[max(0, attempt - 1 - len(DELAYS))]
            body = payload if model == primary else {**payload, "model": model}
            stream = original(self, body, *args, **kwargs)
            try:
                try:
                    first = await anext(stream, None)
                except Exception as e:
                    # The same overload can also come as a real HTTP status before any line; the library raises it
                    # as "[429] ..." and nothing above asks again (9/25 live: a 429 ended a scenario at once).
                    status = _STATUS.match(str(e))
                    if not status or int(status.group(1)) not in RETRY_CODES:
                        raise
                    error = {"code": int(status.group(1)), "message": str(e)}
                else:
                    error = first.get("error") if isinstance(first, dict) and "content" not in first else None
                    if not isinstance(error, dict):
                        if model != primary:
                            logger.warning("cuAlign: NIM stream answered by fallback model %s on request %d",
                                           model, attempt)
                        if first is not None:
                            yield first
                        async for msg in stream:
                            yield msg
                        return
                    async for _ in stream:  # read to the end as before; closing early leaves aiohttp an unreleased connection
                        pass
            finally:
                await stream.aclose()
            if delay is None or error.get("code") not in RETRY_CODES:
                logger.error("cuAlign: NIM stream answered %s on request %d (model %s); giving up",
                             error, attempt, model)
                raise NIMStreamError(f"NIM stream failed after {attempt} request(s); the API error is in the log")
            next_model = models[max(0, attempt - len(DELAYS))]
            logger.warning("cuAlign: NIM stream answered %s; asking %s in %ss (%d/%d)", error,
                           "again" if next_model == model else f"fallback model {next_model}", delay, attempt,
                           len(waits) - 1)
            await asyncio.sleep(delay)

    original_req = client_cls.aget_req

    async def aget_req(self, *args, **kwargs):
        for attempt, delay in enumerate((*REQUEST_DELAYS, None), 1):
            try:
                return await original_req(self, *args, **kwargs)
            except Exception as e:
                status = _STATUS.match(str(e))
                if delay is None or not status or int(status.group(1)) not in RETRY_CODES:
                    raise
                logger.warning("cuAlign: NIM request answered %s; asking again in %ss (%d/%d)",
                               status.group(0), delay, attempt, len(REQUEST_DELAYS))
            await asyncio.sleep(delay)

    client_cls.aget_req_stream = aget_req_stream
    client_cls.aget_req = aget_req
    client_cls._cualign_patched = True
