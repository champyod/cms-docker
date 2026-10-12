#!/usr/bin/env python3
"""Serve the vendored ranking page with a stub backend so the client board can be
driven in a browser without PostgreSQL.

WHY this exists: the page now draws the server's override-applied board from /board
(names, teams, scores and ranks already resolved), and the behaviour that matters — a
rename shown, a hidden user gone, a guest ranked, a server rank honoured — is only
visible once the vendored JavaScript has run. ranking_e2e.sh proves the server; this
harness proves the page that consumes it.

Usage:
    python3 client_board_harness.py <static_dir> <port>
    # then open http://127.0.0.1:<port>/ in a browser, or point Playwright at it and
    # assert #Scoreboard_body holds three rows: u1 rank 1, u0 renamed, a guest at rank 3,
    # and no row for the hidden u2 even though /scores still carries its value.

The stub board is override-applied exactly as /board returns it: u0 renamed to
"Ada Lovelace", u2 absent although it still scores in /scores, a guest with no
participation present.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATIC = Path(sys.argv[1]).resolve()
PORT = int(sys.argv[2])
STAMP = "1700000000.000000"

BOARD = {
    "u0": {"f_name": "Ada", "l_name": "Lovelace", "team": "t0", "score": 10.0, "rank": 2},
    "u1": {"f_name": "Alan", "l_name": "Turing", "team": "t0", "score": 30.0, "rank": 1},
    "visitor": {"f_name": "Guest", "l_name": "Visitor", "team": None, "score": 0.0, "rank": 3},
}
SCORES = {"u0": {"t0": 10.0}, "u1": {"t0": 30.0}, "u2": {"t0": 99.0}}

JSON_ROUTES = {
    "/config": {"show_id_column": False, "source_url": "https://example.invalid/fork"},
    "/teams/": {"t0": {"name": "Team Zero"}},
    "/contests/": {"c0": {"name": "Fixture Contest", "begin": 0, "end": 0, "score_precision": 0}},
    "/tasks/": {
        "t0": {
            "name": "Task One", "short_name": "T1", "contest": "c0", "max_score": 100.0,
            "extra_headers": [], "order": 0, "score_precision": 0,
        }
    },
    "/board": BOARD,
    "/board/teams": {
        "t0": {"name": "Team Zero", "score": 40.0, "rank": 1, "members": ["u0", "u1"]},
    },
    "/scores": SCORES,
    "/history": [["u1", "t0", 1000, 10.0], ["u1", "t0", 2000, 40.0]],
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _json(self, body):
        payload = json.dumps(body, separators=(", ", ": ")).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Timestamp", STAMP)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in JSON_ROUTES:
            self._json(JSON_ROUTES[path])
            return
        if path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b":\n\n")
            return
        if path in ("/", "/index.html"):
            target = STATIC / "Ranking.html"
        elif path.startswith("/logo") or path.startswith("/flags/") or path.startswith("/faces/"):
            self.send_response(204)
            self.end_headers()
            return
        else:
            target = STATIC / path.lstrip("/")
        if target.is_file() and STATIC in target.resolve().parents:
            self.send_response(200)
            self.send_header("Content-Length", str(target.stat().st_size))
            self.end_headers()
            self.wfile.write(target.read_bytes())
            return
        self.send_response(404)
        self.end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
