"""Whether an NVIDIA API key is available to this process.

Inside an OpenShell sandbox with `--provider nvidia`, NVIDIA_API_KEY holds a placeholder
(`openshell:resolve:env:...`) that the sandbox proxy swaps for the real key on outbound requests.
It never starts with `nvapi-`, but calls authenticate, so it counts as available.
"""
from __future__ import annotations

import os
from collections.abc import Mapping

OPENSHELL_PLACEHOLDER_PREFIX = "openshell:resolve:env:"


def nvidia_key_available(env: Mapping[str, str] = os.environ) -> bool:
    key = env.get("NVIDIA_API_KEY", "")
    return key.startswith("nvapi-") or key.startswith(OPENSHELL_PLACEHOLDER_PREFIX)
