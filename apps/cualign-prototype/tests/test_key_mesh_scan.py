"""No NVIDIA keys, and no meshes outside the bundled tooth templates, in files git would commit.

Result folders are never committed, so a person runs the same scan on them after a demo or measurement
(the whole of out/: golden_a/, nim-live/, browser-acceptance/, plans/, stl/, uploads/):
    uv run python tests/test_key_mesh_scan.py out/
Findings name the file and line only; the matched key is never printed. Mesh names inside a zip are
listed, but zip contents are not searched for keys.
"""
import re
import subprocess
import sys
from pathlib import Path
from zipfile import BadZipFile, ZipFile

APP = Path(__file__).resolve().parents[1]
KEY = re.compile(rb"nvapi-[A-Za-z0-9_\-]{20,}")
MESH = {".stl", ".ply", ".obj"}
TEMPLATES = "src/cualign/core/templates/"


def scan(root, files):
    hits = []
    for rel in files:
        path, name = root / rel, Path(rel).as_posix()
        if not path.is_file():
            continue
        if path.suffix.lower() in MESH and not name.startswith(TEMPLATES):
            hits.append(f"{name}: mesh outside {TEMPLATES}")
        if path.suffix.lower() == ".zip":
            try:
                with ZipFile(path) as z:
                    n = sum(Path(e).suffix.lower() in MESH for e in z.namelist())
                if n:
                    hits.append(f"{name}: zip holds {n} meshes")
            except BadZipFile:
                hits.append(f"{name}: unreadable zip, check by hand")
        data = path.read_bytes()
        for m in KEY.finditer(data):
            line = data.count(b"\n", 0, m.start()) + 1
            hits.append(f"{name}:{line}: key-like string ({len(m.group())} chars)")
    return hits


def tree(root):
    return [p.relative_to(root) for p in root.rglob("*") if p.is_file()]


def committable():
    # Tracked plus new files that are not ignored: a key in a file about to be added is caught too.
    out = subprocess.run(["git", "ls-files", "-z", "-co", "--exclude-standard"],
                         cwd=APP, capture_output=True, check=True).stdout
    return [n for n in out.decode("utf-8").split("\0") if n]


def test_no_keys_or_meshes():
    files = committable()
    # The 14 bundled templates prove the exclusion is exercised; change this with the template set.
    assert sum(n.startswith(TEMPLATES) and n.endswith(".stl") for n in files) == 14
    assert scan(APP, files) == []


def test_scan_flags_planted_key(tmp_path):
    (tmp_path / "server.log").write_text("ok\nAuthorization: Bearer " + "nvapi-" + "x" * 40 + "\n")
    assert scan(tmp_path, tree(tmp_path)) == ["server.log:2: key-like string (46 chars)"]


def test_scan_flags_mesh_outside_templates(tmp_path):
    for rel in (TEMPLATES + "2.stl", "uploads/ab12cd34/2.stl"):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(b"solid t\nendsolid t\n")
    with ZipFile(tmp_path / "plan.zip", "w") as z:
        z.writestr("stage_01/2.stl", b"solid t\nendsolid t\n")
    assert sorted(scan(tmp_path, tree(tmp_path))) == [
        "plan.zip: zip holds 1 meshes", f"uploads/ab12cd34/2.stl: mesh outside {TEMPLATES}"]


def test_scan_ignores_placeholders(tmp_path):
    (tmp_path / "notes.txt").write_text("\n".join([
        "NVIDIA_API_KEY=nvapi-", "nvapi-***", "nvapi-abc",
        "openshell:resolve:env:v123_NVIDIA_API_KEY"]))
    assert scan(tmp_path, tree(tmp_path)) == []


if __name__ == "__main__":
    missing = [root for root in sys.argv[1:] if not Path(root).is_dir()]
    if missing or not sys.argv[1:]:
        sys.exit(f"not a folder: {' '.join(missing) or '(none given)'}")
    found = [f"{root}/{hit}" for root in sys.argv[1:] for hit in scan(Path(root), tree(Path(root)))]
    print("\n".join(found) or f"clean: {' '.join(sys.argv[1:])}")
    sys.exit(1 if found else 0)
