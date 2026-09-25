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
The output is still checked after the answer, as before: a blocked answer gets a warning appended. A streamed
answer has already left when the output verdict arrives, so there the refusal can only follow it.
"""
from __future__ import annotations

import importlib
import logging
import os
from collections.abc import AsyncIterator
from contextvars import ContextVar
from typing import Any

from pydantic import Field

from nat.builder.builder import Builder
from nat.cli.register_workflow import register_middleware
from nat.data_models.api_server import ChatResponse, ChatResponseChunk, Usage
from nat.data_models.middleware import FunctionMiddlewareBaseConfig
from nat.middleware.function_middleware import FunctionMiddleware

from cualign.agent.context import CURRENT_RUN
from cualign.server.rails import REFUSAL, ROOT

logger = logging.getLogger(__name__)
OUTPUT_WARNING = "\n\n⚠ 출력 레일: 이 답변에 확정 진단·처방 성격의 문장이 있어 차단 대상으로 표시됐습니다. 초안으로만 읽어 주세요."
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


def last_user_text(value: Any) -> str:
    """The last non-empty user message. An empty last message must not let earlier text skip the rail."""
    if isinstance(getattr(value, "input_message", None), str):
        return value.input_message.strip()
    for m in reversed(getattr(value, "messages", None) or []):
        if getattr(m, "role", None) != "user":
            continue
        c = m.content
        text = c if isinstance(c, str) else " ".join(getattr(p, "text", "") for p in c or [])
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


class RailsMiddleware(FunctionMiddleware):

    def __init__(self, rails: Any | None, fail_closed: bool):
        super().__init__()
        self.rails = rails
        self.fail_closed = fail_closed

    async def _check_input(self, value: Any) -> tuple[str, str, str | None]:
        """Returns (user text, turn state, refusal or None)."""
        if self.rails is None:
            return "", _record("input", "off"), None
        user = last_user_text(value)
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
        return user, _record("input", state), REFUSAL if refuse else None

    async def _check_output(self, user: str, answer: str, prev: str) -> str | None:
        """Returns what must replace or follow the answer: REFUSAL, OUTPUT_WARNING, or None."""
        if self.rails is None or not answer.strip():
            return None
        try:
            status, _ = await self.rails.check_output(user, answer)
        except Exception as e:
            logger.error("cuAlign rails: output check failed: %s", e)
            status = "ERROR"
        state = {"BLOCKED": "blocked", "ERROR": "error"}.get(status, "passed")
        if state == "error":
            logger.error("cuAlign rails: output rail ERROR — %s", "refused" if self.fail_closed else "answer unchecked")
        _record("output", state, prev)
        if state == "error" and self.fail_closed:
            return REFUSAL
        return OUTPUT_WARNING if state == "blocked" else None

    async def function_middleware_invoke(self, *args: Any, call_next, context, **kwargs: Any) -> Any:
        value = args[0] if args else None
        user, state, refusal = await self._check_input(value)
        if refusal:
            return refusal_like(value, refusal)
        out = await call_next(*args, **kwargs)
        extra = await self._check_output(user, _text(out), state)
        if extra == REFUSAL:
            return refusal_like(value, REFUSAL)
        if extra:
            if isinstance(out, str):
                return out + extra
            out.choices[0].message.content = (out.choices[0].message.content or "") + extra
        return out

    async def function_middleware_stream(self, *args: Any, call_next, context, **kwargs: Any) -> AsyncIterator[Any]:
        user, state, refusal = await self._check_input(args[0] if args else None)
        if refusal:
            yield ChatResponseChunk.create_streaming_chunk(refusal)
            return
        parts = []
        async for chunk in call_next(*args, **kwargs):
            parts.append(_text(chunk))
            yield chunk
        extra = await self._check_output(user, "".join(parts), state)
        if extra:
            yield ChatResponseChunk.create_streaming_chunk("\n\n" + extra if extra == REFUSAL else extra)


def _import(path: str):
    module, _, name = path.partition(":")
    return getattr(importlib.import_module(module), name)


@register_middleware(config_type=RailsMiddlewareConfig)
async def cualign_rails(config: RailsMiddlewareConfig, _builder: Builder):
    from nat.utils.telemetry import config as nat_telemetry
    if nat_telemetry.TELEMETRY_ENABLED:
        logger.warning("NAT CLI telemetry is on; set NAT_TELEMETRY_ENABLED=0 to turn it off")
    fail_closed = os.environ.get("CUALIGN_RAILS_FAIL_CLOSED") == "1"
    off = None
    if os.environ.get("CUALIGN_GUARDRAILS", "1") == "0":
        off = "CUALIGN_GUARDRAILS=0"
    elif not os.environ.get("NVIDIA_API_KEY", "").startswith("nvapi-"):
        off = "NVIDIA_API_KEY is not set"
        if fail_closed:
            raise RuntimeError(f"cuAlign: Guardrails cannot start ({off}) and CUALIGN_RAILS_FAIL_CLOSED=1")
    if off:
        logger.error("cuAlign: Guardrails OFF (%s) — every turn runs without rails", off)
        yield RailsMiddleware(None, fail_closed)
        return
    # Guardrails usage stats go out when LLMRails is built unless this is set; a value set elsewhere is kept.
    if os.environ.setdefault("NEMO_GUARDRAILS_NO_USAGE_STATS", "1") != "1":
        logger.warning("NEMO_GUARDRAILS_NO_USAGE_STATS is set to another value; left as is")
    rails = _import(config.rails_factory)(config.rails_config_dir or ROOT / "guardrails",
                                          config.rails_model_base_url).load()
    logger.info("cuAlign: Guardrails ON for the workflow (fail-%s)", "closed" if fail_closed else "open")
    yield RailsMiddleware(rails, fail_closed)
