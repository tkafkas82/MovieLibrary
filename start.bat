@echo off
setlocal
cd /d "%~dp0"

REM ---- MKV Movie Library launcher ----
REM First run installs dependencies (only Express). Then starts the server
REM and opens the library in your default browser.

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

echo Starting MKV Movie Library on http://localhost:%PORT%
start "" "http://localhost:%PORT%"
set PORT=%PORT%
node server.js

endlocal
