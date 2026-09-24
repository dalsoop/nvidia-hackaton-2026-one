"""Attach verified plan selection to NAT's existing chat SSE route."""
import json
from uuid import uuid4

from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from cualign.agent.context import CURRENT_RUN, PlanRun
from cualign.core.constraints import ConstraintPatch
from cualign.core.store import STORE


class ChatContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(default_factory=lambda: uuid4().hex, min_length=1, max_length=128)
    case_id: str
    base_plan_id: str | None = None
    constraints: ConstraintPatch = Field(default_factory=ConstraintPatch)


def event(name, payload):
    return ("\n\nevent: " + name + "\ndata: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode()


class PlanEventsASGI:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") != "POST" or scope.get("path") != "/chat/stream":
            return await self.app(scope, receive, send)
        body = b""
        while True:
            msg = await receive()
            if msg["type"] == "http.disconnect":
                return
            body += msg.get("body", b"")
            if not msg.get("more_body"):
                break
        try:
            data = json.loads(body)
            if not isinstance(data, dict):
                raise ValueError("expected JSON object")
            raw = data.pop("cualign", None)
            # Non-UI clients may still use the ordinary NAT endpoint.
            ctx = ChatContext.model_validate(raw) if raw is not None else ChatContext(case_id=STORE.active_case or "moderate")
            cid, case = STORE.load_case(ctx.case_id)
            constraints = STORE.constraints_for(cid, ctx.base_plan_id).patched(ctx.constraints.changes())
            constraints.check_case(case.ids)
            STORE.case_constraints[cid] = constraints
            run = PlanRun(ctx.request_id, cid, ctx.base_plan_id, constraints)
            data.setdefault("messages", []).insert(0, {
                "role": "system",
                "content": "cuAlign server context: " + json.dumps({
                    "case_id": cid, "base_plan_id": ctx.base_plan_id,
                    "constraints": constraints.model_dump(mode="json")
                }, ensure_ascii=False)
            })
            body = json.dumps(data).encode()
        except (ValueError, KeyError, TypeError):
            return await JSONResponse({"detail": "Invalid case, parent plan or constraints"}, status_code=400)(scope, receive, send)

        replayed = False
        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        is_stream = False
        async def wrapped(message):
            nonlocal is_stream
            if message["type"] == "http.response.start":
                is_stream = message["status"] == 200 and any(
                    k.lower() == b"content-type" and b"text/event-stream" in v for k, v in message.get("headers", []))
            if is_stream and message["type"] == "http.response.body" and not message.get("more_body", False):
                extra = b""
                common = {"request_id": run.request_id, "case_id": run.case_id}
                if run.selected_plan_id:
                    plan = STORE.plan_json(run.selected_plan_id)
                    extra = event("plan_selected", {**common, "schema_version": 1,
                        "plan_id": plan["plan_id"], "parent_plan_id": plan["parent_plan_id"],
                        "review": plan["review"]})
                elif run.plan_ids:
                    extra = event("plan_error", {**common, "message": "계획은 생성됐으나 최종 선택을 받지 못했습니다."})
                extra += event("plan_context", {**common, "constraints": run.constraints.model_dump(mode="json"),
                                                 "rails": run.rails})
                message = {**message, "body": message.get("body", b"") + extra}
            await send(message)

        # Keep context alive through NAT's streaming response, including spawned tasks.
        token = CURRENT_RUN.set(run)
        try:
            await self.app(scope, replay, wrapped)
        finally:
            run.closed = True
            CURRENT_RUN.reset(token)
