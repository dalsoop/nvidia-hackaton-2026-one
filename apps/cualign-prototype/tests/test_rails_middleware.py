"""Guardrails as workflow middleware, through the real NAT app built from configs/workflow.yml.

Nothing reaches NVIDIA: rails come from rails_fakes (named in the config, as NAT only builds middleware from YAML)
and the planner model is a local fake server. The key is a fake `nvapi-` string that only switches rails on.
"""
import argparse
import asyncio
import json
import logging
import os
import re
import shutil
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest
import uvicorn
import yaml
from fastapi.routing import APIWebSocketRoute
from fastapi.testclient import TestClient
from nat.runtime.loader import load_config, load_workflow
from nat.utils.io.yaml_tools import yaml_load

from rails_fakes import A14, FakeLLM, FakeRails, PlanningLLM, RailLLM, SkippingPlanner
from cualign import cli
from cualign.agent import nim_stream_patch, register, reviewer
from cualign.core import store as store_module
from cualign.server import api, plan_events, rails_middleware
from cualign.server.rails import Rails
from cualign.server.rails_middleware import PII_REFUSAL, REFUSAL
from cualign.server.worker import CuAlignWorker

ROOT = Path(__file__).resolve().parents[1]
MARK = "MARK-PLANNER"
PHONE = "moderate 케이스 계획 짜줘. 보호자 연락처 010-0000-0000"


def workflow_routes(app):
    """Every route that runs the workflow (13 today): NAT's post_* handlers and the websocket. Read from the app,
    so closing or adding a route changes the list without editing this test."""
    ws = [r.path for r in app.routes if isinstance(r, APIWebSocketRoute)]
    http = [r.path for r in app.routes
            if getattr(getattr(r, "endpoint", None), "__qualname__", "").startswith("post_")]
    return http, ws


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-" + "t" * 40)
    for name in ("CUALIGN_GUARDRAILS", "CUALIGN_RAILS_FAIL_CLOSED"):
        monkeypatch.delenv(name, raising=False)
    for mod in (store_module, api, register):
        monkeypatch.setattr(mod, "OUT_DIR", tmp_path)
    s = store_module.Store()   # after OUT_DIR: Store() reads out/plans back since #92, and a developer's out/ is not empty
    for mod in (api, register, plan_events, reviewer, rails_middleware):
        monkeypatch.setattr(mod, "STORE", s)
    return s


def write_config(tmp_path, llm, factory, edit=None):
    cfg = yaml_load(ROOT / "configs" / "workflow.yml")   # file:// inlined: the copy is written under tmp_path
    for name in cfg["llms"]:
        cfg["llms"][name] = {"_type": "openai", "model_name": "fake", "base_url": llm.base_url, "api_key": "fake"}
    cfg["middleware"]["cualign_rails"]["rails_factory"] = factory
    if edit:
        edit(cfg)
    path = tmp_path / "workflow.yml"
    path.write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    return path


@contextmanager
def serve(tmp_path, monkeypatch, llm, factory="rails_fakes:passing", edit=None):
    path = write_config(tmp_path, llm, factory, edit)
    monkeypatch.setenv("NAT_CONFIG_FILE", str(path))
    with TestClient(CuAlignWorker(load_config(path)).build_app()) as client:
        yield client


def plain(text):
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), text)


def ask(client, route, messages=None, **extra):
    res = client.post(route, json={"messages": messages or [{"role": "user", "content": A14}], **extra})
    assert res.status_code == 200, (route, res.status_code, res.text[:300])
    return plain(res.text)


def ask_ws(client, route="/websocket"):
    with client.websocket_connect(route) as ws:
        ws.send_json({"type": "user_message", "schema_type": "chat_stream", "id": "m1", "conversation_id": "c1",
                      "content": {"messages": [{"role": "user", "content": [{"type": "text", "text": A14}]}]}})
        got = []
        while True:
            msg = ws.receive_json()
            got.append(json.dumps(msg, ensure_ascii=False))
            if msg.get("status") == "complete" or msg.get("type") == "error_message":
                return plain("\n".join(got))


