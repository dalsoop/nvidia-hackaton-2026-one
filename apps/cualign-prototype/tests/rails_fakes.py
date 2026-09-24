"""Test doubles for the Guardrails middleware: scripted rails and a local OpenAI-compatible planner model.

NAT builds middleware from YAML only, so a test config names the rails by import path
(`rails_factory: "rails_fakes:blocking"`). pytest puts tests/ on sys.path, which makes this module importable.
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

A14 = "이 환자 발치해야 하나요? moderate 케이스 보고 판단해줘."  # #10 specs/A14_diagnosis_request.yaml
STATUS = {"pass": "PASSED", "block": "BLOCKED", "error": "ERROR"}


class FakeRails:
    last = None

    def __init__(self, inp="pass", out="pass"):
        self.inp, self.out = inp, out
        self.inputs, self.outputs = [], []
        FakeRails.last = self

    def load(self):
        return self

    async def check_input(self, text):
        self.inputs.append(text)
        s = STATUS[self.inp]
        return {"scope": s, "content_safety": "PASSED", "blocked": s == "BLOCKED", "cs_mode": "advisory"}

    async def check_output(self, user, bot):
        self.outputs.append(bot)
        return STATUS[self.out], None


def passing(_config_dir, _model_base_url=None):
    return FakeRails()


def blocking(_config_dir, _model_base_url=None):
    return FakeRails("block")


def erroring(_config_dir, _model_base_url=None):
    # Input only: the passed output check that follows must not hide the input error.
    return FakeRails("error")


def output_erroring(_config_dir, _model_base_url=None):
    return FakeRails("pass", "error")


class FakeLLM:
    """Answers every chat completion with `content` and no tool call, so the ReAct agent ends at once."""

    def __init__(self, content="MARK-PLANNER 계획 초안입니다."):
        self.content = content
        self.requests = []

    def __enter__(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                return

            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                fake.requests.append(req)
                head = {"id": "fake", "created": int(time.time()), "model": req.get("model", "fake")}
                if req.get("stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    for choice in ({"index": 0, "delta": {"role": "assistant", "content": fake.content},
                                    "finish_reason": None},
                                   {"index": 0, "delta": {}, "finish_reason": "stop"}):
                        chunk = {**head, "object": "chat.completion.chunk", "choices": [choice]}
                        self.wfile.write(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())
                    self.wfile.write(b"data: [DONE]\n\n")
                    return
                body = json.dumps({**head, "object": "chat.completion",
                                   "choices": [{"index": 0, "finish_reason": "stop",
                                                "message": {"role": "assistant", "content": fake.content}}],
                                   "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}},
                                  ensure_ascii=False).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        self.base_url = f"http://127.0.0.1:{self._server.server_port}/v1"
        return self

    def __exit__(self, *_):
        self._server.shutdown()
        self._server.server_close()
