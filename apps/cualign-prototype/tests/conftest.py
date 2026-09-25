import pytest


@pytest.fixture(autouse=True)
def rails_off_by_default(monkeypatch):
    """Rails stay off in tests. On a PC with a real key, a test that builds the workflow would otherwise call NIM
    through the rails. A test that needs rails turns them on itself with a fake key and fake rails or models."""
    monkeypatch.setenv("CUALIGN_GUARDRAILS", "0")