def ask_live(path, route):
    """/v1/workflow/atif never closes its stream in NAT 1.9.0, with or without rails, and TestClient waits for the
    end. So that route is read from a real server until the answer arrives."""
    server = uvicorn.Server(uvicorn.Config(CuAlignWorker(load_config(path)).build_app(), host="127.0.0.1", port=0,
                                           log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)
    port = server.servers[0].sockets[0].getsockname()[1]
    got = ""
    try:
        with httpx.stream("POST", f"http://127.0.0.1:{port}{route}", timeout=20,
                          json={"messages": [{"role": "user", "content": A14}]}) as res:
            for line in res.iter_lines():
                got += plain(line) + "\n"
                if REFUSAL in got or MARK in got:
                    return got
    finally:
        server.should_exit = True
        thread.join(10)
    return got


def sse_event(text, name):
    return json.loads(text.split(f"event: {name}\ndata: ")[1].split("\n")[0])


def sse_step(line):
    return json.loads(line[len("intermediate_data: "):])


def test_rails_all_routes_blocked(store, tmp_path, monkeypatch):
    with FakeLLM() as llm:
        with serve(tmp_path, monkeypatch, llm, "rails_fakes:blocking") as client:
            http, ws = workflow_routes(client.app)
            live = [r for r in http if r.endswith("/atif")]
            bodies = {r: ask(client, r) for r in http if r not in live}
            bodies.update({r: ask_ws(client, r) for r in ws})
            assert FakeRails.last.inputs == [A14] * len(bodies)
        for r in live:
            bodies[r] = ask_live(tmp_path / "workflow.yml", r)
            assert FakeRails.last.inputs == [A14]
    assert {"/chat/stream", "/generate", "/v1/chat/completions", "/websocket"} <= set(bodies)
    assert len(bodies) == len(http) + len(ws)
    for route, body in bodies.items():
        assert REFUSAL in body and MARK not in body, (route, body[:300])
    assert llm.requests == []  # the planner never ran, so no plan tool was called either


def test_blocked_input_never_enters_planning(store, tmp_path, monkeypatch):
    # Moved from test_plan_events.py: the rails are no longer an ASGI layer in front of PlanEventsASGI.
    with FakeLLM() as llm, serve(tmp_path, monkeypatch, llm, "rails_fakes:blocking") as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    assert "plan_selected" not in body and not store.plans
    assert sse_event(body, "plan_context")["rails"] == "blocked"
    assert sse_event(body, "turn_refused")["kind"] == "rails"   # the screen keeps a scope refusal's message (#157)


def test_rails_config_error_stops_boot(store, tmp_path, monkeypatch):
    def missing_dir(cfg):
        cfg["middleware"]["cualign_rails"]["rails_config_dir"] = str(tmp_path / "no-such-guardrails")
    with FakeLLM() as llm, pytest.raises(Exception, match="no-such-guardrails"):
        with serve(tmp_path, monkeypatch, llm, "cualign.server.rails:Rails", missing_dir):
            pass


@pytest.mark.parametrize("switch_off", ["CUALIGN_GUARDRAILS=0", "no key"])
def test_rails_off_is_logged(store, tmp_path, monkeypatch, caplog, switch_off):
    if switch_off == "no key":
        monkeypatch.delenv("NVIDIA_API_KEY")
    else:
        monkeypatch.setenv("CUALIGN_GUARDRAILS", "0")
    with caplog.at_level(logging.INFO), FakeLLM() as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    off = [r for r in caplog.records if r.name == rails_middleware.__name__ and "Guardrails OFF" in r.message]
    assert [r.levelno for r in off] == [logging.ERROR]
    assert MARK in body and sse_event(body, "plan_context")["rails"] == "off"


@pytest.mark.parametrize("factory", ["rails_fakes:erroring", "rails_fakes:output_erroring"])
def test_rails_error_turn_is_logged(store, tmp_path, monkeypatch, caplog, factory):
    with caplog.at_level(logging.INFO), FakeLLM() as llm, serve(tmp_path, monkeypatch, llm, factory) as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    errors = [r for r in caplog.records if r.name == rails_middleware.__name__ and "rail ERROR" in r.message]
    assert errors and all(r.levelno == logging.ERROR for r in errors)
    assert MARK in body and REFUSAL not in body  # default policy: the turn proceeds
    assert sse_event(body, "plan_context")["rails"] == "error"


def test_rails_advisory_flag_is_recorded(store, tmp_path, monkeypatch):
    """The advisory content-safety verdict was shown only as a stream step of the old ASGI layer."""
    with FakeLLM() as llm, serve(tmp_path, monkeypatch, llm, "rails_fakes:flagging") as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    assert MARK in body and REFUSAL not in body
    assert sse_event(body, "plan_context")["rails"] == "flagged"


def test_rails_fail_closed_switch(store, tmp_path, monkeypatch):
    monkeypatch.setenv("CUALIGN_RAILS_FAIL_CLOSED", "1")
    with FakeLLM() as llm:
        monkeypatch.delenv("NVIDIA_API_KEY")
        with pytest.raises(Exception, match="CUALIGN_RAILS_FAIL_CLOSED"):
            with serve(tmp_path, monkeypatch, llm):
                pass
        monkeypatch.setenv("CUALIGN_GUARDRAILS", "0")  # an explicit opt-out still boots
        with serve(tmp_path, monkeypatch, llm):
            pass
        monkeypatch.delenv("CUALIGN_GUARDRAILS")
        monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-" + "t" * 40)
        with serve(tmp_path, monkeypatch, llm, "rails_fakes:output_erroring") as client:
            whole = ask(client, "/generate")
            streamed = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
        assert REFUSAL in whole and MARK not in whole
        assert REFUSAL in streamed and MARK not in streamed  # the streamed answer is held for the verdict
        with serve(tmp_path, monkeypatch, llm, "rails_fakes:erroring") as client:
            n = len(llm.requests)
            body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
        assert REFUSAL in body and len(llm.requests) == n and "plan_selected" not in body


def test_rails_scope_last_user_empty(store, tmp_path, monkeypatch):
    with FakeLLM() as llm, serve(tmp_path, monkeypatch, llm) as client:
        ask(client, "/chat/stream", [{"role": "user", "content": A14}, {"role": "assistant", "content": "네"},
                                     {"role": "user", "content": " "}], cualign={"case_id": "moderate"})
        assert FakeRails.last.inputs == [A14]
        body = ask(client, "/chat/stream", [{"role": "user", "content": " "}], cualign={"case_id": "moderate"})
        assert FakeRails.last.inputs == [A14]  # nothing to check is an error, not a pass
        assert sse_event(body, "plan_context")["rails"] == "error"


@pytest.mark.parametrize("route", ["/chat/stream", "/generate"])
def test_rails_called_once(store, tmp_path, monkeypatch, route):
    with FakeLLM() as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, route)
    assert MARK in body
    assert FakeRails.last.inputs == [A14] and FakeRails.last.outputs == [llm.content]


