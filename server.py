from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import threading
import queue
import time

# on Windows, run git (and any subprocess) without flashing a console window
_NO_WINDOW = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("ONE_QUESTION_HOST", "127.0.0.1")
PORT = int(os.environ.get("ONE_QUESTION_PORT", "8765"))
STATE_FILE = ROOT / os.environ.get("ONE_QUESTION_STATE_FILE", "one-question-state.json")
# Optional shared secret: when set, requests must send "Authorization: Bearer <key>"
API_KEY = os.environ.get("ONE_QUESTION_API_KEY", "")
EXPORT_DIR = ROOT / "settings export"
# each server instance exports to its own file (env override) so a second
# instance sharing this directory never overwrites the other's backup
EXPORT_FILE = ROOT / os.environ.get(
    "ONE_QUESTION_EXPORT_FILE", "settings export/one-question-backup-latest.json"
)
STATE_KEYS = {
    "oneQuestionQuestionBank",
    "oneQuestionFocusQuestions",
    "oneQuestionSettings",
    "oneQuestionHistory",
    "oneQuestionRecent",
    "oneQuestionTodos",
    "oneQuestionNote",
    "oneQuestionSchedule",
    "oneQuestionStickies",
    "oneQuestionHydration",
    "oneQuestionBook",
    "oneQuestionQuotes",
    "oneQuestionDeadlines",
    "oneQuestionJournal",
    "oneQuestionSholat",
    "oneQuestionHermes",
}


# maps backup field names to state keys for the settings export snapshot
EXPORT_MAP = {
    "questions": "oneQuestionQuestionBank",
    "focusQuestions": "oneQuestionFocusQuestions",
    "settings": "oneQuestionSettings",
    "history": "oneQuestionHistory",
    "recent": "oneQuestionRecent",
    "todos": "oneQuestionTodos",
    "note": "oneQuestionNote",
    "schedule": "oneQuestionSchedule",
    "stickies": "oneQuestionStickies",
    "book": "oneQuestionBook",
    "quotes": "oneQuestionQuotes",
    "deadlines": "oneQuestionDeadlines",
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


def _session_usage(session_id):
    """Read token usage + model for a hermes session from state.db.
    Returns {'model','in','out'} or None. Read-only, best-effort."""
    try:
        import sqlite3
        db_path = Path.home() / ".hermes" / "state.db"
        if not db_path.exists():
            return None
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=3)
        try:
            row = con.execute(
                "select model, input_tokens, output_tokens from sessions where id=?",
                (session_id,)).fetchone()
        finally:
            con.close()
        if not row or not row[0]:
            return None
        return {"model": row[0], "in": row[1] or 0, "out": row[2] or 0}
    except Exception:
        return None


def schedule_is_downgrade(new, old):
    """Guard: a blank or junk schedule never wipes a real, richer one.
    Junk signature seen in the wild: an empty list, or a handful of generic
    blocks (bangun/tidur/keyboard-mash) clobbering a 8+ block routine."""
    GENERIC_LABELS = {"", "tidur", "bangun", "bangun subuh", "hdheisn"}
    if not isinstance(new, list) or not new:
        return True
    if not isinstance(old, list) or len(old) < 8:
        return False  # nothing meaningful to protect yet
    labels = []
    for x in new:
        if not isinstance(x, dict):
            continue
        labels.append(str(x.get("label", "")).strip().lower())
    distinct = {l for l in labels if l and l not in GENERIC_LABELS}
    if len(new) <= 5 and len(distinct) <= 1:
        return True  # tiny generic schedule clobbering a rich one
    return False


def book_is_empty(value):
    """A book with no title and no chapter content is a fresh placeholder —
    a client-side placeholder must never overwrite real writing."""
    if not isinstance(value, dict):
        return True
    if str(value.get("title") or "").strip():
        return False
    chapters = value.get("chapters")
    if not isinstance(chapters, list):
        return True
    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue
        if str(chapter.get("title") or "").strip():
            return False
        if str(chapter.get("category") or "").strip():
            return False
        if str(chapter.get("html") or "").strip():
            return False
    return True


# SSE subscribers: one queue per connected client; a tick is pushed on state writes
SSE_CLIENTS = set()
SSE_LOCK = threading.Lock()


def sse_broadcast(event="state"):
    with SSE_LOCK:
        queues = list(SSE_CLIENTS)
    for q in queues:
        try:
            q.put_nowait(event)
        except Exception:
            pass


