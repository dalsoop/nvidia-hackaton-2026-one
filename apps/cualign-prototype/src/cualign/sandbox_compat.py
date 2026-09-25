"""OpenShell compatibility: send aiohttp traffic through the sandbox proxy.

Inside an OpenShell sandbox every outbound connection has to go through HTTPS_PROXY.
requests and httpx read the proxy variables, but aiohttp only does when a session is created
with trust_env=True. langchain-nvidia-ai-endpoints (the NIM client behind `_type: nim`) creates
its async sessions without it, so agent calls fail with a DNS error in the sandbox.

When a proxy variable is set, new aiohttp sessions default to trust_env=True. Without one this
is a no-op, so local runs behave exactly as before.
"""
from __future__ import annotations

import os

PROXY_VARS = ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy")
_applied = False


def apply() -> bool:
    global _applied
    if _applied or not any(os.environ.get(name) for name in PROXY_VARS):
        return False
    import aiohttp

    original_init = aiohttp.ClientSession.__init__

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("trust_env", True)
        original_init(self, *args, **kwargs)

    aiohttp.ClientSession.__init__ = __init__
    _applied = True
    return True