def test_output_check_rail_types(monkeypatch):
    from nemoguardrails import LLMRails
    from nemoguardrails.rails.llm.options import RailsResult, RailStatus, RailType
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-" + "t" * 40)
    seen = []

    async def spy(self, messages, rail_types=None):
        seen.append(rail_types)
        return RailsResult(status=RailStatus.PASSED, content="")

    rails = Rails().load()  # the real guardrails/ config; nothing is called with the fake key
    monkeypatch.setattr(LLMRails, "check_async", spy)
    assert asyncio.run(rails.check_output(A14, "초안입니다.")) == ("PASSED", None)
    assert seen == [[RailType.OUTPUT]]
    asyncio.run(rails.check_input(A14))
    assert seen[1:] == [[RailType.INPUT], [RailType.INPUT]]


def test_rails_nat_run_path(store, tmp_path):
    """`nat run` and the eval runner build the same workflow. They have no PlanRun, so they read RAIL_RECORD."""
    async def run(path):
        record = {}
        rails_middleware.RAIL_RECORD.set(record)
        async with load_workflow(path) as session:
            async with session.run(A14) as runner:
                return await runner.result(to_type=str), record

    with FakeLLM() as llm:
        out, record = asyncio.run(run(write_config(tmp_path, llm, "rails_fakes:blocking")))
    assert out == REFUSAL and llm.requests == []
    assert record == {"state": "blocked"}


def rail_models_to(url):
    def edit(cfg):
        cfg["middleware"]["cualign_rails"]["rails_model_base_url"] = url
    return edit


def test_rails_model_url_reaches_fake_server(store, tmp_path, monkeypatch, caplog):
    """The real Rails with every rail model sent to a local fake server. A call that went to NIM instead would
    fail on the fake key and log an ERROR."""
    with FakeLLM() as llm, RailLLM() as rail_llm:
        with serve(tmp_path, monkeypatch, llm, "cualign.server.rails:Rails", rail_models_to(rail_llm.base_url)) as client:
            body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    assert {r["model"] for r in rail_llm.requests} == {"nvidia/nemotron-3-super-120b-a12b",
                                                        "nvidia/nemotron-3.5-content-safety"}
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]  # every rail verdict parsed
    assert MARK in body and sse_event(body, "plan_context")["rails"] == "passed"


def test_rails_outlast_three_overloaded_calls(monkeypatch):
    """Guardrails' own client re-asks a rail model call on 429/5xx, but only twice by default, and a 503 that lasted
    longer failed a verdict in the 9/25 live run (#34). guardrails/config.yml raises it: three 503 in a row on the
    first model call still end in a verdict. The output check runs its model calls one after another, so the first
    of them takes every busy answer."""
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-" + "t" * 40)
    monkeypatch.setattr("nemoguardrails.llm.clients.base.INITIAL_RETRY_DELAY", 0)
    with RailLLM() as rail_llm:
        rail_llm.busy = 3
        rails = Rails(model_base_url=rail_llm.base_url).load()  # the real guardrails/ config, models on the fake
        status, _ = asyncio.run(rails.check_output(A14, "초안입니다."))
    models = [r["model"] for r in rail_llm.requests]
    assert status == "PASSED", models
    assert models[:4] == [models[0]] * 4, models  # asked four times: three 503 and the answer


