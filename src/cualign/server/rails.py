"""NeMo Guardrails in the request path.

Pure-ASGI middleware around the NAT chat/generate routes:
  * input rails  — the last user message is checked BEFORE the agent runs.
      - scope rail (self check input, Nemotron): diagnosis / prescription / off-topic → BLOCKED, agent never runs
      - content safety rail (nemotron-3.5-content-safety): harmful content. Default mode on INPUT is *advisory*
        (verdict shown as a step, request proceeds) because the classifier labelled 2/7 benign Korean planning
        phrases as "Criminal Planning" (2026-09-23 probe, docs/guardrails.md). CUALIGN_CONTENT_SAFETY_INPUT=block
        makes it blocking.
  * output rails — for streaming routes the completed answer is checked (content safety + self check output) when
    the stream ends; the verdict is appended as an `intermediate_data` step and a blocked answer gets a warning chunk.

Fails open with a visible "ERROR" step if a rail call itself errors.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[3]
CHAT_PATHS = {"/chat", "/chat/stream", "/generate", "/generate/stream", "/v1/chat", "/v1/chat/completions"}
STREAM_PATHS = {"/chat/stream", "/generate/stream"}
REFUSAL = "요청이 cuAlign 의 범위를 벗어납니다. 이 도구는 얼라이너 단계 계획 초안만 만들며 진단·처방·임상 판단은 하지 않습니다. 최종 판단은 의사가 합니다."
SCOPE_FLOW = "self check input"
CS_INPUT_FLOW = "content safety check input $model=content_safety"


class Rails:
    """Three LLMRails views over one config dir: scope-only input, content-safety-only input, full (for output)."""

    def __init__(self, config_dir: str | os.PathLike = ROOT / "guardrails"):
        self.config_dir = str(config_dir)
        self._full = self._scope = self._cs = None
        self.cs_input_mode = os.environ.get("CUALIGN_CONTENT_SAFETY_INPUT", "advisory")

    def _build(self, input_flows: list[str] | None):
        from nemoguardrails import LLMRails, RailsConfig
        cfg = RailsConfig.from_path(self.config_dir)
        if input_flows is not None:
            cfg.rails.input.flows = input_flows
        return LLMRails(cfg)

    def _views(self):
        if self._full is None:
            self._full = self._build(None)
            self._scope = self._build([SCOPE_FLOW])
            self._cs = self._build([CS_INPUT_FLOW])
        return self._full, self._scope, self._cs

    @staticmethod
    async def _check(rails, messages) -> tuple[str, str | None]:
        timeout = float(os.environ.get("CUALIGN_RAILS_TIMEOUT", "25"))
        try:
            res = await asyncio.wait_for(rails.check_async(messages), timeout=timeout)
            status = getattr(res.status, "value", str(res.status)).upper()
            return status, getattr(res, "rail", None)
        except asyncio.TimeoutError:
            logger.warning("guardrails timed out after %ss", timeout)
            return "ERROR", f"timeout {timeout:.0f}s"
        except Exception as e:  # fail open, but say so
            logger.warning("guardrails unavailable: %s", e)
            return "ERROR", str(e)[:120]

    async def check_input(self, text: str) -> dict:
        _, scope, cs = self._views()
        msgs = [{"role": "user", "content": text}]
        (s_status, _), (c_status, _) = await asyncio.gather(self._check(scope, msgs), self._check(cs, msgs))
        cs_blocking = self.cs_input_mode == "block"
        return {"scope": s_status, "content_safety": c_status,
                "blocked": s_status == "BLOCKED" or (cs_blocking and c_status == "BLOCKED"),
                "cs_mode": "blocking" if cs_blocking else "advisory"}

    async def check_output(self, user: str, bot: str) -> tuple[str, str | None]:
        full, _, _ = self._views()
        return await self._check(full, [{"role": "user", "content": user}, {"role": "assistant", "content": bot}])


def _last_user_text(body: bytes) -> str:
    try:
        data = json.loads((body or b"{}").decode("utf-8", "replace"))
    except (json.JSONDecodeError, ValueError):
        return ""
    if not isinstance(data, dict):
        return ""
    if isinstance(data.get("input_message"), str):
        return data["input_message"]
    for m in reversed(data.get("messages") or []):
        if m.get("role") == "user":
            c = m.get("content")
            return c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)
    return ""


def _answer_from_sse(buf: bytes) -> str:
    out = []
    for line in buf.decode("utf-8", "replace").splitlines():
        if not line.startswith("data: "):
            continue
        try:
            obj = json.loads(line[6:])
        except json.JSONDecodeError:
            continue
        ch = (obj.get("choices") or [{}])[0]
        delta = (ch.get("delta") or {}).get("content") or (ch.get("message") or {}).get("content") or obj.get("value")
        if isinstance(delta, str):
            out.append(delta)
    return "".join(out)


def _step(name: str, payload: str, i: int) -> bytes:
    return ("intermediate_data: " + json.dumps({"id": f"guardrails-{i}", "parent_id": None, "type": "markdown",
                                                "name": name, "payload": payload}, ensure_ascii=False) + "\n\n").encode()


def _chunk(text: str, finish: str | None = None) -> bytes:
    return ("data: " + json.dumps({"id": "guardrails", "object": "chat.completion.chunk",
                                   "choices": [{"index": 0, "delta": {"role": "assistant", "content": text},
                                                "finish_reason": finish}]}, ensure_ascii=False) + "\n\n").encode()


def _input_steps(v: dict) -> bytes:
    cs = v["content_safety"]
    cs_txt = cs if cs != "BLOCKED" else ("FLAGGED (advisory — request proceeds)" if v["cs_mode"] == "advisory" else "BLOCKED")
    return _step("Guardrails: scope rail (input)", v["scope"], 1) + _step("Guardrails: content safety (input)", cs_txt, 2)


class GuardrailsASGI:
    def __init__(self, app, rails: Rails | None = None):
        self.app = app
        self.rails = rails or Rails()

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "").rstrip("/") or "/"
        if scope["type"] != "http" or scope.get("method") != "POST" or path not in CHAT_PATHS:
            return await self.app(scope, receive, send)

        body, more = b"", True
        while more:
            msg = await receive()
            body += msg.get("body", b"")
            more = msg.get("more_body", False)
        user_text = _last_user_text(body)

        if user_text:
            verdict = await self.rails.check_input(user_text)
        else:
            verdict = {"scope": "PASSED", "content_safety": "PASSED", "blocked": False, "cs_mode": self.rails.cs_input_mode}
        steps = _input_steps(verdict)

        if verdict["blocked"]:
            if path in STREAM_PATHS:
                payload = steps + _chunk(REFUSAL, "stop")
                headers = [(b"content-type", b"text/event-stream; charset=utf-8"), (b"cache-control", b"no-cache")]
            else:
                payload = json.dumps({"choices": [{"index": 0, "message": {"role": "assistant", "content": REFUSAL},
                                                   "finish_reason": "stop"}], "guardrails": verdict}, ensure_ascii=False).encode()
                headers = [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]
            await send({"type": "http.response.start", "status": 200, "headers": headers})
            await send({"type": "http.response.body", "body": payload, "more_body": False})
            return

        replayed = False

        async def replay():
            # Hand the buffered body back once, then defer to the real receive so disconnects still arrive.
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        if path not in STREAM_PATHS:
            return await self.app(scope, replay, send)

        buf: list[bytes] = []

        async def send_wrapped(message):
            if message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                buf.append(chunk)
                if not message.get("more_body", False):
                    answer = _answer_from_sse(b"".join(buf))
                    extra = steps
                    if answer.strip():
                        ostatus, orail = await self.rails.check_output(user_text, answer)
                        extra += _step("Guardrails: output rails", f"{ostatus}" + (f" — {orail}" if orail and ostatus != "PASSED" else ""), 3)
                        if ostatus == "BLOCKED":
                            extra += _chunk("\n\n⚠ 출력 레일: 이 답변에 확정 진단·처방 성격의 문장이 있어 차단 대상으로 표시됐습니다. 초안으로만 읽어 주세요.")
                    await send({"type": "http.response.body", "body": chunk + extra, "more_body": False})
                    return
            await send(message)

        await self.app(scope, replay, send_wrapped)