def save_state(state):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_FILE)
    export_snapshot()
    sse_broadcast()


def export_snapshot():
    """Write the current state as an importable backup into 'settings export'."""
    try:
        keys = STATE.get("keys", {})
        if not keys:
            # nothing synced yet — never write an empty backup over a real one
            return
        data = {}
        for name, key in EXPORT_MAP.items():
            entry = keys.get(key)
            data[name] = entry.get("value") if isinstance(entry, dict) else None
        payload = {
            "format": "one-question-zen-backup",
            "version": "2.21.3",
            "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "data": data,
        }
        EXPORT_DIR.mkdir(exist_ok=True)
        tmp = EXPORT_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, EXPORT_FILE)
    except Exception as exc:
        print(f"[export] snapshot failed: {exc}")


STATE = load_state()
STATE_LOCK = threading.Lock()

# ---- self-update: pull the latest code from git without any merging ----
# Runtime state files are data, not code: they change while the server
# serves and would collide with every pull. So an update never merges —
# it backs the runtime files up, hard-resets to origin/main, then puts
# the runtime files back. Code ends up exactly upstream, data survives.
UPDATE_RUNTIME_FILES = [
    "one-question-state.json",
    "one-question-state-shared.json",
    "settings export/one-question-backup-latest.json",
]


def _git(args, timeout=120, env=None):
    proc = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True,
        timeout=timeout, creationflags=_NO_WINDOW, env=env
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout.rstrip()


def self_update_from_git():
    try:
        before = _git(["rev-parse", "--short", "HEAD"])
    except Exception:
        raise RuntimeError("not a git repository (or git is unavailable)")
    # safety: never reset over work origin doesn't have. resetting while
    # HEAD is ahead would orphan unpushed commits on main — refuse until
    # they are pushed (they also survive on the unpushed-work branch)
    _git(["fetch", "origin"])
    ahead = _git(["rev-list", "--count", "origin/main..HEAD"]) or "0"
    if int(ahead) > 0:
        raise RuntimeError(
            f"update skipped: HEAD is {ahead} commit(s) ahead of origin/main — push first")
    # safety: the reset below discards uncommitted edits to tracked files.
    # runtime data is backed up and restored, but code edits are not —
    # refuse and name them so a day's work is never silently lost
    protected = set(UPDATE_RUNTIME_FILES)
    dirty = []
    for line in _git(["status", "--porcelain", "-z", "--untracked-files=no"]).split("\x00"):
        if not line:
            continue
        path = line[3:].split(" -> ")[-1].strip().strip('"')
        if path and path not in protected:
            dirty.append(path)
    if dirty:
        code_dirty = [p for p in dirty if p not in UPDATE_RUNTIME_FILES]
        if code_dirty:
            listed = ", ".join(code_dirty[:5]) + (" …" if len(code_dirty) > 5 else "")
            raise RuntimeError(
                f"update skipped: uncommitted changes in {listed} — commit or stash first")
        # only runtime data is dirty: stash it, update, then restore — the
        # PC's state file changes constantly (auto-push) and must never
        # block an update the way uncommitted code edits do
        _git(["stash", "push", "--", *dirty])
        _stash_restore = True
    else:
        _stash_restore = False
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = ROOT.parent / "one-question-update-backups" / f"{stamp}-{before}"
    saved = []
    for rel in UPDATE_RUNTIME_FILES:
        src = ROOT / rel
        if src.exists():
            dst = backup_dir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            # copy runtime → backup; a file that cannot be read is skipped
            # (warned) rather than cancelling the whole update
            try:
                shutil.copy2(src, dst)
                saved.append((src, dst))
            except Exception as exc:
                print(f"[update] backup failed for {rel}: {exc}", flush=True)
    try:
        _git(["reset", "--hard", "origin/main"])
        after = _git(["rev-parse", "--short", "HEAD"])
        commits = _git(["rev-list", "--count", f"{before}..{after}"]) or "0"
        sse_broadcast("version")
        return {"ok": True, "before": before, "after": after, "commits": commits,
                "updated": before != after, "backup": str(backup_dir)}
    finally:
        # runtime data returns no matter how the reset went
        for src, dst in saved:
            try:
                shutil.copy2(dst, src)
            except Exception as exc:
                print(f"[update] restore failed for {src.name}: {exc}", flush=True)
        # bring back stashed runtime-data edits (update was allowed because
        # only runtime files were dirty)
        try:
            if _stash_restore and _git(["stash", "list"]).strip():
                _git(["stash", "pop"])
        except Exception as exc:
            print(f"[update] stash restore skipped: {exc}", flush=True)