def test_content_safety_request_carries_custom_policy(monkeypatch):
    """config.yml's custom_policy must reach the wire as chat_template_kwargs on every content-safety call (#37)."""
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-" + "t" * 40)
    with RailLLM() as rail_llm:
        rails = Rails(model_base_url=rail_llm.base_url).load()
        status, _ = asyncio.run(rails.check_output(A14, "초안입니다."))
    cs = [r for r in rail_llm.requests if r["model"] == "nvidia/nemotron-3.5-content-safety"]
    assert status == "PASSED" and cs, (status, [r["model"] for r in rail_llm.requests])
    assert all("Disallowed Behaviors" in r.get("chat_template_kwargs", {}).get("custom_policy", "") for r in cs), \
        sorted(cs[0])


def test_regex_output_rail_blocks_r1(store, tmp_path, monkeypatch):
    """The output rail model is a fake that passes everything; the prescriptive list still blocks the answer."""
    with FakeLLM("발치해야 합니다.") as llm, serve(tmp_path, monkeypatch, llm) as client:
        whole = ask(client, "/generate")
        streamed = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    for body in (whole, streamed):
        assert REFUSAL in body and "발치해야" not in body
    assert sse_event(streamed, "plan_context")["rails"] == "blocked"
    assert FakeRails.last.outputs == []  # blocked before the rail model was asked


def test_pii_blocked_before_model(store, tmp_path, monkeypatch):
    """The real Rails with its models on a local fake server: an identifier is refused before any model call."""
    with FakeLLM() as llm, RailLLM() as rail_llm:
        with serve(tmp_path, monkeypatch, llm, "cualign.server.rails:Rails", rail_models_to(rail_llm.base_url)) as client:
            body = ask(client, "/chat/stream", [{"role": "user", "content": PHONE}], cualign={"case_id": "moderate"})
            assert PII_REFUSAL in body and MARK not in body
            assert sse_event(body, "turn_refused")["kind"] == "pii"   # the screen takes this message back (#157)
            assert "0000-0000" not in body  # nothing of the refused request comes back, not even as a progress step
            assert rail_llm.requests == [] and llm.requests == []
            body = ask(client, "/chat/stream", [{"role": "user", "content": PHONE.split(" 보호자")[0]}],
                       cualign={"case_id": "moderate"})
    assert MARK in body and REFUSAL not in body and rail_llm.requests


def test_pii_in_history_and_case_id(store, tmp_path, monkeypatch):
    """The UI resends the whole chat, and a case folder name reaches the model in the system message."""
    case = tmp_path / "guardian 010-0000-0000"
    case.mkdir()
    for f in (ROOT / "src" / "cualign" / "core" / "templates").glob("*.stl"):
        shutil.copy(f, case)
    with FakeLLM() as llm, serve(tmp_path, monkeypatch, llm) as client:
        history = ask(client, "/chat/stream", [{"role": "user", "content": PHONE}, {"role": "assistant", "content": "네"},
                                               {"role": "user", "content": "계획 짜줘"}], cualign={"case_id": "moderate"})
        folder = ask(client, "/chat/stream", [{"role": "user", "content": "계획 짜줘"}], cualign={"case_id": str(case)})
    for body in (history, folder):  # ask() already checked each is a 200, not the 400 of an unknown case
        assert PII_REFUSAL in body and MARK not in body
        # not in the last message: taking that one back would not help, so the screen keeps it (#157)
        assert sse_event(body, "turn_refused")["kind"] == "pii_context"
    assert FakeRails.last.inputs == [] and llm.requests == []


OUT = "MARK-OUT 계획 초안입니다."  # passes the regex list; only the fake output rail blocks it


def test_output_held_stream(store, tmp_path, monkeypatch):
    with FakeLLM(OUT) as llm, serve(tmp_path, monkeypatch, llm, "rails_fakes:output_blocking") as client:
        bodies = {r: ask(client, r) for r in ("/chat/stream", "/generate/stream")}
        bodies["/v1/chat/completions"] = ask(client, "/v1/chat/completions", stream=True)
        bodies["/websocket"] = ask_ws(client)
    for route, body in bodies.items():
        assert REFUSAL in body and "MARK-OUT" not in body, (route, body[:300])


def test_output_held_nonstream(store, tmp_path, monkeypatch):
    with FakeLLM(OUT) as llm, serve(tmp_path, monkeypatch, llm, "rails_fakes:output_blocking") as client:
        bodies = {r: ask(client, r) for r in ("/generate", "/v1/chat/completions", "/v1/workflow")}
    for route, body in bodies.items():
        assert REFUSAL in body and "MARK-OUT" not in body, (route, body[:300])


