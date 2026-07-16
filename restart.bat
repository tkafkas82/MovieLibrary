@echo off
setlocal
cd /d "%~dp0"

REM ---- Movie Library: stop any running instance, then start fresh ----
REM Does NOT touch your library/settings. Optional port arg (default 4700).

set PORT=4700
if not "%~1"=="" set PORT=%~1

echo Stopping any Movie Library server on port %PORT% ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Write-Host ('  stopping PID ' + $_); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

echo Restarting ...
call "%~dp0start.bat" %PORT%

endlocal
