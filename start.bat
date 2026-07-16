@echo off
setlocal
cd /d "%~dp0"

REM ---- Movie Library helper launcher ----
REM First run installs dependencies (only Express). Then starts the local
REM helper (disk scanning + IMDb + open/reveal) and opens the library.
REM
REM Two ways to use it:
REM   * Open the local URL this opens (works fully offline, any browser), OR
REM   * leave this window running and open your hosted (Vercel) UI in Chrome/
REM     Edge — it will connect to this helper automatically.

set PORT=4700
if not "%~1"=="" set PORT=%~1

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH. Install Node 18+ from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Movie Library helper on http://localhost:%PORT%
echo (Leave this window open. Close it to stop the helper.)
set PORT=%PORT%
node server.js

endlocal
