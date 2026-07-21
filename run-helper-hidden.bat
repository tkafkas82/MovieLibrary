@echo off
setlocal
set "CACHE_DIR=%LOCALAPPDATA%\MovieLibrary"
set "WRAPPER=%CACHE_DIR%\run-helper-hidden.bat"

REM Ensure cache directory exists
if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"

REM Copy this wrapper to cache dir if it doesn't exist there
if not exist "%WRAPPER%" (
  copy "%~f0" "%WRAPPER%" >nul 2>&1
  if errorlevel 1 (
    timeout /t 3 >nul
    exit /b 1
  )
)

REM Run the helper silently
set MOVIELIB_NO_OPEN=1
start "" /min "%CACHE_DIR%\movielibrary-helper-win-x64.exe"
endlocal