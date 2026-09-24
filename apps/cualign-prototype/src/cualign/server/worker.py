"""NAT FastAPI worker with cuAlign routes added: the agent endpoints (/chat, /generate, ...) come from NAT,
/api/* and /ui come from here. NeMo Guardrails is workflow middleware (rails_middleware.py), not an HTTP layer.
One process, one port: `nat serve --config_file configs/workflow.yml`.

Selected via `general.front_end.runner_class: cualign.server.worker.CuAlignWorker`.
"""
from __future__ import annotations

from fastapi import FastAPI

from nat.builder.workflow_builder import WorkflowBuilder
from nat.front_ends.fastapi.fastapi_front_end_plugin_worker import FastApiFrontEndPluginWorker


class CuAlignWorker(FastApiFrontEndPluginWorker):
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
