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
"""
from __future__ import annotations

import asyncio
import logging

from langchain_nvidia_ai_endpoints import _common

logger = logging.getLogger(__name__)

DELAYS = (1, 2, 4, 8, 16, 32)  # seconds before each re-request (#6)
RETRY_CODES = {429, 500, 502, 503, 504}  # NAT's own retry_on_status_codes


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
            finally:
                await stream.aclose()
            if delay is None or error.get("code") not in RETRY_CODES:
                logger.error("cuAlign: NIM stream answered %s on request %d; giving up", error, attempt)
                raise NIMStreamError(f"NIM stream failed after {attempt} request(s); the API error is in the log")
            logger.warning("cuAlign: NIM stream answered %s; asking again in %ss (%d/%d)",
                           error, delay, attempt, len(DELAYS))
            await asyncio.sleep(delay)

    client_cls.aget_req_stream = aget_req_stream
    client_cls._cualign_patched = True
