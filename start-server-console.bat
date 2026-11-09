@echo off

:: Check for Administrator privileges
net session >nul 2>&1
if not errorlevel 1 goto :admin

echo.
echo Restarting as Administrator...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:admin
cd /d "%~dp0"

set PY_CMD=

py.exe --version >nul 2>&1
if not errorlevel 1 set PY_CMD=py.exe -3

if not defined PY_CMD (
    python.exe --version >nul 2>&1
    if not errorlevel 1 set PY_CMD=python.exe
)

if defined PY_CMD (
    %PY_CMD% "%~dp0OneQuestionServer.py"
    echo.
    echo Server exited with code %errorlevel%.
    pause
    exit /b %errorlevel%
)

echo.
echo Python 3 was not found on this system.
echo Run install-python.bat first, then try again.
pause