def test_intermediate_no_payload(store, tmp_path, monkeypatch):
    """Progress events leave while the answer is held, so they must not carry model text, tool results or the
    request. MARK-STEP is in the model's text and in every tool result; MARK-REQ only in the request, which the
    workflow's own start step would echo (worker.py drops it). What stays: each tool's start (the tool name and the
    arguments the model chose) and its end rebuilt without the result, so the UI can close the row (app.js addStep
    marks a row done only by an end step with the same id). NAT 1.9.0's ReAct agent emits no LLM_*/TOOL_* steps."""
    summary = register.summary
    monkeypatch.setattr(register, "summary", lambda pid: {**summary(pid), "note": "MARK-STEP"})
    with PlanningLLM(thought="MARK-STEP 목표부터 만듭니다.") as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, "/chat/stream", [{"role": "user", "content": "MARK-REQ moderate 케이스 계획 짜줘."}],
                   cualign={"case_id": "moderate"})
    steps = [line for line in body.splitlines() if line.startswith("intermediate_data:")]
    planner = [r for r in llm.requests if not str(r["messages"][0].get("content", "")).startswith("You are cuAlign's read-only reviewer")]
    assert len(planner) == 4  # three tool calls and the answer: the planner really ran the tools
    assert not [s for s in steps if "MARK-STEP" in s or "MARK-REQ" in s]
    starts = [s for s in steps if "Function Start: " in s]
    ends = [s for s in steps if "Function End: " in s]
    assert len(steps) == 6 and len(starts) == 3 and len(ends) == 3
    assert all(any(tool in s for s in starts) for tool in ("propose_target", "plan_stages", "select_plan"))
    # Each end closes its start's row (same id), keeps the input block (the arguments stay on screen) and says 완료.
    assert all("완료" in s and "Function Input:" in s and sse_step(s)["id"] in {sse_step(t)["id"] for t in starts}
               for s in ends)
    # The answer and plan events still carry what they should; only the progress events are cut.
    assert MARK in body and sse_event(body, "plan_selected")["plan_id"] in store.plans


def test_blocked_turn_no_plan_selected(store, tmp_path, monkeypatch):
    with PlanningLLM() as llm, serve(tmp_path, monkeypatch, llm, "rails_fakes:output_blocking") as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    assert store.plans  # a plan was made and selected before the output was blocked
    assert REFUSAL in body and MARK not in body
    assert "plan_selected" not in body and "plan_error" not in body
    assert sse_event(body, "plan_context")["rails"] == "blocked"


def test_output_error_turn_holds_plan(store, tmp_path, monkeypatch):
    """With the switch on, an output rail error refuses the answer after the plan exists, so the plan event must
    be held on purpose (an input error never reaches planning)."""
    monkeypatch.setenv("CUALIGN_RAILS_FAIL_CLOSED", "1")
    with PlanningLLM() as llm, serve(tmp_path, monkeypatch, llm, "rails_fakes:output_erroring") as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
    assert store.plans
    assert REFUSAL in body and MARK not in body and "plan_selected" not in body
    assert sse_event(body, "plan_context")["rails"] == "error"


def test_workflow_error_hides_model_text(store, tmp_path, monkeypatch, caplog):
    """A ReAct parse failure raises with the model's raw text in its message, and NAT sends str(e) to the client
    (the streamed error line, the 422 body, the websocket error) without the output rail seeing it. The model
    answers "Thought: ..." with no action, which the agent does not take as a direct answer, until retries run out."""
    with caplog.at_level(logging.ERROR), FakeLLM("Thought: MARK-LEAK") as llm:
        with serve(tmp_path, monkeypatch, llm) as client:
            bodies = {"/chat/stream": ask(client, "/chat/stream", cualign={"case_id": "moderate"}),
                      "/websocket": ask_ws(client)}
            res = client.post("/generate", json={"messages": [{"role": "user", "content": A14}]})
    assert res.status_code == 422
    bodies["/generate"] = plain(res.text)
    for route, body in bodies.items():
        assert "MARK-LEAK" not in body and "ReActAgentParsingFailedError" in body, (route, body[:300])
    logged = [r for r in caplog.records if r.name == rails_middleware.__name__ and r.exc_info]
    assert len(logged) == 3 and all("MARK-LEAK" in str(r.exc_info[1]) for r in logged)  # the server log keeps it


def test_telemetry_switched_off(store, tmp_path, monkeypatch):
    """Guardrails skips usage stats under pytest by itself, so this checks what our start paths set."""
    monkeypatch.delenv("NEMO_GUARDRAILS_NO_USAGE_STATS", raising=False)
    with FakeLLM() as llm, serve(tmp_path, monkeypatch, llm):
        assert os.environ["NEMO_GUARDRAILS_NO_USAGE_STATS"] == "1"
    monkeypatch.delenv("NAT_TELEMETRY_ENABLED", raising=False)
    monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: None)
    started = []
    monkeypatch.setattr(cli.os, "execv", lambda *a: started.append("execv"))
    monkeypatch.setattr(cli.subprocess, "call", lambda *a, **k: started.append("call") or 0)
    with pytest.raises(SystemExit):
        cli.cmd_serve(argparse.Namespace(host="127.0.0.1", port=8000))
    assert os.environ["NAT_TELEMETRY_ENABLED"] == "0"
    # Windows waits on nat serve instead of os.execv, which would return at once (#83)
    assert started[0] == ("call" if os.name == "nt" else "execv")


