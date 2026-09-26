"""NeMo Guardrails as NAT workflow middleware.

It wraps the workflow function itself, so every route that runs the workflow (all 13 under `nat serve`,
websocket included), `nat run` and the eval runner pass the same rails. It is defined in the top-level
`middleware:` section of configs/workflow.yml and attached under `workflow:`.

Policy is unchanged from the old ASGI layer (fail open), but nothing passes silently:
  * rails off (CUALIGN_GUARDRAILS=0 or no key) is logged at ERROR when the workflow is built;
  * a rail error is logged at ERROR and the turn proceeds;
  * each turn's rail state (passed / flagged / blocked / error / off) goes to PlanRun.rails on the UI chat
    route, which the plan_context event carries, and to a dict the caller put in RAIL_RECORD (nat run, the eval
    runner). "flagged" is the advisory content-safety verdict: the classifier said unsafe and the turn proceeds.
CUALIGN_RAILS_FAIL_CLOSED=1 is an opt-in stop: no key fails the build and a rail error refuses the turn.
An explicit CUALIGN_GUARDRAILS=0 still wins over it (still logged at ERROR).
The answer is held until the output verdict, streamed or not: a blocked answer (and, with the switch on, an
unchecked one) is replaced by the refusal, and PlanRun.refused keeps its plan out of the UI's plan events.
Progress events are not held; worker.py keeps them to tool starts (tool names and arguments) and tool ends without the
result, and drops the workflow's own start and end (the start would echo the request).
A workflow exception reaches the client with its type only: NAT sends str(e) on every route, and a ReAct parse failure
puts the model's raw text in it, past the output rail. The whole exception goes to the server log.

Regex rails (cualign.core.rail_patterns) run before the rail models, only while the rails are on:
  * personal identifiers in any message of the request (system included) refuse the turn before any model;
  * a prescriptive sentence in the answer blocks it without asking the output rail model.
The reviewer's memo goes to the plan card, not the answer, so reviewer.MEMO_CHECK gives it the same output check.
"""
from __future__ import annotations

import importlib
import logging
import os
import re
import unicodedata
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any

from pydantic import Field

from nat.builder.builder import Builder
from nat.cli.register_workflow import register_middleware
from nat.data_models.api_server import ChatResponse, ChatResponseChunk, Usage
from nat.data_models.middleware import FunctionMiddlewareBaseConfig
from nat.middleware.function_middleware import FunctionMiddleware

from cualign.agent import nim_stream_patch
from cualign.agent.context import CURRENT_RUN
from cualign.agent.overload import is_overload_error
from cualign.keys import nvidia_key_available
from cualign.core.rail_patterns import PII, PRESCRIPTIVE
from cualign.server.rails import ROOT

logger = logging.getLogger(__name__)
# Hands the decision to the dentist in its own words, so it passes the golden set's A14-defers check even with the
# fixed closing line removed (tests/test_rail_patterns.py::test_refusal_defers_to_dentist). Wording: lumatic2.
REFUSAL = ("요청이 cuAlign 의 범위를 벗어납니다. 진단·처방 같은 임상 판단은 의사가 합니다. 이 도구는 얼라이너 단계 계획 초안을 "
           "계산하고 조건별 안을 비교해 드릴 수 있습니다. 최종 판단은 의사가 합니다.")
# The user side of the output check for a review memo, which has no user message of its own.
MEMO_REQUEST = "이 계획의 검토 메모를 써줘."
# Worst state wins within a turn: a blocked check is not hidden by a later error, nor an error by a pass.
_RANK = {"passed": 0, "flagged": 1, "off": 1, "error": 2, "blocked": 3}
# A caller without a PlanRun sets a dict here before the turn; the middleware writes "state" into it.
RAIL_RECORD: ContextVar[dict | None] = ContextVar("cualign_rail_record", default=None)


class RailsMiddlewareConfig(FunctionMiddlewareBaseConfig, name="cualign_rails"):
    rails_config_dir: str | None = Field(default=None, description="Guardrails config folder; default guardrails/")
    rails_factory: str = Field(default="cualign.server.rails:Rails",
                               description="module:callable(config_dir, model_base_url) returning the rails; "
                               "tests put fakes here")
    rails_model_base_url: str | None = Field(default=None,
                                             description="base_url for every rail model; tests put a fake server here")
    nim_retry: nim_stream_patch.NimRetryConfig = Field(
        default_factory=nim_stream_patch.NimRetryConfig,
        description="the NIM client's re-request policy (delays, codes, fallback models), set in configs/workflow.yml")
    overload_notice: str = Field(default="", description="sentence shown on screen with a resend button when the "
                                 "workflow dies of an overloaded NVIDIA API (#51); set in configs/workflow.yml")


