@echo off
setlocal

echo Checking if Python is installed...

where python >nul 2>&1
if %errorlevel%==0 (
    python --version >nul 2>&1
    if not errorlevel 1 (
        echo Python is already installed.
        python --version
        goto :end
    )
)

where py >nul 2>&1
if %errorlevel%==0 (
    echo Python is already installed ^(py launcher^).
    py --version
    goto :end
)

echo Python not found. Installing via winget...

where winget >nul 2>&1
if not %errorlevel%==0 (
    echo winget is not available on this system.
    echo Please install Python manually from https://www.python.org/downloads/
    pause
    exit /b 1
)

winget install --id Python.Python.3.12 --source winget --accept-package-agreements --accept-source-agreements
if %errorlevel%==0 (
    echo Python installed successfully.
    echo Note: you may need to reopen your terminal for 'python' to be recognized.
) else (
    echo Python installation failed.
    pause
    exit /b 1
)

:end
pause
