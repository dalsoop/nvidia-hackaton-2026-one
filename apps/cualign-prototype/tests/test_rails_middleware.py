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

from rails_fakes import A14, FakeLLM, FakeRails, PlanningLLM, RailLLM
from cualign import cli
from cualign.agent import register
from cualign.core import store as store_module
from cualign.server import api, plan_events, rails_middleware
from cualign.server.rails import Rails
from cualign.server.rails_middleware import REFUSAL
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
    s = store_module.Store()
    for mod in (store_module, api, register):
        monkeypatch.setattr(mod, "OUT_DIR", tmp_path)
    for mod in (api, register, plan_events):
        monkeypatch.setattr(mod, "STORE", s)
    return s


def write_config(tmp_path, llm, factory, edit=None):
    cfg = yaml.safe_load((ROOT / "configs" / "workflow.yml").read_text(encoding="utf-8"))
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
            assert REFUSAL in body and MARK not in body
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
        assert REFUSAL in body and MARK not in body
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
    workflow's own start step would echo (worker.py drops it). Tool starts stay: the tool name and the arguments the
    model chose. NAT 1.9.0's ReAct agent emits no LLM_*/TOOL_* steps."""
    summary = register.summary
    monkeypatch.setattr(register, "summary", lambda pid: {**summary(pid), "note": "MARK-STEP"})
    with PlanningLLM(thought="MARK-STEP 목표부터 만듭니다.") as llm, serve(tmp_path, monkeypatch, llm) as client:
        body = ask(client, "/chat/stream", [{"role": "user", "content": "MARK-REQ moderate 케이스 계획 짜줘."}],
                   cualign={"case_id": "moderate"})
    steps = [line for line in body.splitlines() if line.startswith("intermediate_data:")]
    assert len(llm.requests) == 4  # three tool calls and the answer: the planner really ran the tools
    assert len(steps) == 3 and not [s for s in steps if "MARK-STEP" in s or "MARK-REQ" in s]
    assert all(any(tool in s for s in steps) for tool in ("propose_target", "plan_stages", "select_plan"))
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


def test_telemetry_switched_off(store, tmp_path, monkeypatch):
    """Guardrails skips usage stats under pytest by itself, so this checks what our start paths set."""
    monkeypatch.delenv("NEMO_GUARDRAILS_NO_USAGE_STATS", raising=False)
    with FakeLLM() as llm, serve(tmp_path, monkeypatch, llm):
        assert os.environ["NEMO_GUARDRAILS_NO_USAGE_STATS"] == "1"
    monkeypatch.delenv("NAT_TELEMETRY_ENABLED", raising=False)
    monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: None)
    monkeypatch.setattr(cli.os, "execv", lambda *a: None)
    cli.cmd_serve(argparse.Namespace(host="127.0.0.1", port=8000))
    assert os.environ["NAT_TELEMETRY_ENABLED"] == "0"
