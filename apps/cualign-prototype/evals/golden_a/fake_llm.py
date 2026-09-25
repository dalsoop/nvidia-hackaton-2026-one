"""A local OpenAI-compatible chat server for fault injection and offline runner tests (stdlib only).

    with FakeLLM(mode="empty") as fake:        # every completion is "" (the KNOWN_ISSUES reviewer failure)
        fake.base_url                          # http://127.0.0.1:<port>/v1

    with FakeLLM(script=[{"tool_calls": [("cualign__load_case", {"case_id": "moderate"})]},
                         {"content": "발치는 허용되나요?"}]) as fake:
        ...                                    # scripted planner turns; the last entry repeats when exhausted

It only implements POST /v1/chat/completions (non-streaming and SSE streaming), which is what LangChain's
ChatOpenAI uses. Requests are recorded in `fake.requests` for assertions.
"""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _message(step: dict) -> dict:
    msg = {"role": "assistant", "content": step.get("content", "")}
    calls = step.get("tool_calls") or []
    if calls:
        msg["content"] = step.get("content") or None
        msg["tool_calls"] = [{"id": f"call_{i}_{int(time.time() * 1e6)}", "type": "function",
                              "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}
                             for i, (name, args) in enumerate(calls)]
    return msg


class FakeLLM:
    def __init__(self, mode: str = "script", script: list[dict] | None = None):
        self.mode = mode
        self.script = list(script or [])
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        self._server: ThreadingHTTPServer | None = None

    # ------------------------------------------------------------------ responses
    def _next(self) -> dict:
        if self.mode == "empty":
            return {"content": ""}
        with self._lock:
            if not self.script:
                return {"content": ""}
            return self.script.pop(0) if len(self.script) > 1 else self.script[0]

    def _handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):   # keep test output quiet
                return

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(n) or b"{}")
                fake.requests.append(req)
                msg = _message(fake._next())
                model = req.get("model", "fake")
                if req.get("stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    delta = {k: v for k, v in msg.items() if v is not None}
                    if "tool_calls" in delta:
                        delta["tool_calls"] = [{**c, "index": i} for i, c in enumerate(delta["tool_calls"])]
                    for chunk in ({"choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                                  {"choices": [{"index": 0, "delta": {}, "finish_reason":
                                                "tool_calls" if msg.get("tool_calls") else "stop"}]}):
                        body = {"id": "fake", "object": "chat.completion.chunk", "created": int(time.time()),
                                "model": model, **chunk}
                        self.wfile.write(f"data: {json.dumps(body, ensure_ascii=False)}\n\n".encode())
                    self.wfile.write(b"data: [DONE]\n\n")
                    return
                body = {"id": "fake", "object": "chat.completion", "created": int(time.time()), "model": model,
                        "choices": [{"index": 0, "message": msg,
                                     "finish_reason": "tool_calls" if msg.get("tool_calls") else "stop"}],
                        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
                data = json.dumps(body, ensure_ascii=False).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        return Handler

    # ------------------------------------------------------------------ lifecycle
    def __enter__(self) -> "FakeLLM":
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()

    @property
    def base_url(self) -> str:
        assert self._server, "FakeLLM is not running"
        return f"http://127.0.0.1:{self._server.server_address[1]}/v1"

    def llm_config(self, name: str = "fake") -> dict:
        """A NAT `llms:` entry that points at this server."""
        return {"_type": "openai", "model_name": name, "base_url": self.base_url, "api_key": "fake-key",
                "temperature": 0.0, "max_retries": 0}
