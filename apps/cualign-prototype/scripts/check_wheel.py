"""Check packaged runtime assets; does not assert standalone CLI deployment support."""
import sys
from zipfile import ZipFile


def check_wheel(path):
    required = {f"cualign/core/templates/{tooth}.stl" for tooth in range(2, 16)}
    required.add("cualign/core/templates/ATTRIBUTION.md")
    required.update(f"cualign/server/static/{name}" for name in ("index.html", "app.js", "style.css", "plan-stream.js"))
    with ZipFile(path) as archive:
        missing = required - set(archive.namelist())
        empty = {name for name in required - missing if archive.getinfo(name).file_size == 0}
    if missing or empty:
        raise ValueError(f"Missing assets: {sorted(missing)}; empty assets: {sorted(empty)}")
    return len(required)


if __name__ == "__main__":
    print(f"Wheel assets: {check_wheel(sys.argv[1])} nonempty files verified")
