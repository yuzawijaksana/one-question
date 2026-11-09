ONE QUESTION - CONSOLE SERVER CONTROLLER

Run:
  start-server-console.bat

The controller directly manages server.py. The old supervisor process is no
longer required by the console controller.

Menu:
  1. Start server
  2. Stop server
  3. Refresh status
  4. Open One Question
  5. Enable start with Windows
  6. Disable start with Windows
  7. Show server state file info
  8. Open server URL
  0. Exit controller (server stays running)

WINDOWS STARTUP

"Enable start with Windows" creates a Windows Task Scheduler task named:
  One Question Server

The task runs at logon for the current Windows user and starts server.py
directly. It does NOT use the Startup folder and does NOT depend on a VBS file.

The scheduled task uses the same Python installation that is running the
controller. If pythonw.exe is available beside python.exe, it is preferred so
no console window is created for the background server.

"Disable start with Windows" removes that scheduled task.

The server is independent of the controller. Closing this console does not
stop the server. Use option 2 to stop it.

Python 3 is required for this temporary version.
