"""cuAlign as a Streamable HTTP MCP server at /mcp, for an outside agent such as OpenClaw in a NemoClaw sandbox
(docs/nemoclaw.md). The outside agent is a front desk: it asks for whole workflows, and the planning stays with the
NAT agent. `cualign_plan` posts to this server's own /chat/stream, so the request takes the UI's path: plan_events.py
opens the run and injects the server context, the rails check it, and the reviewer runs.

Approval stays with the dentist in the cuAlign UI. `cualign_approve_plan` never approves, and `cualign_export_stl`
only hands out the UI's download link after STORE.require_approved passes. NemoClaw's `--deny-tool` blocks both
tools again at the OpenShell policy, so the policy has named tools to deny.

/mcp needs `Authorization: Bearer <token>`. The server knows the token as CUALIGN_MCP_TOKEN_SHA256 (its hex SHA-256)
or as CUALIGN_MCP_TOKEN. Inside an OpenShell sandbox only the hash works: a provider credential reaches the process as a
placeholder that the proxy fills in at egress, and `--env` is for non-secret values. With neither set, /mcp answers 503.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from uuid import uuid4

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import FastMCP
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings

from cualign.core.constraints import ConstraintPatch
from cualign.core.store import STORE

logger = logging.getLogger(__name__)

TOKEN_ENV = "CUALIGN_MCP_TOKEN"
TOKEN_HASH_ENV = "CUALIGN_MCP_TOKEN_SHA256"
ALLOWED_HOSTS_ENV = "CUALIGN_MCP_ALLOWED_HOSTS"   # e.g. "192.168.5.2,192.168.5.2:8443", the host NemoClaw dials
LOCAL_HOSTS = ["127.0.0.1", "127.0.0.1:*", "localhost", "localhost:*"]
PUBLIC_URL_ENV = "CUALIGN_PUBLIC_URL"   # the address the dentist opens the UI at, for links in tool results
SELF_URL = "http://cualign.internal"    # requests to this app itself never leave the process (ASGITransport)
PLAN_TIMEOUT_S = 600.0                  # about 14 LLM calls with NIM retries


def sse_events(text: str) -> list[tuple[str, object]]:
    """The same framing as static/plan-stream.js: `event:`/`data:` frames, NAT's legacy `intermediate_data:` and
    `error:` lines, and an unframed JSON error at the end."""
    out = []
    for frame in text.replace("\r\n", "\n").split("\n\n"):
        name, parts, legacy = "data", [], None
        for line in frame.split("\n"):
            key, sep, value = line.partition(":")
            if not sep:
                continue
            value = value[1:] if value.startswith(" ") else value
            if key == "event":
                name = value
            elif key == "data":
                parts.append(value)
            elif key in ("intermediate_data", "error"):
                legacy = (key, value)
        if legacy:
            name, parts = legacy[0], [legacy[1]]
        raw = "\n".join(parts)
        if not raw or raw == "[DONE]":
            if frame.strip().startswith("{"):
                try:
                    out.append(("error", json.loads(frame)))
                except ValueError:
                    pass
            continue
        try:
            out.append((name, json.loads(raw)))
        except ValueError:
            continue
    return out


def _ui_link(plan_id: str | None = None) -> str:
    base = os.environ.get(PUBLIC_URL_ENV, "http://localhost:8000").rstrip("/")
    return f"{base}/ui/" + (f"?plan={plan_id}" if plan_id else "")


def _plan_brief(plan_id: str) -> dict:
    from .api import _summary
    s = _summary(plan_id)
    return {**s, "reviewer_memo": s["review"].get("message"), "ui_url": _ui_link(plan_id)}


def build_mcp(app: FastAPI) -> FastMCP:
    mcp = FastMCP("cualign", instructions=(
        "cuAlign drafts clear-aligner staging plans for a dentist. Call cualign_list_cases first, then cualign_plan "
        "with the case and the dentist's request. Every plan is a draft: the dentist reviews and approves it in the "
        "cuAlign UI (ui_url), never through these tools."))

    def self_client() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=SELF_URL, timeout=PLAN_TIMEOUT_S)

    @mcp.tool()
    def cualign_list_cases() -> dict:
        """List the sample cases the planner can use, with crowding in mm, and the active case."""
        return {"cases": STORE.available_cases(), "active": STORE.active_case}

    @mcp.tool()
    async def cualign_plan(case_id: str, request: str, constraints: ConstraintPatch | None = None,
                           base_plan_id: str | None = None) -> dict:
        """Ask the cuAlign planning agent for a staging plan, the same way the cuAlign UI does.

        case_id: from cualign_list_cases. request: the dentist's words, in Korean. constraints: the confirmed
        conditions (null keeps the case's current value). base_plan_id: revise this earlier plan.
        Returns the agent's answer, the selected plan (rule check, stages, months, reviewer memo) and its UI link."""
        request_id = uuid4().hex
        body = {"messages": [{"role": "user", "content": request}],
                "cualign": {"request_id": request_id, "case_id": case_id, "base_plan_id": base_plan_id,
                            "constraints": (constraints or ConstraintPatch()).model_dump(mode="json")}}
        async with self_client() as client:
            activated = await client.post(f"/api/cases/{case_id}/activate")
            if activated.status_code != 200:
                return {"status": "error", "message": f"unknown case {case_id}"}
            res = await client.post("/chat/stream", json=body, headers={"Accept": "text/event-stream"})
        if res.status_code != 200:
            return {"status": "error", "message": res.json().get("detail", f"HTTP {res.status_code}")}
        answer, tools, selected, error = "", [], None, None
        for name, data in sse_events(res.text):
            if name == "plan_selected" and data.get("request_id") == request_id:
                selected = data
            elif name in ("plan_error", "error"):
                error = data.get("message") if isinstance(data, dict) else str(data)
            elif name == "intermediate_data" and isinstance(data, dict):
                tools.append(str(data.get("name", "")).removeprefix("Function Start: ").removeprefix("Function End: "))
            elif name == "data" and isinstance(data, dict):
                choice = (data.get("choices") or [{}])[0]
                piece = (choice.get("delta") or {}).get("content") or (choice.get("message") or {}).get("content") \
                    or data.get("value") or ""
                answer += piece if isinstance(piece, str) else ""
        result = {"status": "planned" if selected and not error else ("error" if error else "no_plan"),
                  "answer": answer, "tools": list(dict.fromkeys(t for t in tools if t)),
                  "note": "초안입니다. 최종 판단과 승인은 의사가 cuAlign 화면에서 합니다."}
        if error:
            result["message"] = error
        if selected:
            result["plan"] = _plan_brief(selected["plan_id"])
            result["reviewed_by_server"] = selected.get("reviewed_by_server", False)
        return result

    @mcp.tool()
    def cualign_get_plan(plan_id: str) -> dict:
        """Summary of a stored plan: rule check, violations by type, stages, months, review, approval, UI link."""
        if plan_id not in STORE.plans:
            return {"status": "error", "message": f"unknown plan {plan_id}"}
        return _plan_brief(plan_id)

    @mcp.tool()
    def cualign_approve_plan(plan_id: str) -> dict:
        """Approval is the dentist's act in the cuAlign UI. This tool never approves; it says where to approve."""
        if plan_id not in STORE.plans:
            return {"status": "error", "message": f"unknown plan {plan_id}"}
        return {"status": "refused", "approval": STORE.plans[plan_id]["approval"], "ui_url": _ui_link(plan_id),
                "message": "승인은 의사가 cuAlign 화면에서만 할 수 있습니다."}

    @mcp.tool()
    def cualign_export_stl(plan_id: str) -> dict:
        """The STL download link of a plan the dentist has approved. Refused while the plan is not approved."""
        if plan_id not in STORE.plans:
            return {"status": "error", "message": f"unknown plan {plan_id}"}
        try:
            STORE.require_approved(plan_id)
        except ValueError as e:
            return {"status": "refused", "message": str(e), "ui_url": _ui_link(plan_id)}
        base = os.environ.get(PUBLIC_URL_ENV, "http://localhost:8000").rstrip("/")
        return {"status": "approved", "download_url": f"{base}/api/plans/{plan_id}/stl.zip"}

    return mcp


class McpEndpoint:
    """Bearer check in front of a stateless Streamable HTTP transport. Each request gets its own session manager, so
    nothing has to join NAT's lifespan; stateless JSON responses keep one request in one HTTP exchange."""

    def __init__(self, mcp: FastMCP):
        self.mcp = mcp

    async def __call__(self, scope, receive, send):
        expected = os.environ.get(TOKEN_HASH_ENV, "").strip().lower()
        if not expected and os.environ.get(TOKEN_ENV):
            expected = hashlib.sha256(os.environ[TOKEN_ENV].encode()).hexdigest()
        if not expected:
            return await JSONResponse({"detail": "MCP is disabled: no token is configured"},
                                      status_code=503)(scope, receive, send)
        auth = dict(scope.get("headers") or []).get(b"authorization", b"").decode("latin-1")
        scheme, _, given = auth.partition(" ")
        digest = hashlib.sha256(given.strip().encode()).hexdigest()
        if scheme.lower() != "bearer" or not given.strip() or not hmac.compare_digest(digest, expected):
            return await JSONResponse({"detail": "invalid or missing bearer token"}, status_code=401,
                                      headers={"WWW-Authenticate": "Bearer"})(scope, receive, send)
        # The MCP SDK checks the Host header against a list (DNS rebinding); the proxy keeps the host NemoClaw dials.
        extra = [h.strip() for h in os.environ.get(ALLOWED_HOSTS_ENV, "").split(",") if h.strip()]
        manager = StreamableHTTPSessionManager(app=self.mcp._mcp_server, stateless=True, json_response=True,
                                               security_settings=TransportSecuritySettings(
                                                   allowed_hosts=LOCAL_HOSTS + extra))
        async with manager.run():
            await manager.handle_request(scope, receive, send)


def add_mcp_route(app: FastAPI) -> None:
    app.router.add_route("/mcp", McpEndpoint(build_mcp(app)), methods=["GET", "POST", "DELETE"],
                         include_in_schema=False)
