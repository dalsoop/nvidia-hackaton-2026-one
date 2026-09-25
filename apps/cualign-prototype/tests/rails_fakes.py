"""Test doubles for the Guardrails middleware: scripted rails and a local OpenAI-compatible planner model.

NAT builds middleware from YAML only, so a test config names the rails by import path
(`rails_factory: "rails_fakes:blocking"`). pytest puts tests/ on sys.path, which makes this module importable.
"""
import json
import re
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
        if self.inp == "flag":  # advisory content safety said unsafe; the scope rail passed
            return {"scope": "PASSED", "content_safety": "BLOCKED", "blocked": False, "cs_mode": "advisory"}
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


def output_blocking(_config_dir, _model_base_url=None):
    return FakeRails("pass", "block")


def flagging(_config_dir, _model_base_url=None):
    return FakeRails("flag")


class FakeLLM:
    """Answers every chat completion with `content` and no tool call, so the ReAct agent ends at once.
    The first `busy` requests get what the NVIDIA API sends when overloaded: streamed, HTTP 200 and one error line
    (#6); not streamed, the error's code as the HTTP status (#34)."""

    busy = 0
    busy_error = {"message": "Service temporarily overloaded", "code": 503}
    busy_hold = 0

    def __init__(self, content="MARK-PLANNER 계획 초안입니다."):
        self.content = content
        self.requests = []

    def reply(self, req):
        """The assistant message for this request: content, plus tool_calls when a subclass calls a tool."""
        return {"role": "assistant", "content": self.content}

    def __enter__(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                return

            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                fake.requests.append(req)
                msg = fake.reply(req)
                finish = "tool_calls" if msg.get("tool_calls") else "stop"
                head = {"id": "fake", "created": int(time.time()), "model": req.get("model", "fake")}
                if req.get("stream") and len(fake.requests) <= fake.busy:
                    self.protocol_version = "HTTP/1.1"  # a chunked stream like the API's, ending busy_hold s later
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    line = json.dumps({"error": fake.busy_error}).encode() + b"\n"
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(line), line))
                    self.wfile.flush()
                    time.sleep(fake.busy_hold)
                    self.wfile.write(b"0\r\n\r\n")
                    return
                if len(fake.requests) <= fake.busy:
                    body = json.dumps({"error": fake.busy_error}).encode()
                    self.send_response(fake.busy_error["code"])
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if req.get("stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    delta = dict(msg)
                    if msg.get("tool_calls"):
                        delta["tool_calls"] = [{"index": i, **c} for i, c in enumerate(msg["tool_calls"])]
                    for choice in ({"index": 0, "delta": delta, "finish_reason": None},
                                   {"index": 0, "delta": {}, "finish_reason": finish}):
                        chunk = {**head, "object": "chat.completion.chunk", "choices": [choice]}
                        self.wfile.write(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())
                    self.wfile.write(b"data: [DONE]\n\n")
                    return
                body = json.dumps({**head, "object": "chat.completion",
                                   "choices": [{"index": 0, "finish_reason": finish, "message": msg}],
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


class RailLLM(FakeLLM):
    """Every rail model on one fake server, all passing: content safety says safe, self check says No."""

    def reply(self, req):
        if "content-safety" in req.get("model", ""):
            return {"role": "assistant", "content": "User Safety: safe\nResponse Safety: safe"}
        return {"role": "assistant", "content": "No"}


class PlanningLLM(FakeLLM):
    """Calls the real planning tools in order (propose_target -> plan_stages -> select_plan), reading each id from
    the tool result in the request, then answers with `content`. `thought` rides along with every tool call."""

    def __init__(self, content="MARK-PLANNER 계획 초안입니다.", thought=""):
        super().__init__(content)
        self.thought = thought

    def reply(self, req):
        seen = json.dumps(req.get("messages", []), ensure_ascii=False)
        plan = re.findall(r"plan_id\W+(p[0-9a-f]{32})", seen)
        target = re.findall(r"target_id\W+(t[0-9a-f]+)", seen)
        if "plan_selected" in seen:
            return super().reply(req)
        if plan:
            name, args = "cualign__select_plan", {"plan_id": plan[-1]}
        elif target:
            name, args = "cualign__plan_stages", {"target_id": target[-1]}
        else:
            name, args = "cualign__propose_target", {"strategy": "expansion_ipr"}
        call = {"id": f"call_{len(self.requests)}", "type": "function",
                "function": {"name": name, "arguments": json.dumps(args)}}
        return {"role": "assistant", "content": self.thought, "tool_calls": [call]}