def test_skipped_review_runs_on_server_with_memo_rail(store, tmp_path, monkeypatch):
    """The agent selects a plan and never calls the reviewer: the server reviews it before offering the plan,
    and the memo passes the output rail like an answer does."""
    with SkippingPlanner() as llm, serve(tmp_path, monkeypatch, llm) as client:
        assert reviewer.MEMO_CHECK is not None
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
        selected = sse_event(body, "plan_selected")
        assert selected["reviewed_by_server"] is True
        assert selected["review"]["status"] == "passed" and selected["review"]["rails"] == "passed"
        assert any("MARK-MEMO" in out for out in FakeRails.last.outputs)
        # Already reviewed: the dentist's request is refused rather than run again.
        assert client.post(f"/api/plans/{selected['plan_id']}/review").status_code == 409
    assert reviewer.MEMO_CHECK is None  # the workflow is gone, so is its check


def test_prescriptive_memo_is_not_stored(store, tmp_path, monkeypatch):
    with SkippingPlanner("검토 결과 발치가 필요합니다.") as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
        selected = sse_event(body, "plan_selected")
        review = selected["review"]
        assert review["status"] == "failed" and review["error"] == "rail_blocked" and review["rails"] == "blocked"
        assert "발치가 필요" not in json.dumps(store.plan_json(selected["plan_id"]), ensure_ascii=False)
        # The dentist may ask again; the model still writes the same sentence, so it fails the same way.
        again = client.post(f"/api/plans/{selected['plan_id']}/review").json()["review"]
        assert again["error"] == "rail_blocked"


@pytest.mark.parametrize("factory,closed,state,refuse", [("output_blocking", False, "blocked", True),
                                                         ("output_erroring", False, "error", False),
                                                         ("output_erroring", True, "error", True),
                                                         ("passing", False, "passed", False)])
def test_memo_check_follows_output_policy(factory, closed, state, refuse):
    rails = getattr(__import__("rails_fakes"), factory)(None)
    middleware = rails_middleware.RailsMiddleware(rails, closed)
    assert asyncio.run(middleware.check_memo("검토 메모 초안")) == (state, refuse)
    assert rails.outputs == ["검토 메모 초안"]
    assert asyncio.run(rails_middleware.RailsMiddleware(None, False).check_memo("메모")) == ("off", False)


