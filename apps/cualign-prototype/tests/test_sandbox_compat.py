"""aiohttp must follow the sandbox proxy inside OpenShell, and stay unchanged outside it."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import asyncio

import aiohttp
import pytest

from cualign import sandbox_compat


@pytest.fixture
def restore_aiohttp():
    original = aiohttp.ClientSession.__init__
    yield
    aiohttp.ClientSession.__init__ = original
    sandbox_compat._applied = False


async def _trust_env() -> bool:
    async with aiohttp.ClientSession() as session:
        return session.trust_env


def test_no_proxy_means_no_change(monkeypatch, restore_aiohttp):
    for name in sandbox_compat.PROXY_VARS:
        monkeypatch.delenv(name, raising=False)
    assert sandbox_compat.apply() is False
    assert asyncio.run(_trust_env()) is False


def test_proxy_makes_sessions_trust_env(monkeypatch, restore_aiohttp):
    monkeypatch.setenv("HTTPS_PROXY", "http://10.200.0.1:3128")
    assert sandbox_compat.apply() is True
    assert asyncio.run(_trust_env()) is True
    assert sandbox_compat.apply() is False  # applied once
