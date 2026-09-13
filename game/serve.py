"""Serve the game locally and let it launch the desktop pong game.

    python3 game/serve.py            # http://127.0.0.1:8000

Same as `python3 -m http.server` from game/, plus one endpoint the page uses:
    POST /launch   → starts `.venv/bin/python -m bracket_pong.play` from the repo root
    GET  /launch   → {"running": bool}
On a plain static host the page falls back to showing the command instead.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

GAME_DIR = Path(__file__).resolve().parent
ROOT = GAME_DIR.parent
PYTHON = ROOT / ".venv" / "bin" / "python"
PROC: subprocess.Popen | None = None


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter than the default
        if "/launch" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/launch":
            running = PROC is not None and PROC.poll() is None
            return self._json(200, {"running": running, "available": PYTHON.exists()})
        return super().do_GET()

    def do_POST(self):
        global PROC
        if self.path.split("?")[0] != "/launch":
            return self._json(404, {"error": "not found"})
        if not PYTHON.exists():
            return self._json(503, {"error": "no .venv — run `uv sync --locked` in the repo root first"})
        if PROC is not None and PROC.poll() is None:
            return self._json(200, {"running": True, "started": False})
        try:
            PROC = subprocess.Popen([str(PYTHON), "-m", "bracket_pong.play"], cwd=ROOT,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as exc:
            return self._json(500, {"error": str(exc)})
        return self._json(200, {"running": True, "started": True, "pid": PROC.pid})

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(GAME_DIR)
    server = ThreadingHTTPServer(("0.0.0.0", port), partial(Handler, directory=str(GAME_DIR)))
    print(f"BracketBot Robotics → http://127.0.0.1:{port}   (launcher: {'ready' if PYTHON.exists() else 'no .venv'})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
