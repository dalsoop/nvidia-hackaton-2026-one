"""NeMo Guardrails checks, called by the workflow middleware in rails_middleware.py.

  * input rails  — the last non-empty user message is checked BEFORE the agent runs.
      - scope rail (self check input, Nemotron): diagnosis / prescription / off-topic → BLOCKED, agent never runs
      - content safety rail (nemotron-3.5-content-safety): harmful content. Default mode on INPUT is *advisory*
        (the turn proceeds) because the classifier labelled 2/7 benign Korean planning phrases as
        "Criminal Planning" (2026-09-23 probe, docs/guardrails.md). CUALIGN_CONTENT_SAFETY_INPUT=block
        makes it blocking.
  * output rails — the completed answer is checked (content safety + self check output); only output flows run.

A rail call that errors or times out returns "ERROR" and is logged at ERROR; the middleware decides what follows.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[3]
SCOPE_FLOW = "self check input"
CS_INPUT_FLOW = "content safety check input $model=content_safety"


class Rails:
    """Three LLMRails views over one config dir: scope-only input, content-safety-only input, full (for output)."""

    def __init__(self, config_dir: str | os.PathLike = ROOT / "guardrails", model_base_url: str | None = None):
        self.config_dir = str(config_dir)
        self.model_base_url = model_base_url
        self._full = self._scope = self._cs = None
        self.cs_input_mode = os.environ.get("CUALIGN_CONTENT_SAFETY_INPUT", "advisory")

    def _build(self, input_flows: list[str] | None):
        from nemoguardrails import LLMRails, RailsConfig
        cfg = RailsConfig.from_path(self.config_dir)
        if self.model_base_url:
            for model in cfg.models:
                model.parameters["base_url"] = self.model_base_url
        if input_flows is not None:
            cfg.rails.input.flows = input_flows
        return LLMRails(cfg)

    def load(self):
        """Read the config and build the views now, so a missing or broken config fails at startup."""
        self._views()
        return self

    def _views(self):
        if self._full is None:
            self._full = self._build(None)
            self._scope = self._build([SCOPE_FLOW])
            self._cs = self._build([CS_INPUT_FLOW])
        return self._full, self._scope, self._cs

    @staticmethod
    async def _check(rails, messages, rail_type: str) -> tuple[str, str | None]:
        from nemoguardrails.rails.llm.options import RailType
        timeout = float(os.environ.get("CUALIGN_RAILS_TIMEOUT", "25"))
        try:
            # Explicit rail_types: without it a user+assistant pair runs the input rails a second time.
            res = await asyncio.wait_for(rails.check_async(messages, rail_types=[RailType(rail_type)]),
                                         timeout=timeout)
            status = getattr(res.status, "value", str(res.status)).upper()
            return status, getattr(res, "rail", None)
        except asyncio.TimeoutError:
            logger.error("guardrails timed out after %ss", timeout)
            return "ERROR", f"timeout {timeout:.0f}s"
        except Exception as e:  # fail open, but say so
            logger.error("guardrails unavailable: %s", e)
            return "ERROR", str(e)[:120]

    async def check_input(self, text: str) -> dict:
        _, scope, cs = self._views()
        msgs = [{"role": "user", "content": text}]
        (s_status, _), (c_status, _) = await asyncio.gather(self._check(scope, msgs, "input"),
                                                            self._check(cs, msgs, "input"))
        cs_blocking = self.cs_input_mode == "block"
        return {"scope": s_status, "content_safety": c_status,
                "blocked": s_status == "BLOCKED" or (cs_blocking and c_status == "BLOCKED"),
                "cs_mode": "blocking" if cs_blocking else "advisory"}

    async def check_output(self, user: str, bot: str) -> tuple[str, str | None]:
        full, _, _ = self._views()
        return await self._check(full, [{"role": "user", "content": user}, {"role": "assistant", "content": bot}],
                                 "output")