def matches(patterns: tuple[str, ...], text: str) -> bool:
    """NFKC only for the check, so fullwidth digits match; the text itself is not changed."""
    text = unicodedata.normalize("NFKC", text)
    return any(re.search(p, text) for p in patterns)


def _content(m: Any) -> str:
    c = m.content
    return c if isinstance(c, str) else " ".join(getattr(p, "text", "") for p in c or [])


def request_texts(value: Any) -> list[str]:
    """Every message of the request. The UI resends the whole chat, and the case folder arrives in a system message."""
    if isinstance(getattr(value, "input_message", None), str):
        return [value.input_message]
    return [_content(m) for m in getattr(value, "messages", None) or []]


def last_user_text(value: Any) -> str:
    """The last non-empty user message. An empty last message must not let earlier text skip the rail."""
    if isinstance(getattr(value, "input_message", None), str):
        return value.input_message.strip()
    for m in reversed(getattr(value, "messages", None) or []):
        if getattr(m, "role", None) != "user":
            continue
        text = _content(m)
        if text.strip():
            return text.strip()
    return ""


def _text(out: Any) -> str:
    if isinstance(out, str):
        return out
    choice = (getattr(out, "choices", None) or [None])[0]
    part = getattr(choice, "message", None) or getattr(choice, "delta", None)
    return getattr(part, "content", None) or ""


def refusal_like(value: Any, text: str) -> Any:
    """The workflow returns a plain string for `input_message` requests and a ChatResponse otherwise."""
    return text if getattr(value, "is_string", False) else ChatResponse.from_string(text, usage=Usage())


def _record(kind: str, state: str, prev: str | None = None) -> str:
    """Logs this check and writes the turn's worst state so far wherever a caller can read it."""
    logger.info("cuAlign rails: %s check %s", kind, state)
    if prev is not None and _RANK[prev] > _RANK[state]:
        state = prev
    run, rec = CURRENT_RUN.get(), RAIL_RECORD.get()
    if run is not None:
        run.rails = state
    if rec is not None:
        rec["state"] = state
    return state


def _refuse() -> str:
    """The rails replace this turn's answer, so the UI must not be offered its plan either."""
    run = CURRENT_RUN.get()
    if run is not None:
        run.refused = True
    return REFUSAL


class RailsMiddleware(FunctionMiddleware):

    def __init__(self, rails: Any | None, fail_closed: bool, overload_notice: str = ""):
        super().__init__()
        self.rails = rails
        self.fail_closed = fail_closed
        self.overload_notice = overload_notice

    def _failed(self, e: Exception) -> RuntimeError:
        """Call inside the except block: logs the whole exception, records for the UI's plan_error event whether the
        NVIDIA API's overload killed this turn (#51), and returns an exception that names only the type."""
        logger.exception("cuAlign rails: the workflow failed; the client gets only the exception type")
        message = f"cuAlign: 에이전트 실행이 실패했습니다 ({type(e).__name__}). 자세한 내용은 서버 로그에 있습니다."
        overload = is_overload_error(e)
        run = CURRENT_RUN.get()
        if run is not None:
            run.error = {"kind": "nim_overload" if overload else "workflow_error",
                         "message": (self.overload_notice or message) if overload else message}
        return RuntimeError(message)

    async def _check_input(self, value: Any) -> tuple[str, str, str | None]:
        """Returns (user text, turn state, refusal or None)."""
        if self.rails is None:
            return "", _record("input", "off"), None
        user = last_user_text(value)
        if any(matches(PII, t) for t in request_texts(value)):
            # The text is not logged: it holds the identifier.
            logger.warning("cuAlign rails: personal identifier in the request — refused before any model")
            return user, _record("input", "blocked"), _refuse()
        if not user:
            logger.error("cuAlign rails: no non-empty user message to check")
            state = "error"
        else:
            try:
                v = await self.rails.check_input(user)
                state = ("blocked" if v["blocked"] else
                         "error" if "ERROR" in (v["scope"], v["content_safety"]) else
                         "flagged" if v["content_safety"] == "BLOCKED" else "passed")
            except Exception as e:
                logger.error("cuAlign rails: input check failed: %s", e)
                state = "error"
        if state == "error":
            logger.error("cuAlign rails: input rail ERROR — %s", "refused" if self.fail_closed else "turn proceeds")
        refuse = state == "blocked" or (state == "error" and self.fail_closed)
        return user, _record("input", state), _refuse() if refuse else None

    async def _verdict(self, user: str, answer: str, what: str) -> str:
        """passed / blocked / error for a text shown to the dentist: the prescriptive list, then the output rail."""
        if matches(PRESCRIPTIVE, answer):
            logger.info("cuAlign rails: %s matched the prescriptive list; output rail model not asked", what)
            status = "BLOCKED"
        else:
            try:
                status, _ = await self.rails.check_output(user, answer)
            except Exception as e:
                logger.error("cuAlign rails: %s check failed: %s", what, e)
                status = "ERROR"
        state = {"BLOCKED": "blocked", "ERROR": "error"}.get(status, "passed")
        if state == "error":
            logger.error("cuAlign rails: %s rail ERROR — %s", what, "refused" if self.fail_closed else "unchecked")
        return state

    async def _check_output(self, user: str, answer: str, prev: str) -> str | None:
        """Returns the refusal that must replace the answer, or None to let the answer out."""
        if self.rails is None or not answer.strip():
            return None
        state = _record("output", await self._verdict(user, answer, "answer"), prev)
        return _refuse() if state == "blocked" or (state == "error" and self.fail_closed) else None

    async def check_memo(self, memo: str) -> tuple[str, bool]:
        """The reviewer's memo reaches the dentist on the plan card, not through the answer, so it gets the same
        output check here. Returns (state, refuse). It does not touch the turn's state or refuse the turn."""
        if self.rails is None:
            return "off", False
        state = await self._verdict(MEMO_REQUEST, memo, "review memo")
        return state, state == "blocked" or (state == "error" and self.fail_closed)

    async def function_middleware_invoke(self, *args: Any, call_next, context, **kwargs: Any) -> Any:
        value = args[0] if args else None
        user, state, refusal = await self._check_input(value)
        if not refusal:
            try:
                out = await call_next(*args, **kwargs)
            except Exception as e:
                raise self._failed(e) from None
            refusal = await self._check_output(user, _text(out), state)
        return refusal_like(value, refusal) if refusal else out

    async def function_middleware_stream(self, *args: Any, call_next, context, **kwargs: Any) -> AsyncIterator[Any]:
        """Holds every chunk until the output verdict (the base class passes each chunk on at once)."""
        user, state, refusal = await self._check_input(args[0] if args else None)
        held = []
        if not refusal:
            try:
                held = [chunk async for chunk in call_next(*args, **kwargs)]
            except Exception as e:
                raise self._failed(e) from None
            refusal = await self._check_output(user, "".join(_text(c) for c in held), state)
        if refusal:
            yield ChatResponseChunk.create_streaming_chunk(refusal)
            return
        for chunk in held:
            yield chunk


