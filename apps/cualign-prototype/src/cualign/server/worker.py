"""NAT FastAPI worker with cuAlign routes added: the agent endpoints (/chat, /generate, ...) come from NAT,
/api/* and /ui come from here, and NeMo Guardrails wraps the chat routes as ASGI middleware.
One process, one port: `nat serve --config_file configs/workflow.yml`.

Selected via `general.front_end.runner_class: cualign.server.worker.CuAlignWorker`.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI

from nat.builder.workflow_builder import WorkflowBuilder
from nat.front_ends.fastapi.fastapi_front_end_plugin_worker import FastApiFrontEndPluginWorker

logger = logging.getLogger(__name__)


class CuAlignWorker(FastApiFrontEndPluginWorker):
    def build_app(self) -> FastAPI:
        # Middleware must be attached before the app starts (add_routes runs inside the lifespan).
        app = super().build_app()
        enabled = os.environ.get("CUALIGN_GUARDRAILS", "1") != "0" and os.environ.get("NVIDIA_API_KEY", "").startswith("nvapi-")
        if enabled:
            from .rails import GuardrailsASGI
            app.add_middleware(GuardrailsASGI)
            logger.info("cuAlign: NeMo Guardrails middleware enabled on chat routes")
        else:
            logger.warning("cuAlign: Guardrails middleware disabled (no NVIDIA_API_KEY or CUALIGN_GUARDRAILS=0)")
        return app

    async def add_routes(self, app: FastAPI, builder: WorkflowBuilder):
        await super().add_routes(app, builder)
        from .api import add_api_routes
        add_api_routes(app)
