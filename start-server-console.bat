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

where py.exe >nul 2>&1
if not errorlevel 1 (
    py.exe -3 "%~dp0OneQuestionServer.py"
    exit /b %errorlevel%
)

where python.exe >nul 2>&1
if not errorlevel 1 (
    python.exe "%~dp0OneQuestionServer.py"
    exit /b %errorlevel%
)

echo.
echo Python 3 was not found.
echo Please install Python 3 and run this again.
pause