def installed_version():
    """The build this server actually serves. owl build: latest code commit's
    version tag from its subject (v2.59 style), falling back to the short hash.
    Lets clients tell 'server behind origin' from 'page behind server'."""
    try:
        subj = _git(["log", "-1", "--format=%s", "--", "index.html", "app.js"]) or ""
        m = re.search(r"\(v([\d.]+)\)", subj)
        if m:
            return "v" + m.group(1)
        return _git(["rev-parse", "--short", "HEAD"])
    except Exception:
        return ""


# runtime data lives inside the repo but is not code. commits that only
# touch these paths are snapshots (the PC's auto-push task), not updates —
# they must never light up the update card
UPDATE_DATA_EXCLUDES = [
    ":!one-question-state.json",
    ":!one-question-state-shared.json",
    ":!settings export",
]


def _auto_push_runtime():
    """Silently commit+push runtime-data files (state, backups). Never touches
    code; never raises — failures are logged and simply retried next write."""
    try:
        _git(["add", "one-question-state.json", "one-question-state-shared.json",
              "settings export"], timeout=30)
        staged = _git(["diff", "--cached", "--name-only"])
        if staged.strip():
            _git(["commit", "-m", "auto: runtime data sync",
                  "--no-verify"], timeout=30)
            # credential helper needs HOME (~/.git-credentials)
            env_home = os.environ.get("HOME") or str(Path.home())
            _git(["push", "origin", "HEAD:main"], timeout=60,
                 env={**os.environ, "HOME": env_home})
    except Exception as exc:
        print(f"[auto-push] skipped: {exc}", flush=True)


