"""Exercise real HTTP parsing and dispatch without needing a listening socket."""

from io import BytesIO
import json
import unittest
from zipfile import ZipFile

from app import Handler, source_archive


class Connection:
    def __init__(self, request):
        self.incoming = BytesIO(request)
        self.outgoing = bytearray()

    def makefile(self, mode, *args):
        return self.incoming

    def sendall(self, data):
        self.outgoing.extend(data)


class QuietHandler(Handler):
    def log_message(self, *args):
        pass


def request(path, method="GET"):
    connection = Connection(f"{method} {path} HTTP/1.0\r\nHost: localhost\r\n\r\n".encode())
    QuietHandler(connection, ("127.0.0.1", 1234), None)
    header, body = bytes(connection.outgoing).split(b"\r\n\r\n", 1)
    return int(header.split(b" ")[1]), header, body


class HTTPTests(unittest.TestCase):
    def test_surface_uses_numerical_solver_and_correct_axis_order(self):
        from quantum_tunneling import simulate, Parameters
        status, _, body = request('/api/surface?count=5&energy=1&shape=double&gap=0.5')
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(result['widths'], [0, 0.5, 1, 1.5, 2])
        self.assertEqual(result['heights'], [0, 2, 4, 6, 8])
        expected = simulate(Parameters(shape='double',height=2,width=0.5))['transmission']
        self.assertAlmostEqual(result['transmission'][1][1], expected, places=12)
        self.assertTrue(all(abs(row[0]-1)<1e-8 for row in result['transmission']))
        self.assertTrue(all(abs(t-1)<1e-8 for t in result['transmission'][0]))

    def test_surface_rejects_excessive_or_invalid_resolution(self):
        for count in ('0', '4', '62', '10000', 'nan', '4.5'):
            self.assertEqual(request('/api/surface?count='+count)[0], 400)

    def test_simulate_real_route(self):
        status, _, body = request("/api/simulate?energy=1&height=2&width=0.5")
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertLess(result["absolute_error"], 1e-5)
        self.assertEqual(len(result["x"]), len(result["real"]))

    def test_sweep_real_route(self):
        status, _, body = request("/api/sweep?variable=energy&start=0.1&stop=3&count=5")
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)["values"]), 5)

    def test_malformed_requests_fail_cleanly(self):
        for query in ("energy=nan", "dx=0", "shape=unknown", "width=-1", "energy=1&energy=2", "unknown=1"):
            with self.subTest(query=query):
                status, _, body = request("/api/simulate?" + query)
                self.assertEqual(status, 400)
                self.assertIn("error", json.loads(body))
        for query in ("count=3.1", "count=10000", "start=2&stop=1", "variable=gap"):
            self.assertEqual(request("/api/sweep?" + query)[0], 400)

    def test_only_explicit_static_files_are_exposed(self):
        for path in ("/../README.md", "/%2e%2e/README.md", "/app.py", "/.git/config"):
            self.assertEqual(request(path)[0], 404)
        self.assertEqual(request("/")[0], 200)
        self.assertEqual(request("/blog")[0], 200)
        self.assertEqual(request("/blog.md")[0], 200)
        self.assertEqual(request("/static/style.css")[0], 200)
        self.assertEqual(request("/static/app.js")[0], 200)
        for name in ("packet-core.js", "packet-ui.js", "packet-worker.js"):
            status, header, body = request("/static/" + name)
            self.assertEqual(status, 200)
            self.assertIn(b"text/javascript", header)
            self.assertTrue(body)


    def test_source_archive_is_scoped_to_project(self):
        with ZipFile(BytesIO(source_archive())) as archive:
            names = archive.namelist()
            self.assertIn("quantum-tunneling/quantum_tunneling/solver.py", names)
            self.assertIn("quantum-tunneling/LICENSE", names)
            self.assertTrue(all(name.startswith("quantum-tunneling/") for name in names))
            self.assertFalse(any("__pycache__" in name or "/.git/" in name for name in names))

    def test_head_contains_headers_but_no_body(self):
        status, header, body = request("/", "HEAD")
        self.assertEqual(status, 200)
        self.assertIn(b"Content-Length:", header)
        self.assertEqual(body, b"")


if __name__ == "__main__":
    unittest.main()
