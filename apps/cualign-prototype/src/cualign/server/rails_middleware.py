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

Regex rails (cualign.server.rail_patterns) run before the rail models, only while the rails are on:
  * personal identifiers in any message of the request (system included) refuse the turn before any model;
  * a prescriptive sentence in the answer blocks it without asking the output rail model.
The reviewer's memo goes to the plan card, not the answer, so reviewer.MEMO_CHECK gives it the same output check.

The held answer also gets its rule status checked, with the rails on or off, since it is the plan's safety status and
not a rail verdict (#91). The answer opens with the selected plan's rule status (workflow.yml), and the planner has
written "규칙 위반은 없습니다" for a plan that failed validation. So on a UI turn (or a golden-set run) that selected a failed
plan, a clause of the opening that says no rule was broken is replaced with the plan's real status. A turn that compared
strategies is left as it is: its answer describes several plans, and a clause cannot be tied to one of them.
"""
from __future__ import annotations

import importlib
import logging
import os
import re
import unicodedata
from collections import Counter
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
from cualign.server.rail_patterns import PII, PRESCRIPTIVE
from cualign.core.store import STORE
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
# The violation names workflow.yml gives the planner for its rule status line, one per type core/planner.py emits
# (tests/test_rule_status.py fails when a type or a name is missing; a missing type would be written «기타»).
VIOLATION_KO = {"space_deficit": "공간 부족", "collision": "충돌", "move_limit": "이동량 초과", "rotation_limit": "회전량 초과",
                "stage_cap": "단계 상한 초과", "locked_tooth": "고정 치아 이동", "ipr_limit": "IPR 한도 초과",
                "ipr_excluded": "IPR 제외 치아 사용", "extraction_forbidden": "허용되지 않은 발치",
                "extraction_mismatch": "처방과 다른 발치", "extraction_space_open": "닫지 못한 발치 공간",
                "ipr_unprescribed": "처방에 없는 IPR"}
# Says the plan broke no rule: "규칙 위반은 없습니다", "위반 사항 없음", "위반 0건", "모든 규칙을 통과했습니다".
# Not "검토: 통과" (the reviewer wrote a memo, #91), "규칙을 통과하지 못했습니다" or "규칙 위반: 충돌 3건".
NO_VIOLATION = (r"위반\s*(?:사항)?\s*(?:[은는이가도]|[:：])?\s*(?:없|0\s*건|(?:발견|확인)되지\s*않)"
                r"|규칙\s*(?:검증|검사)?\s*[을를은는이가도]?\s*(?:모두\s*)?(?:통과|만족|준수)"
                r"(?!\s*(?:하지|를|을|가|는|은)?\s*(?:못|않|아니|아닙|실패))")
# The clause that says it: from the line start, a sentence end, a comma or a bold mark to the end of the sentence.
# A decimal point ("약 2.8개월") ends nothing.
NO_VIOLATION_CLAUSE = re.compile(r"(?:[^.!?,*\n]|(?<=\d)\.(?=\d))*"
                                 rf"(?:{NO_VIOLATION})"
                                 r"(?:[^.!?*\n]|(?<=\d)\.(?=\d))*[.!?]?")
# A list line ("- 조건: …", "1. …"); the answer's opening is everything before the first one.
BULLET = re.compile(r"\s*(?:[-•]|\*(?!\*)|\d+[.)])\s")


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


def response_like(value: Any, text: str) -> Any:
    """The workflow returns a plain string for `input_message` requests and a ChatResponse otherwise."""
    return text if getattr(value, "is_string", False) else ChatResponse.from_string(text, usage=Usage())


def rule_status(violations: list[dict]) -> str:
    """A failed plan's rule status in workflow.yml's words, e.g. 규칙 위반: 충돌 3건."""
    counts = Counter(v.get("type") for v in violations)
    return "규칙 위반: " + ", ".join(f"{VIOLATION_KO.get(t, '기타')} {n}건" for t, n in counts.items()) + "."


def fix_rule_status(answer: str, violations: list[dict]) -> str:
    """The answer with each clause of its opening (the lines before the first list line) that says the plan broke no
    rule replaced: the first by rule_status(violations), any later one by nothing. List lines are left as they are."""
    lines = answer.split("\n")
    head = "\n".join(lines[:next((i for i, line in enumerate(lines) if BULLET.match(line)), len(lines))])
    status, done = rule_status(violations), []

    def replace(m: re.Match) -> str:
        if done:
            return ""
        done.append(True)
        return m.group(0)[:len(m.group(0)) - len(m.group(0).lstrip())] + status   # keeps the space before it
    return NO_VIOLATION_CLAUSE.sub(replace, head) + answer[len(head):]


def _checked_rule_status(answer: str) -> str | None:
    """The answer with its opening's rule status fixed when this turn selected a plan that failed validation and did
    not compare strategies; None to let it out as it is. The plan comes from the turn's PlanRun, so a route without one
    (/generate, /v1/chat/completions, the websocket, nat run) is not checked."""
    run = CURRENT_RUN.get()
    if run is None or run.selected_plan_id is None or run.compared:
        return None
    violations = STORE.plans[run.selected_plan_id]["violations"]
    fixed = fix_rule_status(answer, violations) if violations else answer
    if fixed == answer:
        return None
    logger.warning("cuAlign: the answer said plan %s broke no rule; the server wrote its real rule status",
                   run.selected_plan_id)
    return fixed


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


# An answer for the dentist is Korean. A final answer that is the model's own deliberation (observed 2026-09-27 and
# 2026-09-28: "We need to parse the user's request: "처방은 …"" streamed as the answer, no tool call, no plan) never
# reaches the screen: the turn is reported as failed. Deliberation quotes the Korean request, so "no Hangul at all" is
# not enough: an answer is deliberation when Hangul is a minority of its letters or it opens like a thought.
HANGUL = re.compile(r"[\uac00-\ud7a3]")
LATIN = re.compile(r"[A-Za-z]")
DELIBERATION_OPENER = re.compile(r"^\W*(?:We need|We should|We must|Let's|Let me|The user|The dentist|I should|I need|I will|"
                                 r"First,|Okay|Ok,|Thought:)", re.I)
DELIBERATION_MIN_LATIN = 200   # a dropped prefix has at least this many Latin letters (the E2E case had 4000)
HANGUL_SHARE = 0.3     # a Korean answer with IPR/mm/FDI tokens keeps well above this; deliberation quoting one Korean
                       # sentence sits far below (the 2026-09-28 leak: about 6 percent)
NO_ANSWER = "모델이 계획 대신 자기 추론문만 돌려보내 답을 만들지 못했습니다. 같은 요청을 다시 보내 주세요."
# The ReAct label the model answers under. NAT strips it from a parsed "Final Answer:" block, but an answer given
# without a tool call in the same turn (E2E 2026-09-28, the compare turn under an extraction prescription: "Final
# Answer: 발치 치아 14,24번 처방이 유지된 상태에서 …") reaches the screen with the label on. A label only ever opens the
# answer, so "Final Answer:" inside a sentence is left alone.
REACT_LABEL = re.compile(r"^\s*(?:\*\*)?Final Answer\s*:?(?:\*\*)?\s*:?\s*", re.I)


def _strip_label(answer: str) -> str:
    """`answer` without a leading ReAct "Final Answer:" label (plain or bold)."""
    return REACT_LABEL.sub("", answer, count=1)


def _korean_line(line: str) -> bool:
    hangul, latin = len(HANGUL.findall(line)), len(LATIN.findall(line))
    return bool(hangul) and hangul >= HANGUL_SHARE * (hangul + latin) and not DELIBERATION_OPENER.match(line)


def _strip_deliberation(answer: str) -> str:
    """The Korean answer at the end of `answer` when the model wrote its deliberation first (E2E 2026-09-28: 4000
    Latin letters of "We have the reviewer output..." and then the real answer, in one message that NAT accepted as
    a direct answer); `answer` unchanged when it is Korean throughout or holds no Korean tail. The answer opens with
    one bold sentence (AGENTS.md), so the tail starts at the last line that opens with `**`; without one, at the
    first line after which every non-blank line is Korean (deliberation lines open in English or quote one Korean
    phrase inside an English sentence). The dropped prefix must hold a lot of English: a short "plan_id: p…" first
    line is not deliberation."""
    lines = answer.splitlines()
    first = next((ln for ln in lines if ln.strip()), "")
    if not first or _korean_line(first):      # opens in Korean: no deliberation prefix
        return answer
    start = None
    bold = [i for i, ln in enumerate(lines) if ln.startswith("**")]
    if bold:
        start = bold[-1]
    else:
        for i in range(len(lines) - 1, -1, -1):
            if not lines[i].strip():
                continue
            if _korean_line(lines[i]):
                start = i
            else:
                break
    if start is None or start == 0:
        return answer
    head, tail = "\n".join(lines[:start]), "\n".join(lines[start:]).strip()
    if len(HANGUL.findall(tail)) < 20 or len(LATIN.findall(head)) < DELIBERATION_MIN_LATIN:
        return answer
    logger.warning("cuAlign: dropped %d chars of deliberation before the Korean answer (head %r)", len(head), first[:80])
    return tail


def _no_korean(answer: str) -> str | None:
    """The notice that replaces `answer` when it is not a Korean answer (no Hangul, Hangul a minority of its letters,
    or an English deliberation opener), else None. Records the failure for plan_error."""
    if not answer.strip():
        return None
    hangul, latin = len(HANGUL.findall(answer)), len(LATIN.findall(answer))
    if hangul and hangul >= HANGUL_SHARE * (hangul + latin) and not DELIBERATION_OPENER.match(answer):
        return None
    logger.warning("cuAlign: the final answer is not Korean (hangul %d, latin %d, head %r); replaced", hangul, latin, answer[:80])
    run = CURRENT_RUN.get()
    if run is not None:
        run.error = {"kind": "no_answer", "message": NO_ANSWER}
    return NO_ANSWER


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
            answer = _text(out)
            stripped = _strip_deliberation(_strip_label(answer))
            if stripped != answer:
                out, answer = response_like(value, stripped), stripped
            fixed = _checked_rule_status(answer)
            if fixed is not None:
                out, answer = response_like(value, fixed), fixed
            refusal = _no_korean(answer) or await self._check_output(user, answer, state)
        return response_like(value, refusal) if refusal else out

    async def function_middleware_stream(self, *args: Any, call_next, context, **kwargs: Any) -> AsyncIterator[Any]:
        """Holds every chunk until the output verdict (the base class passes each chunk on at once)."""
        user, state, refusal = await self._check_input(args[0] if args else None)
        held = []
        if not refusal:
            try:
                held = [chunk async for chunk in call_next(*args, **kwargs)]
            except Exception as e:
                raise self._failed(e) from None
            answer = "".join(_text(c) for c in held)
            stripped = _strip_deliberation(_strip_label(answer))
            if stripped != answer:
                held, answer = [ChatResponseChunk.create_streaming_chunk(stripped)], stripped
            fixed = _checked_rule_status(answer)
            if fixed is not None:
                held, answer = [ChatResponseChunk.create_streaming_chunk(fixed)], fixed
            refusal = _no_korean(answer) or await self._check_output(user, answer, state)
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
