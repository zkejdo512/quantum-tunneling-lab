"""Local-only interactive lab. Python 3.10+, standard library only."""

import argparse
from dataclasses import fields
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

from quantum_tunneling import Parameters, simulate, sweep
from quantum_tunneling.solver import surface

ROOT = Path(__file__).resolve().parent
STATIC = {"/": ("static/index.html", "text/html; charset=utf-8"),
          "/index.html": ("static/index.html", "text/html; charset=utf-8"),
          "/style.css": ("static/style.css", "text/css; charset=utf-8"),
          "/app.js": ("static/app.js", "text/javascript; charset=utf-8"),
          "/static/style.css": ("static/style.css", "text/css; charset=utf-8"),
          "/static/app.js": ("static/app.js", "text/javascript; charset=utf-8"),
          "/static/api-client.js": ("static/api-client.js", "text/javascript; charset=utf-8"),
          "/static/stationary-core.mjs": ("static/stationary-core.mjs", "text/javascript; charset=utf-8"),
          "/static/stationary-worker.js": ("static/stationary-worker.js", "text/javascript; charset=utf-8"),
          "/static/surface.js": ("static/surface.js", "text/javascript; charset=utf-8"),
          "/static/packet-ui.js": ("static/packet-ui.js", "text/javascript; charset=utf-8"),
          "/static/packet-core.js": ("static/packet-core.js", "text/javascript; charset=utf-8"),
          "/static/packet-worker.js": ("static/packet-worker.js", "text/javascript; charset=utf-8"),
          "/blog": ("docs/blog.html", "text/html; charset=utf-8"),
          "/blog.md": ("docs/technical-blog.zh-CN.md", "text/plain; charset=utf-8")}


def source_archive():
    """Package only this project's source; never traverse the parent workspace."""
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        paths = [ROOT / name for name in ("app.py", "simulate.py", "validate.py", "README.md",
                                          "LICENSE", ".gitignore", "启动模拟器.command")]
        for folder in ("quantum_tunneling", "static", "docs", "tests", "scripts", ".github"):
            paths.extend((ROOT / folder).rglob("*"))
        for path in sorted(paths):
            if path.is_file() and not path.is_symlink() and "__pycache__" not in path.parts:
                archive.write(path, "quantum-tunneling/" + str(path.relative_to(ROOT)))
    return buffer.getvalue()


def parameters(query):
    values = {}
    for field in fields(Parameters):
        if field.name in query:
            raw = query[field.name]
            if len(raw) != 1:
                raise ValueError(f"{field.name} must not be repeated")
            values[field.name] = raw[0] if field.name == "shape" else float(raw[0])
    return Parameters(**values).validate()


@lru_cache(maxsize=24)
def simulation_json(p):
    return json.dumps(simulate(p), ensure_ascii=False, allow_nan=False).encode("utf-8")


@lru_cache(maxsize=12)
def sweep_json(p, variable, start, stop, count):
    return json.dumps(sweep(p, variable, start, stop, count), ensure_ascii=False, allow_nan=False).encode("utf-8")


@lru_cache(maxsize=6)
def surface_json(p, count):
    return json.dumps(surface(p, count), ensure_ascii=False, allow_nan=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, content_type="application/json; charset=utf-8", filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # A newer slider request may abort the previous one.

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        request = urlsplit(self.path)
        try:
            if request.path in STATIC:
                name, mime = STATIC[request.path]
                return self.reply(200, (ROOT / name).read_bytes(), mime)
            if request.path == "/source.zip":
                return self.reply(200, source_archive(), "application/zip", "quantum-tunneling.zip")
            if request.path == "/favicon.ico":
                return self.reply(204, b"", "image/x-icon")
            if request.path not in ("/api/simulate", "/api/sweep", "/api/surface"):
                return self.reply(404, b'{"error":"Not found"}')
            query = parse_qs(request.query, keep_blank_values=True, max_num_fields=20)
            allowed = {field.name for field in fields(Parameters)}
            if request.path == "/api/sweep":
                allowed |= {"variable", "start", "stop", "count"}
            if request.path == "/api/surface":
                allowed |= {"count"}
            if set(query) - allowed:
                raise ValueError("Unknown parameters: " + ", ".join(sorted(set(query) - allowed)))
            if any(len(value) != 1 for value in query.values()):
                raise ValueError("Query parameters must not be repeated")
            p = parameters(query)
            if request.path == "/api/simulate":
                return self.reply(200, simulation_json(p))
            if request.path == "/api/surface":
                return self.reply(200, surface_json(p, int(query.get("count", [41])[0])))
            variable = query.get("variable", ["width"])[0]
            defaults = {"width": (0, 2), "height": (0, 8), "energy": (0.05, 5)}
            low, high = defaults.get(variable, (0, 2))
            start = float(query.get("start", [low])[0])
            stop = float(query.get("stop", [high])[0])
            count = int(query.get("count", [81])[0])
            return self.reply(200, sweep_json(p, variable, start, stop, count))
        except (ValueError, OverflowError) as error:
            return self.reply(400, json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8"))
        except FileNotFoundError:
            return self.reply(404, b'{"error":"File not found"}')


def main():
    parser = argparse.ArgumentParser(description="Local Quantum Tunneling Lab")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the default browser after starting")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535")
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as error:
        parser.exit(1, f"Cannot start: {error}. Use --port to select another port.\n")
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Quantum Tunneling Lab → {url}\nPress Ctrl+C to stop.", flush=True)
    if args.open:
        import webbrowser
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
