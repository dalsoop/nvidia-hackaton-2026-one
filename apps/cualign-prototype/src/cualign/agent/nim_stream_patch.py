"""Workaround for langchain-nvidia-ai-endpoints (1.4): an overloaded NIM stream becomes an empty answer.

When the NVIDIA API is overloaded it answers a streaming request with HTTP 200 and a single line,

    {"error": {"message": "Service temporarily overloaded", "code": 503}}

`_aggregate_msgs` raises only for errors marked "object": "error", so this one is yielded as a message with no
content. NAT's LLM retry sees no exception, and the ReAct agent reads the empty text as a parse failure, asks
again at once and ends the turn when its parse retries run out (measured and fixed this way in #6 by
hoddukzoa12: 24-31% of planner calls, 32 of 41 recovered on the first re-request).

This wraps the async stream: if its first message is a retryable error, the request is sent again after 1, 2,
4 ... seconds. An error that is not retryable, or one that outlasts the retries, is logged and raises NIMStreamError.
Its message carries no status code or API text: NAT's retry matches codes and the text "429", and would run the
whole call again. A stream that started normally is passed through unchanged. Applied once at plugin import
(register.py).

A call that is not streamed (`aget_req`: the review's `ainvoke`) gets the same overload as a real HTTP status,
which `_try_raise_async` raises as `Exception("[503] ...")`. Nothing above it asks again: NAT's retry reads a
status only from an exception attribute or an int first argument, and nim_review has `num_retries: 1` anyway
(#34). Such a call is sent again after 1, 2, 4 seconds — 7 s of waiting, inside the review's 20 s per call — and
then the original exception is re-raised, as reviewer.py reads its "503". The rail verdicts do not pass through
here: Guardrails talks to NIM with its own client, whose re-asks are set in guardrails/config.yml.
"""
from __future__ import annotations

import asyncio
import logging
import re

from langchain_nvidia_ai_endpoints import _common

logger = logging.getLogger(__name__)

DELAYS = (1, 2, 4, 8, 16, 32)  # seconds before each re-request (#6)
REQUEST_DELAYS = (1, 2, 4)  # the same for calls that are not streamed (#34)
RETRY_CODES = {429, 500, 502, 503, 504}  # NAT's own retry_on_status_codes
_STATUS = re.compile(r"^\[(\d{3})\]")  # _format_error starts every message with "[<status>]"


class NIMStreamError(RuntimeError):
    """The stream's first message was an error from the API."""


def apply() -> None:
    client_cls = _common._NVIDIAAsyncClient
    if getattr(client_cls, "_cualign_patched", False):
        return
    original = client_cls.aget_req_stream

    async def aget_req_stream(self, *args, **kwargs):
        for attempt, delay in enumerate((*DELAYS, None), 1):
            stream = original(self, *args, **kwargs)
            try:
                first = await anext(stream, None)
                error = first.get("error") if isinstance(first, dict) and "content" not in first else None
                if not isinstance(error, dict):
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
                logger.error("cuAlign: NIM stream answered %s on request %d; giving up", error, attempt)
                raise NIMStreamError(f"NIM stream failed after {attempt} request(s); the API error is in the log")
            logger.warning("cuAlign: NIM stream answered %s; asking again in %ss (%d/%d)",
                           error, delay, attempt, len(DELAYS))
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