def git_update_status():
    # a read-only look at what a self-update would bring: fetch origin,
    # then count and list the commits HEAD is behind — counting only commits
    # that touch code, so data snapshots don't pose as updates. never touches
    # the working tree, so the corner card can poll it freely
    try:
        _git(["fetch", "origin"], timeout=30)
        current = _git(["rev-parse", "--short", "HEAD"])
        remote = _git(["rev-parse", "--short", "origin/main"])
        count = _git(["rev-list", "--count", "HEAD..origin/main", "--",
                      ".", *UPDATE_DATA_EXCLUDES]) or "0"
        # ahead = unpushed local commits; a self-update refuses to run over
        # them, so the client needs to know to say "push first"
        ahead = _git(["rev-list", "--count", "origin/main..HEAD"]) or "0"
        log = (_git(["log", "--format=%h%ad%s",
                     "--date=format:%d %b %Y", "HEAD..origin/main", "--",
                     ".", *UPDATE_DATA_EXCLUDES])
               if count != "0" else "")
        changes = []
        for line in log.splitlines():
            if not line.strip():
                continue
            parts = line.split("")
            if len(parts) == 3:
                changes.append({"hash": parts[0], "date": parts[1],
                                "subject": parts[2]})
            else:
                changes.append({"hash": "", "date": "", "subject": line.strip()})
        return {"ok": True, "current": current, "remote": remote,
                "behind": int(count), "ahead": int(ahead), "changes": changes,
                "version": installed_version()}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "behind": 0, "ahead": 0,
                "changes": [], "version": installed_version()}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        # Authorization must be allowed or browsers block cross-origin pushes
        # from any page not served by this server (CORS preflight fails)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        # POST matters too: the self-update call is a POST, and a page served
        # from another origin would fail its CORS preflight without it
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
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

    def _authorized(self):
        if not API_KEY:
            return True
        expected = f"Bearer {API_KEY}"
        return self.headers.get("Authorization", "") == expected

    def do_GET(self):
        if self.path == "/api/events":
            if not self._authorized():
                self._json(401, {"error": "unauthorized"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            q = queue.Queue()
            with SSE_LOCK:
                SSE_CLIENTS.add(q)
            try:
                self.wfile.write(b": connected\n\n")
                self.wfile.flush()
                while True:
                    try:
                        evt = q.get(timeout=15)
                        self.wfile.write(("data: "+evt+"\n\n").encode())
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except Exception:
                pass
            finally:
                with SSE_LOCK:
                    SSE_CLIENTS.discard(q)
            return
        if self.path == "/api/state":
            if not self._authorized():
                self._json(401, {"error": "unauthorized"})
                return
            with STATE_LOCK:
                payload = json.loads(json.dumps(STATE))
            self._json(200, payload)
            return
        if self.path == "/api/update/log":
            if not self._authorized():
                self._json(401, {"error": "unauthorized"})
                return
            try:
                log = _git(["log", "--format=%h%ad%s",
                            "--date=format:%d %b %Y", "-30", "--",
                            ".", *UPDATE_DATA_EXCLUDES])
                changes = []
                for line in log.splitlines():
                    if not line.strip():
                        continue
                    parts = line.split("")
                    if len(parts) == 3:
                        changes.append({"hash": parts[0], "date": parts[1],
                                        "subject": parts[2]})
                self._json(200, {"ok": True, "changes": changes})
            except Exception as exc:
                self._json(200, {"ok": False, "changes": [], "error": str(exc)})
            return
        if self.path == "/api/update/status":
            if not self._authorized():
                self._json(401, {"error": "unauthorized"})
                return
            self._json(200, git_update_status())
            return
        super().do_GET()

    def do_PUT(self):
        if self.path != "/api/state":
            self.send_error(404)
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
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
                    # guard: a blank placeholder book never overwrites stored writing
                    if key == "oneQuestionBook" and book_is_empty(value):
                        continue
                    # guard: a blank/junk schedule never overwrites a real routine
                    if key == "oneQuestionSchedule":
                        cur = STATE["keys"].get(key)
                        current_value = cur.get("value") if isinstance(cur, dict) else None
                        if schedule_is_downgrade(value, current_value):
                            print(f"[guard] skipped schedule downgrade "
                                  f"({len(value) if isinstance(value, list) else 'non-list'} blocks "
                                  f"vs {len(current_value) if isinstance(current_value, list) else '?'} stored)",
                                  flush=True)
                            continue
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
                    threading.Thread(target=_auto_push_runtime, daemon=True).start()
                result = json.loads(json.dumps(STATE))
            self._json(200, result)
        except Exception as exc:
            self._json(400, {"error": str(exc)})

    def do_POST(self):
        if self.path == "/api/update":
            if not self._authorized():
                self._json(401, {"error": "unauthorized"})
                return
            try:
                self._json(200, self_update_from_git())
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return
        if self.path == "/api/hermes":
            if not self._authorized():
                self._json(401, {"error": "unauthorized"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                prompt = str(payload.get("prompt", "")).strip()
                session = str(payload.get("session", "")).strip() or None
                raw = payload.get("effort", 180)
                tiers = {"flash": 15, "quick": 30, "reasonable": 75,
                         "explanation": 120, "thinking": 180, "max": 0}
                if isinstance(raw, str) and raw in tiers:
                    effort = tiers[raw]
                else:
                    try:
                        effort = max(1, min(600, int(raw)))
                    except (TypeError, ValueError):
                        effort = 180
                no_limit = effort == 0
                if effort == 0:
                    effort = 600  # sentinel; subprocess timeout 600s
                elif effort < 45:
                    effort = 45
                # FLASH/QUICK fast-path: skip the agent entirely — direct LLM
                # call (no tools/session spawn), answers in ~2-8s
                if raw in ("flash", "quick"):
                    if raw == "quick":
                        sysmsg = ("Kamu asisten widget chat. Jawab singkat & jelas: "
                                  "2-3 kalimat max, bahasa santai, boleh ada penjelasan "
                                  "kecil kalau perlu.")
                        effort = 30
                    else:
                        sysmsg = ("Kamu asisten widget chat. Jawab SANGAT SINGKAT: "
                                  "max 10 kata, 1 kalimat, bahasa santai. "
                                  "Tanpa penjelasan, tanpa format.")
                        effort = 15
                    try:
                        import urllib.request
                        env_path = Path.home() / ".hermes" / ".env"
                        api_key = ""
                        if env_path.exists():
                            for line in env_path.read_text().splitlines():
                                if line.startswith("ZAI_API_KEY="):
                                    api_key = line.split("=", 1)[1].strip()
                                    break
                        if api_key:
                            body = json.dumps({
                                "model": "glm-5.3-flash",
                                "messages": [
                                    {"role": "system", "content": sysmsg},
                                    {"role": "user", "content": prompt},
                                ],
                            }).encode()
                            req = urllib.request.Request(
                                "https://api.z.ai/api/coding/paas/v4/chat/completions",
                                data=body,
                                headers={"Content-Type": "application/json",
                                         "Authorization": f"Bearer {api_key}"},
                            )
                            with urllib.request.urlopen(req, timeout=20) as resp:
                                out = json.loads(resp.read().decode())
                            text = (out.get("choices") or [{}])[0].get("message", {}).get("content", "")
                            if text:
                                usage = out.get("usage") or {}
                                self._json(200, {"ok": True, "reply": text.strip()[-1000:],
                                                 "session": "flash",
                                                 "model": "glm-5.3-flash",
                                                 "usage": {"in": usage.get("prompt_tokens", 0),
                                                           "out": usage.get("completion_tokens", 0),
                                                           "total": usage.get("total_tokens", 0)}})
                                return
                        # no key or empty answer -> fall through to hermes
                    except Exception as flash_exc:
                        print(f"[flash] fast-path failed, fallback to hermes: {flash_exc}",
                              flush=True)
                if not prompt:
                    self._json(400, {"error": "empty prompt"})
                    return
                # hard cap prompt length; hermes runs as the same user as this server
                if len(prompt) > 4000:
                    self._json(400, {"error": "prompt too long (max 4000)"})
                    return
                # keep widget answers short: cap scales with effort
                if effort <= 30:
                    cap = "Jawab MAX 10 KATA, 1 kalimat, gaya santai. Tanpa penjelasan."
                elif effort <= 60:
                    cap = "Jawab SINGKAT (max 2 kalimat), gaya santai."
                else:
                    cap = "Jawab ringkas & padat, gaya santai."
                prompt = cap + "\n\n" + prompt
                # route the chat to a remote hermes (e.g. the VPS) when
                # ONE_QUESTION_HERMES_SSH is set (user@host); the prompt
                # travels over stdin so no remote shell-quoting is needed
                remote = os.environ.get("ONE_QUESTION_HERMES_SSH", "").strip()
                if remote:
                    cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                           remote, 'hermes --cli -z "$(cat)"']
                else:
                    cmd = ["hermes", "--cli", "-z", prompt]
                if effort <= 30:
                    cmd += ["--reasoning", "low"]  # fast path: short casual answers
                if session:
                    cmd += ["--resume", session]
                try:
                    def _run(c):
                        return subprocess.run(
                            c, capture_output=True, text=True, timeout=effort,
                            input=prompt,
                            env={**os.environ, "TERM": "dumb"},
                            creationflags=_NO_WINDOW,
                        )
                    proc = _run(cmd)
                    out = (proc.stdout or "").strip()
                    # rotated/new session id not known to hermes yet ("session
                    # not found") -> drop --resume and start a fresh session
                    if proc.returncode != 0 and "session not found" in (
                        (proc.stderr or "") + " " + out
                    ).lower():
                        fresh = [c for c in cmd if c != "--resume" and c != session]
                        proc = _run(fresh)
                        out = (proc.stdout or "").strip()
                    if proc.returncode != 0 and not out:
                        out = (proc.stderr or "hermes failed").strip()
                    # the client's id is arbitrary; hermes stores its own session
                    # ids. Always resolve the real id from the listing so usage
                    # lookup matches the db
                    eff_session = session
                    usage_lookup_id = None
                    if proc.returncode == 0 and out:
                        try:
                            import sqlite3
                            db_path = Path.home() / ".hermes" / "state.db"
                            con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=3)
                            try:
                                row = con.execute(
                                    "select id from sessions order by started_at desc limit 1"
                                ).fetchone()
                            finally:
                                con.close()
                            if row and row[0]:
                                sid = row[0]
                                # keep client id for resume; use real id for usage lookup
                                usage_lookup_id = sid
                                if not session:
                                    eff_session = sid
                        except Exception:
                            pass
                    self._json(200, {"ok": True, "reply": out[-8000:], "session": eff_session,
                                     **({"model": u["model"], "usage": {"in": u["in"], "out": u["out"]}}
                                        if (u := _session_usage(usage_lookup_id or eff_session)) else {})})
                except subprocess.TimeoutExpired:
                    self._json(200, {"ok": False, "reply": "kepotong di "+str(effort)+"s — naikin effort (⚡) atau tanya lebih simpel"})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return
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
    export_snapshot()
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
