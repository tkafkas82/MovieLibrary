@echo off
setlocal
set PORT=4700

REM Quick check if helper is already running
powershell -NoProfile -Command "try {$r=Invoke-WebRequest -UseBasicParsing 'http://localhost:%PORT%/api/health'; exit 0} catch {exit 1}" >nul 2>&1
if %errorlevel% equ 0 (
  echo Movie Library helper is already running - opening the site...
  start "" "http://localhost:%PORT%"
  exit /b 0
)

REM Helper not running - start it via the cached exe
if not exist "%LOCALAPPDATA%\MovieLibrary\movielibrary-helper-win-x64.exe" (
  echo Helper not found - run movielibrary-helper.bat first to download it.
  timeout /t 3 >nul
  exit /b 1
)

echo Starting Movie Library helper...
start "" "%LOCALAPPDATA%\MovieLibrary\movielibrary-helper-win-x64.exe"
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%"
endlocal