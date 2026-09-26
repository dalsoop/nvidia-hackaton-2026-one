"""NAT FastAPI worker with cuAlign routes added: the agent endpoints (/chat, /generate, ...) come from NAT,
/api/*, /ui and /mcp come from here. NeMo Guardrails is workflow middleware (rails_middleware.py), not an HTTP layer.
One process, one port: `nat serve --config_file configs/workflow.yml`.

Selected via `general.front_end.runner_class: cualign.server.worker.CuAlignWorker`.
"""
from __future__ import annotations

from fastapi import FastAPI

from nat.builder.component_utils import WORKFLOW_COMPONENT_NAME
from nat.builder.workflow_builder import WorkflowBuilder
from nat.data_models.intermediate_step import IntermediateStep, IntermediateStepType, StreamEventData
from nat.front_ends.fastapi.fastapi_front_end_plugin_worker import FastApiFrontEndPluginWorker
from nat.front_ends.fastapi.step_adaptor import StepAdaptor


class ToolStepsOnly(StepAdaptor):
    """Progress steps with nothing the output rail did not check. The workflow's own start and end are dropped: the
    start carries the whole request (chat and server context) and leaves before the rails run, so a refused request
    would come back through it. A tool's start passes as NAT builds it (tool name and the arguments the model chose).
    A tool's end is rebuilt with a fixed output in place of the tool result, because the UI closes a row only when an
    end step with the same id arrives (app.js addStep); NAT's end body keeps the input block, so the arguments stay."""

    def process(self, step: IntermediateStep):
        payload = step.payload
        if payload.name == WORKFLOW_COMPONENT_NAME and payload.event_type in (IntermediateStepType.FUNCTION_START,
                                                                              IntermediateStepType.FUNCTION_END):
            return None
        if payload.event_type != IntermediateStepType.FUNCTION_END:
            return super().process(step)
        data = (payload.data or StreamEventData()).model_copy(update={"output": "완료"})  # finished, not succeeded
        done = super().process(step.model_copy(update={"payload": payload.model_copy(update={"data": data})}))
        if done is not None:
            done.name = f"Function End: {payload.name}"  # the UI strips this prefix, not NAT's "Function Complete:"
        return done


class CuAlignWorker(FastApiFrontEndPluginWorker):
    def get_step_adaptor(self) -> StepAdaptor:
        return ToolStepsOnly(self.front_end_config.step_adaptor)

    def build_app(self) -> FastAPI:
        # Middleware must be attached before the app starts (add_routes runs inside the lifespan).
        app = super().build_app()
        from .plan_events import PlanEventsASGI
        app.add_middleware(PlanEventsASGI)
        return app

    async def add_routes(self, app: FastAPI, builder: WorkflowBuilder):
        await super().add_routes(app, builder)
        from cualign.agent.register import context_preload
        # What the server context carries in advance (workflow.yml function_groups.cualign.context_preload, #48);
        # plan_events.PlanEventsASGI reads it from app.state on every /chat/stream request.
        app.state.cualign_preload = context_preload(builder.get_function_group_config("cualign").context_preload)
        from .api import add_api_routes
        add_api_routes(app, review=await manual_review(builder))
        from .mcp_server import add_mcp_route
        add_mcp_route(app)   # /mcp for NemoClaw (docs/nemoclaw.md); 503 until a token is configured


async def manual_review(builder: WorkflowBuilder, name: str = "reviewer"):
    """The dentist's «검토 다시 요청» runs the workflow's own reviewer settings and model, outside any chat request."""
    from nat.builder.framework_enum import LLMFrameworkEnum
    from cualign.agent.reviewer import review_plan
    config = builder.get_function_config(name)
    llm = await builder.get_llm(config.llm_name, wrapper_type=LLMFrameworkEnum.LANGCHAIN)

    async def review(plan_id: str) -> dict:
        return await review_plan(plan_id, llm, max_attempts=config.max_attempts, timeout_seconds=config.timeout_seconds,
                                 total_seconds=config.total_seconds, manual=True)
    return review
