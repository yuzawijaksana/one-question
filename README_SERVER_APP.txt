ONE QUESTION SERVER GUI

This is the dependency-free GUI prototype for the One Question local sync server.

Run:
  OneQuestionServer.pyw

Behavior:
  - Starts the local server automatically when the GUI opens.
  - Closing the GUI window hides it and DOES NOT stop the server.
  - Exit Server stops the server.
  - Start server with Windows creates a Startup-folder launcher.
  - Server listens only on 127.0.0.1:8765.

For a final public release, this GUI can be packaged as OneQuestionServer.exe with
PyInstaller on Windows. The server files/web assets should be bundled into that EXE.