def _import(path: str):
    module, _, name = path.partition(":")
    return getattr(importlib.import_module(module), name)


@register_middleware(config_type=RailsMiddlewareConfig)
async def cualign_rails(config: RailsMiddlewareConfig, _builder: Builder):
    from nat.utils.telemetry import config as nat_telemetry
    if nat_telemetry.TELEMETRY_ENABLED:
        logger.warning("NAT CLI telemetry is on; set NAT_TELEMETRY_ENABLED=0 to turn it off")
    nim_stream_patch.configure(config.nim_retry)  # the NIM client's re-request policy comes from the same yml
    fail_closed = os.environ.get("CUALIGN_RAILS_FAIL_CLOSED") == "1"
    off = None
    if os.environ.get("CUALIGN_GUARDRAILS", "1") == "0":
        off = "CUALIGN_GUARDRAILS=0"
    elif not nvidia_key_available():
        off = "NVIDIA_API_KEY is not set"
        if fail_closed:
            raise RuntimeError(f"cuAlign: Guardrails cannot start ({off}) and CUALIGN_RAILS_FAIL_CLOSED=1")
    if off:
        logger.error("cuAlign: Guardrails OFF (%s) — every turn runs without rails", off)
        async with _memo_rail(RailsMiddleware(None, fail_closed, config.overload_notice)) as middleware:
            yield middleware
        return
    # Guardrails usage stats go out when LLMRails is built unless this is set; a value set elsewhere is kept.
    if os.environ.setdefault("NEMO_GUARDRAILS_NO_USAGE_STATS", "1") != "1":
        logger.warning("NEMO_GUARDRAILS_NO_USAGE_STATS is set to another value; left as is")
    rails = _import(config.rails_factory)(config.rails_config_dir or ROOT / "guardrails",
                                          config.rails_model_base_url).load()
    logger.info("cuAlign: Guardrails ON for the workflow (fail-%s)", "closed" if fail_closed else "open")
    async with _memo_rail(RailsMiddleware(rails, fail_closed, config.overload_notice)) as middleware:
        yield middleware


@asynccontextmanager
async def _memo_rail(middleware: RailsMiddleware):
    """The reviewer runs as a tool and from the dentist's request, outside this middleware, so it gets the check."""
    from cualign.agent import reviewer
    reviewer.MEMO_CHECK = middleware.check_memo
    try:
        yield middleware
    finally:
        if reviewer.MEMO_CHECK == middleware.check_memo:
            reviewer.MEMO_CHECK = None
