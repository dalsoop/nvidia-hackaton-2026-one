import os
import tempfile

import pytest

# Tests never write to the default ./out: that is where the demo server keeps patients and plans, and anything left
# there shows up on its start screen. Set before any test module imports cualign.core.store (it reads this once).
if not os.environ.get("CUALIGN_OUT"):
    os.environ["CUALIGN_OUT"] = tempfile.mkdtemp(prefix="cualign-test-out-")


def pytest_addoption(parser):
    parser.addoption("--slow", action="store_true", default=False, help="slow 표시가 붙은 시험도 돌린다 (CI 에서는 항상 돈다)")


def pytest_collection_modifyitems(config, items):
    """Locally the slow tests (about 4 of 10 minutes) are skipped unless --slow is given; on CI they always run."""
    if config.getoption("--slow") or os.environ.get("CI"):
        return
    skip = pytest.mark.skip(reason="slow: --slow 또는 CI 에서만 돈다")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def rails_off_by_default(monkeypatch):
    """Rails stay off in tests. On a PC with a real key, a test that builds the workflow would otherwise call NIM
    through the rails. A test that needs rails turns them on itself with a fake key and fake rails or models."""
    monkeypatch.setenv("CUALIGN_GUARDRAILS", "0")
