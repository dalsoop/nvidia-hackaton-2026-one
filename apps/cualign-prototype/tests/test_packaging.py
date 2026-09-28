"""Guard against silently shipping a wheel without UI and tooth templates."""
import importlib.util
from pathlib import Path
from zipfile import ZipFile

import pytest

spec = importlib.util.spec_from_file_location("check_wheel", Path(__file__).parents[1] / "scripts/check_wheel.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_missing_assets_are_rejected(tmp_path):
    wheel = tmp_path / "missing.whl"
    with ZipFile(wheel, "w"):
        pass
    with pytest.raises(ValueError, match="Missing assets"):
        module.check_wheel(wheel)


def test_packaged_assets_are_required_and_nonempty(tmp_path):
    root = Path(__file__).parents[1] / "src"
    wheel = tmp_path / "assets.whl"
    with ZipFile(wheel, "w") as archive:
        for directory in (root / "cualign/core/templates", root / "cualign/core/samples", root / "cualign/server/static"):
            for path in directory.rglob("*"):
                if path.is_file() and "__pycache__" not in path.parts:
                    archive.write(path, str(path.relative_to(root)))
    assert module.check_wheel(wheel) == 25 + 2 + 5 + 3 * (14 + 3) + 5     # (+ manual.js and its 4 modules) + start art, logo, sample credit, 5 view icons, 3 samples x (crowns, gum, source, png), the demo case's 5 recordings
    with ZipFile(wheel, "a") as archive:
        archive.writestr("cualign/server/static/style.css", "")
    with pytest.raises(ValueError, match="empty assets"):
        module.check_wheel(wheel)
