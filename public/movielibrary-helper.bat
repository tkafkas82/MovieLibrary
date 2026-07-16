@echo off
REM ==========================================================================
REM  MKV Movie Library - Windows launcher (double-click me).
REM  Downloads the helper ONCE, then just re-runs it. Only re-downloads when a
REM  newer release exists. curl-downloaded exe carries no "mark of the web", so
REM  it won't trip SmartScreen the way a browser download does.
REM ==========================================================================
setlocal enabledelayedexpansion
title Movie Library helper
set "REPO=tkafkas82/MovieLibrary"
set "DIR=%LOCALAPPDATA%\MovieLibrary"
set "BIN=%DIR%\movielibrary-helper-win-x64.exe"
if not exist "%DIR%" mkdir "%DIR%"

REM Stop any previous helper first, so the port is free to rebind AND the .exe
REM isn't locked (Windows won't overwrite a running executable during update).
taskkill /F /IM movielibrary-helper-win-x64.exe >nul 2>&1
timeout /t 1 /nobreak >nul 2>&1

REM Latest release tag (blank if offline / rate-limited)
set "LATEST="
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "try{(Invoke-RestMethod 'https://api.github.com/repos/%REPO%/releases/latest').tag_name}catch{''}"`) do set "LATEST=%%v"
set "CURRENT="
if exist "%DIR%\version" set /p CURRENT=<"%DIR%\version"

set "NEED="
if not exist "%BIN%" set "NEED=1"
if defined LATEST if not "%LATEST%"=="%CURRENT%" set "NEED=1"

if defined NEED (
  echo Downloading the Movie Library helper !LATEST! ...
  curl -fL "https://github.com/%REPO%/releases/latest/download/movielibrary-helper-win-x64.exe" -o "%BIN%"
  if errorlevel 1 (
    echo.
    echo Download failed - check your internet connection.
    if not exist "%BIN%" ( pause & exit /b 1 )
  ) else (
    REM write the tag with NO trailing space/newline so the next run matches it
    if defined LATEST >"%DIR%\version" <nul set /p "=!LATEST!"
  )
) else (
  echo Movie Library helper is already up to date - starting it.
)

echo.
echo   Movie Library helper is starting. Leave this window open.
echo   Then open your Movie Library site in your browser. Close this to stop.
echo.
"%BIN%"
endlocal
