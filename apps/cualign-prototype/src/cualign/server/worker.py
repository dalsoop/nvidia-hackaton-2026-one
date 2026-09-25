"""NAT FastAPI worker with cuAlign routes added: the agent endpoints (/chat, /generate, ...) come from NAT,
/api/* and /ui come from here. NeMo Guardrails is workflow middleware (rails_middleware.py), not an HTTP layer.
One process, one port: `nat serve --config_file configs/workflow.yml`.

Selected via `general.front_end.runner_class: cualign.server.worker.CuAlignWorker`.
"""
from __future__ import annotations

from fastapi import FastAPI

from nat.builder.component_utils import WORKFLOW_COMPONENT_NAME
from nat.builder.workflow_builder import WorkflowBuilder
from nat.data_models.intermediate_step import IntermediateStep, IntermediateStepType
from nat.front_ends.fastapi.fastapi_front_end_plugin_worker import FastApiFrontEndPluginWorker
from nat.front_ends.fastapi.step_adaptor import StepAdaptor


class ToolStepsOnly(StepAdaptor):
    """Progress steps minus the workflow's own start. That step carries the whole request (chat and server context)
    and is emitted before the rails run, so a refused request would come back through it. Tool starts carry the
    tool name and the arguments the model chose; configs/workflow.yml keeps the list to FUNCTION_START."""

    def process(self, step: IntermediateStep):
        if (step.payload.event_type == IntermediateStepType.FUNCTION_START
                and step.payload.name == WORKFLOW_COMPONENT_NAME):
            return None
        return super().process(step)


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
        from .api import add_api_routes
        add_api_routes(app)
