"""Build a self-contained static edition; requires only Python's standard library."""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import source_archive


def main():
    output = ROOT / "dist"
    if output.exists():
        shutil.rmtree(output)
    output.mkdir()
    shutil.copytree(ROOT / "static", output / "static")
    entry = (ROOT / "static/index.html").read_text()
    assert '<html lang="en">' in entry
    entry = entry.replace('<html lang="en">', '<html lang="en" data-compute="browser">')
    (output / "index.html").write_text(entry)
    # Keep both entry routes in the same computation mode.
    (output / "static/index.html").write_text(entry)
    (output / "blog").mkdir()
    shutil.copyfile(ROOT / "docs/blog.html", output / "blog/index.html")
    shutil.copyfile(ROOT / "docs/technical-blog.zh-CN.md", output / "blog.md")
    (output / "source.zip").write_bytes(source_archive())
    print("Static edition ready in dist: wave packets, stationary waves and 3D surfaces.")


if __name__ == "__main__":
    main()
