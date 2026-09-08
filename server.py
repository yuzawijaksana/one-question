from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
import os
import threading
import time

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765
STATE_FILE = ROOT / "one-question-state.json"
STATE_KEYS = {
    "oneQuestionQuestionBank",
    "oneQuestionFocusQuestions",
    "oneQuestionSettings",
    "oneQuestionHistory",
    "oneQuestionRecent",
    "oneQuestionTodos",
}


def load_state():
    if not STATE_FILE.exists():
        return {"version": 1, "keys": {}}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("keys"), dict):
            raise ValueError
        return data
    except Exception:
        return {"version": 1, "keys": {}}


def save_state(state):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_FILE)


STATE = load_state()
STATE_LOCK = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/state":
            with STATE_LOCK:
                payload = json.loads(json.dumps(STATE))
            self._json(200, payload)
            return
        super().do_GET()

    def do_PUT(self):
        if self.path != "/api/state":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            changes = payload.get("changes", {})
            if not isinstance(changes, dict):
                raise ValueError("changes must be an object")

            changed = False
            with STATE_LOCK:
                for key, entry in changes.items():
                    if key not in STATE_KEYS or not isinstance(entry, dict):
                        continue
                    value = entry.get("value")
                    updated_at = int(entry.get("updatedAt", 0))
                    if updated_at <= 0:
                        updated_at = int(time.time() * 1000)
                    current = STATE["keys"].get(key)
                    current_time = int(current.get("updatedAt", 0)) if isinstance(current, dict) else 0
                    if updated_at >= current_time:
                        STATE["keys"][key] = {"updatedAt": updated_at, "value": value}
                        changed = True
                if changed:
                    STATE["version"] = 1
                    STATE["updatedAt"] = int(time.time() * 1000)
                    save_state(STATE)
                result = json.loads(json.dumps(STATE))
            self._json(200, result)
        except Exception as exc:
            self._json(400, {"error": str(exc)})

    def do_POST(self):
        # Kept for compatibility with the old Stop Server button.
        if self.path == "/shutdown":
            body = b"Server stopping"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        self.send_error(404)

    def log_message(self, format, *args):
        # Keep normal console output useful when launched manually.
        print(f"[{self.log_date_time_string()}] {format % args}")


if __name__ == "__main__":
    os.chdir(ROOT)
    url = f"http://{HOST}:{PORT}/index.html"
    print("One Question shared local server")
    print(f"Serving: {ROOT}")
    print(f"URL:     {url}")
    print(f"State:   {STATE_FILE}")
    print("The extension, web page, and Wallpaper Engine share this state.")
    print("You can press Ctrl+C to stop when running manually.")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()
