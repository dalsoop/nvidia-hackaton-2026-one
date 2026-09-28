"""Is this failure the NVIDIA API being overloaded? One classifier for the server (the UI notice, #51) and the golden
set runner (a "판정 불가" run, evals/golden_a/trace.py), so both see the same thing."""
from __future__ import annotations

import re

# A crashed turn is recorded as "<ExceptionType>: <message>" (evals runner.run_spec). The overload reaches it as
# NIMStreamError (nim_stream_patch: every streamed re-request overloaded) or as "[503] ..." / "[429] ..." from a call
# that is not streamed. Tool retries logged by NAT ("retry ...", "Tool call failed ...") are not crashes.
_CRASH = re.compile(r"^(?:[A-Za-z_][\w.]*)?(?:Error|Exception)\b: ")
_OVERLOAD = re.compile(r"NIMStreamError|\[(?:429|503)\]|\b(?:429|503)\b|overloaded|Too Many Requests|"
                       r"Service Unavailable|RateLimit", re.I)


def is_overload_crash(error: str) -> bool:
    """True for a crashed-turn record whose cause is the NVIDIA API being overloaded (#51)."""
    return bool(_CRASH.match(error) and _OVERLOAD.search(error))


def _chain(exc: BaseException):
    """Each exception down the cause chain as "<Type>: <message>" (NAT may wrap the client's error)."""
    seen: set[int] = set()
    e: BaseException | None = exc
    while e is not None and id(e) not in seen:
        seen.add(id(e))
        yield f"{type(e).__name__}: {e}"
        e = e.__cause__ or e.__context__


def is_overload_error(exc: BaseException) -> bool:
    """The same question for a live exception, looking down its cause chain."""
    return any(is_overload_crash(s) for s in _chain(exc))


# The NVIDIA API refusing the key: "[401] Unauthorized" (missing or wrong key, seen live 9/28) or "[403] Forbidden".
_AUTH = re.compile(r"\[40[13]\]|\bUnauthorized\b|\bForbidden\b")


def is_auth_error(exc: BaseException) -> bool:
    """True when the turn died because the NVIDIA API rejected the server's key, so the screen can say so."""
    return any(_AUTH.search(s) for s in _chain(exc))
