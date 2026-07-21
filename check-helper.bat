@echo off
title Movie Library Helper - Status

set "PORT=4700"
set "BIN=%LOCALAPPDATA%\MovieLibrary\movielibrary-helper-win-x64.exe"

echo Checking Movie Library helper...
echo.

REM Check if process is running
tasklist /FI "IMAGENAME eq movielibrary-helper-win-x64.exe" 2>NUL | find /I "movielibrary-helper-win-x64.exe" >NUL
if %ERRORLEVEL% EQU 0 (
    echo ✅ Helper is RUNNING
) else (
    echo ❌ Helper is NOT running
    echo.
    echo Starting it now...
    if exist "%BIN%" (
        "%BIN%"
        echo.
        echo Done! Now open your Movie Library site.
        timeout /t 3 >nul
        exit /b 0
    ) else (
        echo ⚠ Binary not found at: %BIN%
        echo Run movielibrary-helper.bat first to download it.
        echo.
        pause
        exit /b 1
    )
)

REM Check if port is listening
echo.
echo Checking localhost:%PORT%...
powershell -NoProfile -Command "try {$r=Invoke-WebRequest -UseBasicParsing 'http://localhost:%PORT%/api/health' -TimeoutSec 2; $j=$r.Content|ConvertFrom-Json; if($j.app -eq 'movielibrary-helper'){Write-Host '✅ Helper responding on port %PORT%' -ForegroundColor Green}else{Write-Host '⚠ Helper on port %PORT% but unexpected response' -ForegroundColor Yellow}}catch{Write-Host '❌ Helper process running but not responding on port %PORT%' -ForegroundColor Red}" 2>nul

echo.
echo Opening Movie Library...
start "" "http://localhost:%PORT%"
timeout /t 2 >nul
exit