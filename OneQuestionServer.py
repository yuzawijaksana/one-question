import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import webbrowser
from pathlib import Path

APP_NAME = "One Question Server"
HOST = "127.0.0.1"
PORT = 8765
ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server.py"
TASK_NAME = "One Question Server"
TASK_XML = ROOT / ".one-question-task.xml"


def http_get(path="/api/state", timeout=1.0):
    with urllib.request.urlopen(f"http://{HOST}:{PORT}{path}", timeout=timeout) as r:
        return r.read()


def server_running():
    try:
        http_get("/api/state", 0.8)
        return True
    except Exception:
        return False


def python_for_background():
    """Return a real Python executable suitable for hidden/background use."""
    candidates = []

    if sys.executable:
        exe = Path(sys.executable)
        # Prefer pythonw.exe so a manually started controller never leaves a
        # console window behind when the server is launched.
        if exe.name.lower() == "python.exe":
            pw = exe.with_name("pythonw.exe")
            if pw.exists():
                candidates.append(str(pw))
        candidates.append(str(exe))

    # Fall back to PATH only when the current interpreter is unavailable.
    if os.name == "nt":
        candidates += ["pythonw.exe", "python.exe"]
    else:
        candidates += ["python3", "python"]

    seen = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            if Path(candidate).exists() or os.path.basename(candidate).lower() in {
                "pythonw.exe", "python.exe", "python3", "python"
            }:
                result = subprocess.run(
                    [candidate, "--version"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=3,
                )
                if result.returncode == 0:
                    return candidate
        except Exception:
            pass
    return None


def start_server():
    if server_running():
        return True

    if not SERVER.exists():
        print(f"\n  server.py was not found:\n  {SERVER}\n")
        return False

    py = python_for_background()
    if not py:
        print("\n  Python 3 could not be found.\n")
        return False

    creationflags = 0
    startupinfo = None
    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        # Detached is deliberately not used: keeping the child independent
        # from this controller is handled by the OS process relationship and
        # the controller never waits on the server process.

    try:
        subprocess.Popen(
            [py, str(SERVER)],
            cwd=str(ROOT),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            close_fds=(os.name != "nt"),
        )
    except Exception as exc:
        print(f"\n  Could not start server:\n  {exc}\n")
        return False

    for _ in range(30):
        time.sleep(0.2)
        if server_running():
            return True
    return False


def stop_server():
    if not server_running():
        return True
    try:
        req = urllib.request.Request(
            f"http://{HOST}:{PORT}/shutdown", method="POST"
        )
        with urllib.request.urlopen(req, timeout=1.5) as r:
            r.read()
    except Exception:
        # The server may have already closed the socket after accepting the
        # shutdown request. Verify below instead of treating that as failure.
        pass

    for _ in range(20):
        time.sleep(0.15)
        if not server_running():
            return True
    return False


def current_user():
    return os.environ.get("USERNAME") or os.environ.get("USER") or ""


def xml_escape(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def task_command():
    py = python_for_background()
    if not py:
        return None
    # Use schtasks command-line creation instead of XML import. This is much
    # more compatible across Windows versions and avoids XML namespace/version
    # differences between Task Scheduler implementations.
    return py, str(SERVER), str(ROOT)

def run_schtasks(args, timeout=8):
    try:
        return subprocess.run(
            ["schtasks.exe"] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="mbcs" if os.name == "nt" else "utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0,
        )
    except Exception as exc:
        return None


def startup_enabled():
    result = run_schtasks(["/Query", "/TN", TASK_NAME])
    return bool(result and result.returncode == 0)


def enable_startup():
    if os.name != "nt":
        print("\n  Windows Task Scheduler is only available on Windows.\n")
        return False

    command = task_command()
    if not command:
        print("\n  Could not find a usable Python installation.\n")
        return False

    py, server, root = command
    user = current_user()
    # schtasks /SC ONLOGON is intentionally used instead of XML. The task runs
    # as the current user at logon and does not need an elevated RunLevel.
    task_run = f'"{py}" "{server}"'
    result = run_schtasks([
        "/Create",
        "/TN", TASK_NAME,
        "/SC", "ONLOGON",
        "/TR", task_run,
        "/RU", user,
        "/RL", "LIMITED",
        "/F",
    ])

    if result and result.returncode == 0 and startup_enabled():
        return True

    print("\n  Could not create the Windows scheduled task.")
    if result and result.stderr.strip():
        print("  " + result.stderr.strip().replace("\n", "\n  "))
    elif result and result.stdout.strip():
        print("  " + result.stdout.strip().replace("\n", "\n  "))
    return False

def disable_startup():
    if os.name != "nt":
        return True
    result = run_schtasks(["/Delete", "/TN", TASK_NAME, "/F"])
    if result and result.returncode == 0:
        return True
    # Not existing is effectively disabled.
    return not startup_enabled()


def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")


def print_status():
    running = server_running()
    print("\n" + "=" * 62)
    print(" SERVER STATUS")
    print("=" * 62)
    print("  ● RUNNING" if running else "  ○ STOPPED")
    print(f"  API        http://{HOST}:{PORT}")
    print(f"  Windows startup task: {'ENABLED' if startup_enabled() else 'DISABLED'}")
    print(f"  Task name: {TASK_NAME}")
    print("=" * 62)


def show_state():
    state = ROOT / "one-question-state.json"
    print("\n  State file:")
    print(f"  {state}")
    if not state.exists():
        print("  State file does not exist yet.")
        return
    try:
        data = json.loads(state.read_text(encoding="utf-8"))
        print(f"  Size: {state.stat().st_size:,} bytes")
        print(f"  Top-level keys: {len(data)}")
        for key, value in data.items():
            if isinstance(value, list):
                desc = f"list ({len(value)} items)"
            elif isinstance(value, dict):
                desc = f"object ({len(value)} keys)"
            else:
                desc = type(value).__name__
            print(f"    - {key}: {desc}")
    except Exception as exc:
        print(f"  Could not read state: {exc}")


def pause():
    input("\n  Press Enter to continue...")


def main_menu():
    while True:
        clear_screen()
        running = server_running()
        enabled = startup_enabled()

        print("=" * 62)
        print("                 ONE QUESTION")
        print("                 SERVER CONTROL")
        print("=" * 62)
        print(f"  Server:  {'RUNNING' if running else 'STOPPED'}")
        print(f"  API:     http://{HOST}:{PORT}")
        print(f"  Startup: {'ENABLED (Task Scheduler)' if enabled else 'DISABLED'}")
        print()
        print("  [1] Start server")
        print("  [2] Stop server")
        print("  [3] Refresh status")
        print("  [4] Open One Question")
        print("  [5] Enable start with Windows")
        print("  [6] Disable start with Windows")
        print("  [7] Show server state file info")
        print("  [8] Open server URL")
        print("  [0] Exit controller (server stays running)")
        print()

        try:
            choice = input("  Select: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n  Controller closed. The server will keep running.")
            return

        if choice == "1":
            print("\n  Starting server...")
            print("  Started." if start_server() else "  Failed to start.")
            pause()
        elif choice == "2":
            print("\n  Stopping server...")
            print("  Stopped." if stop_server() else "  Could not stop the server.")
            pause()
        elif choice == "3":
            print_status()
            pause()
        elif choice in {"4", "8"}:
            webbrowser.open(f"http://{HOST}:{PORT}/")
            print("\n  Opened One Question in your browser.")
            time.sleep(1)
        elif choice == "5":
            print("\n  Creating Windows Task Scheduler entry...")
            if enable_startup():
                print("  Windows startup: ENABLED")
                print(f"  Task: {TASK_NAME}")
                print("  Trigger: At log on")
            else:
                print("  Windows startup: FAILED")
            pause()
        elif choice == "6":
            print("\n  Removing Windows Task Scheduler entry...")
            print("  Windows startup: DISABLED" if disable_startup() else "  Could not remove startup task.")
            pause()
        elif choice == "7":
            show_state()
            pause()
        elif choice == "0":
            print("\n  Controller closed. The server will keep running.")
            return
        else:
            print("\n  Invalid choice.")
            time.sleep(0.8)


if __name__ == "__main__":
    main_menu()