def test_mcp_plan_runs_the_guarded_workflow(store, tmp_path, monkeypatch):
    """cualign_plan over /mcp (docs/nemoclaw.md) on the real worker: the NAT agent plans with the real tools behind
    the rails, and the tool result carries the selected plan. A real server, because the MCP client and NAT's
    lifespan must share one event loop."""
    import asyncio
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from cualign.server import mcp_server
    monkeypatch.setattr(mcp_server, "STORE", store)
    monkeypatch.setenv(mcp_server.TOKEN_ENV, "test-token-not-a-secret")
    with PlanningLLM() as llm:
        path = write_config(tmp_path, llm, "rails_fakes:passing")
        monkeypatch.setenv("NAT_CONFIG_FILE", str(path))
        server = uvicorn.Server(uvicorn.Config(CuAlignWorker(load_config(path)).build_app(), host="127.0.0.1",
                                               port=0, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        while not server.started:
            time.sleep(0.05)
        port = server.servers[0].sockets[0].getsockname()[1]

        async def plan():
            headers = {"Authorization": "Bearer test-token-not-a-secret"}
            async with httpx.AsyncClient(headers=headers, timeout=60) as http:
                async with streamable_http_client(f"http://127.0.0.1:{port}/mcp", http_client=http) as (r, w, *_):
                    async with ClientSession(r, w) as session:
                        await session.initialize()
                        return await session.call_tool("cualign_plan", {"case_id": "moderate", "request": A14})
        try:
            res = asyncio.run(plan())
        finally:
            server.should_exit = True
            thread.join(10)
    out = json.loads(res.content[0].text)
    assert out["status"] == "planned" and MARK in out["answer"]
    assert out["plan"]["plan_id"] in store.plans
    assert {"propose_target", "plan_stages", "select_plan"} <= {t.split("__")[-1] for t in out["tools"]}
    assert str(llm.requests[0]["messages"]).count("cuAlign server context") == 1


def test_overload_crash_reaches_the_ui_as_a_nim_overload_event(store, tmp_path, monkeypatch):
    """#51 4번: a turn the NVIDIA API's overload killed ends with plan_error kind=nim_overload and the sentence from
    configs/workflow.yml (overload_notice), so the UI can show it with a 다시 보내기 button. NAT's own unframed
    workflow_error line stays for plan-stream.js. The yml's nim_retry block is what the client patch runs with."""
    for name in ("DELAYS", "REQUEST_DELAYS", "RETRY_CODES", "FALLBACK_MODELS"):
        monkeypatch.setattr(nim_stream_patch, name, getattr(nim_stream_patch, name))   # restored after the test

    def edit(cfg):
        for llm in cfg["llms"].values():
            llm.update(num_retries=1, max_retries=0)   # the fake answers 503 to everything; no waiting in NAT
        cfg["middleware"]["cualign_rails"]["overload_notice"] = "MARK-NOTICE 과부하입니다."
        cfg["middleware"]["cualign_rails"]["nim_retry"] = {"stream_delays": [0], "request_delays": [],
                                                           "retry_codes": [503], "fallback_models": []}
    with FakeLLM() as llm:
        llm.busy, llm.busy_http = 99, True
        with serve(tmp_path, monkeypatch, llm, edit=edit) as client:
            assert nim_stream_patch.DELAYS == (0,) and nim_stream_patch.RETRY_CODES == {503}
            body = ask(client, "/chat/stream", cualign={"case_id": "moderate", "request_id": "r-51"})
    assert "workflow_error" in body
    error = sse_event(body, "plan_error")
    assert error["kind"] == "nim_overload" and error["message"] == "MARK-NOTICE 과부하입니다."
    assert error["request_id"] == "r-51" and "plan_selected" not in body
    assert sse_event(body, "plan_context")["request_id"] == "r-51"


ENGLISH_ONLY = "We need to parse the user's request... universal numbering... So we should respond with a question."
QUOTING_KOREAN = ('We need to parse the user\'s request: "처방은 비발치, IPR 11-21·11-12·21-22 접촉면에 각 0.4mm입니다. 이 처방으로 '
                  '단계 계획을 짜 주세요."\n\nInterpretation: The dentist prescribes non-extraction, IPR on contacts: 11-21 (likely '
                  'between teeth 11 and 21? Actually FDI: 11 is upper right central incisor, 21 is upper left central incisor? '
                  'So 11-21 is across midline? universal numbering...')


DELIBERATION_THEN_ANSWER = (
    "We have the reviewer output. It says status: 'passed'? Actually the message says \"규칙 통과: 실패\". The rails field says "
    "'passed'? Let's check: the reviewer returned a list with a dict containing status passed, attempts 1, a message with "
    "Korean text, error None, rails passed. The message includes failures (collisions), so we report the review as failed and "
    "keep the memo's figures.\n\nWe need to output final answer in Korean, following format: lead with one sentence, e.g. "
    "\"**확장 전략으로 12단계(약 2.8개월) 계획을 만들었습니다.** 규칙 위반은 없습니다.\"\n\n- 조건: copy conditions_ko exactly: "
    "\"발치 치아 없음 · 고정 치아 없음\"\n\nNow bullets:\n\n"
    "**확장 전략으로 18단계(약 4.1개월) 계획을 만들었습니다.** 규칙 위반: 충돌 7건\n\n"
    "- 조건: 발치 치아 없음 · 고정 치아 없음 · IPR 제외 치아 17, 16, 26, 27번 · IPR 한도 면당 0.25mm · 단계 상한 없음 · 이동 순서 동시\n"
    "- 검토: 실패 (충돌 7건, 단계당 이동량 0.238mm, IPR 미적용)\n- 의사 확인 필요: 충돌을 줄이려면 단계 수를 늘리거나 이동 순서를 조정해야 합니다.\n\n"
    "이 계획은 초안입니다. 최종 판단은 의사가 합니다.")


def test_deliberation_before_the_korean_answer_is_dropped_and_the_plan_is_kept(store, tmp_path, monkeypatch):
    """E2E 2026-09-28: the model wrote 4000 letters of English deliberation and then the real answer in one message.
    The dentist gets the answer only, and the plan the turn selected still arrives (no plan_error)."""
    from cualign.server.rails_middleware import _strip_deliberation
    kept = _strip_deliberation(DELIBERATION_THEN_ANSWER)
    assert kept.startswith("**확장 전략으로 18단계") and kept.endswith("최종 판단은 의사가 합니다.") and "We have" not in kept
    assert _strip_deliberation(kept) == kept                                    # a Korean answer is left alone
    assert _strip_deliberation(ENGLISH_ONLY) == ENGLISH_ONLY                    # nothing to keep: the guard's case
    with PlanningLLM(DELIBERATION_THEN_ANSWER) as llm, serve(tmp_path, monkeypatch, llm) as client:
        stream = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
        plain = ask(client, "/generate")
    assert "We have the reviewer output" not in stream and "**확장 전략으로 18단계" in stream
    assert sse_event(stream, "plan_selected") and "plan_error" not in stream
    assert "We have the reviewer output" not in plain and "**확장 전략으로 18단계" in plain


def test_deliberation_that_quotes_the_korean_request_is_still_no_answer():
    """2026-09-28 live (sample 000131 after the FDI-only card text): the deliberation quoted the Korean request, so it
    held Hangul and passed the old no-Hangul guard. Hangul share and the opener catch it; real answers pass."""
    from cualign.server.rails_middleware import NO_ANSWER, _no_korean
    assert _no_korean(QUOTING_KOREAN) == NO_ANSWER
    assert _no_korean("Thought: 조건을 확인해야 합니다. Action: none") == NO_ANSWER
    assert _no_korean("**확장 전략으로 9단계(약 2.1개월) 계획을 만들었습니다.** 규칙 위반은 없습니다.\n\n- 조건: 발치 치아 없음 · "
                      "IPR 제외 치아 17, 16, 15, 14, 13, 23, 24, 25, 26, 27번 · IPR 한도 면당 0.25mm\n- 검토: 단계당 이동량 0.232mm, "
                      "IPR 면당 0.0mm\n\n이 계획은 초안입니다. 최종 판단은 의사가 합니다.") is None
    assert _no_korean("발치할 치아 번호가 필요합니다(예: 14번과 24번). 어느 치아를 발치할까요?") is None
    assert _no_korean("") is None


def test_answer_without_korean_is_replaced_and_reported(store, tmp_path, monkeypatch):
    """2026-09-27 live: the model called no tool and streamed its English deliberation as the answer. Such an answer
    never reaches the dentist: the notice replaces it (stream and non-stream) and the turn ends with a plan_error
    (kind no_answer) instead of silence."""
    from cualign.server.rails_middleware import NO_ANSWER
    with FakeLLM(ENGLISH_ONLY) as llm, serve(tmp_path, monkeypatch, llm) as client:
        stream = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
        plain = ask(client, "/generate")
    assert NO_ANSWER in stream and "universal numbering" not in stream
    assert sse_event(stream, "plan_error")["kind"] == "no_answer" and "plan_selected" not in stream
    assert NO_ANSWER in plain and "universal numbering" not in plain


FINAL_ANSWER_LABEL = "Final Answer: 발치 치아 14,24번 처방이 유지된 상태에서 확장안과 IPR안을 비교하시겠습니까, 아니면 발치 없이 비교하시겠습니까?"


def test_react_final_answer_label_is_stripped(store, tmp_path, monkeypatch):
    """E2E 2026-09-28 (000097 compare turn): the model asked back without a tool call and NAT passed its text on with
    the ReAct label. The dentist sees the question only, plain or bold label alike; a label inside a sentence stays."""
    from cualign.server.rails_middleware import _strip_label
    assert _strip_label(FINAL_ANSWER_LABEL) == FINAL_ANSWER_LABEL.removeprefix("Final Answer: ")
    assert _strip_label("**Final Answer:** 발치 없이 비교할까요?") == "발치 없이 비교할까요?"
    assert _strip_label("**Final Answer**: 발치 없이 비교할까요?") == "발치 없이 비교할까요?"
    assert _strip_label("**확장 전략으로 9단계 계획을 만들었습니다.** Final Answer: 아님") == "**확장 전략으로 9단계 계획을 만들었습니다.** Final Answer: 아님"
    with PlanningLLM(FINAL_ANSWER_LABEL) as llm, serve(tmp_path, monkeypatch, llm) as client:
        stream = ask(client, "/chat/stream", cualign={"case_id": "moderate"})
        plain = ask(client, "/generate")
    assert "Final Answer" not in stream and "발치 치아 14,24번 처방이 유지된 상태에서" in stream and "plan_error" not in stream
    assert "Final Answer" not in plain and "발치 치아 14,24번 처방이 유지된 상태에서" in plain


def test_rejected_key_reaches_the_ui_as_a_nim_auth_event(store, tmp_path, monkeypatch):
    """QA 9/28 D: a turn the NVIDIA API killed with 401 (missing or wrong key) ends with plan_error kind=nim_auth and a
    sentence naming the key, instead of the type-only 「에이전트 실행이 실패했습니다 (Exception)」 that left the dentist
    pressing 다시 보내기. 401 is not in retry_codes, so the fake's first answer is the turn's last."""
    def edit(cfg):
        for llm in cfg["llms"].values():
            llm.update(num_retries=1, max_retries=0)
        cfg["middleware"]["cualign_rails"]["nim_retry"] = {"stream_delays": [0], "request_delays": [],
                                                           "retry_codes": [503], "fallback_models": []}
    with FakeLLM() as llm:
        llm.busy, llm.busy_http, llm.busy_error = 99, True, {"message": "Unauthorized", "code": 401}
        with serve(tmp_path, monkeypatch, llm, edit=edit) as client:
            body = ask(client, "/chat/stream", cualign={"case_id": "moderate", "request_id": "r-401"})
    error = sse_event(body, "plan_error")
    assert error["kind"] == "nim_auth" and "NVIDIA_API_KEY" in error["message"] and "401" in error["message"]
    assert error["request_id"] == "r-401" and "plan_selected" not in body
