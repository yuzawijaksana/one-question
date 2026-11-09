@echo off
cd /d "%~dp0"
git add "settings export" >nul 2>&1
git diff --cached --quiet >nul 2>&1
if errorlevel 1 (
    git commit -m "auto: settings snapshot" >nul 2>&1
    git push origin main >nul 2>&1
)
exit /b 0
