"""Check packaged runtime assets; does not assert standalone CLI deployment support."""
from pathlib import Path
import sys
from zipfile import ZipFile

# every page file the screen serves, read from the source tree: a new script (drawers.js, scan-reveal.js, …) is required
# in the wheel the moment it exists, with no list here to forget
STATIC = Path(__file__).resolve().parents[1] / "src" / "cualign" / "server" / "static"


def check_wheel(path):
    required = {f"cualign/core/templates/{tooth}.stl" for tooth in range(2, 16)}
    required.add("cualign/core/templates/ATTRIBUTION.md")
    pages = sorted(p.name for pattern in ("*.js", "*.css", "*.html") for p in STATIC.glob(pattern))
    assert {"index.html", "app.js", "style.css"} <= set(pages), f"no page files under {STATIC}"
    required.update(f"cualign/server/static/{name}" for name in (*pages, "intro-arch.png", "logo.png"))
    # the 3D view icon bar (#13 polish)
    required.update(f"cualign/server/static/icons/view-{view}.png" for view in ("occlusal", "front", "left", "right", "overlay"))
    # start-screen samples (#46): real scans, their credit and thumbnails
    required.add("cualign/core/samples/ATTRIBUTION.md")
    for case in ("poseidon-000097", "poseidon-000131", "poseidon-000001"):
        required.update(f"cualign/core/samples/{case}/{tooth}.stl" for tooth in range(2, 16))
        required.update({f"cualign/core/samples/{case}/gingiva.stl", f"cualign/core/samples/{case}/SOURCE.txt",
                         f"cualign/server/static/samples/{case}.png"})
    # recorded agent answers the screen replays when the NIM is down (core/recorded.py): the demo case, every step
    required.update(f"cualign/core/samples/recorded/poseidon-000097/{step}.json" for step in ("setup", "target", "stages", "cap", "compare"))
    with ZipFile(path) as archive:
        missing = required - set(archive.namelist())
        empty = {name for name in required - missing if archive.getinfo(name).file_size == 0}
    if missing or empty:
        raise ValueError(f"Missing assets: {sorted(missing)}; empty assets: {sorted(empty)}")
    return len(required)


if __name__ == "__main__":
    print(f"Wheel assets: {check_wheel(sys.argv[1])} nonempty files verified")
