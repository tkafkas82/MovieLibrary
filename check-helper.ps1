#!/usr/bin/env powershell
# Movie Library Helper - Status checker (single click)
$PORT = 4700
$BIN = "$env:LOCALAPPDATA\MovieLibrary\movielibrary-helper-win-x64.exe"

Write-Host "Checking Movie Library helper..." -ForegroundColor Cyan
Write-Host ""

# Check process
$proc = Get-Process -Name "movielibrary-helper-win-x64" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "✅ Helper is RUNNING (PID: $($proc.Id))" -ForegroundColor Green
} else {
    Write-Host "❌ Helper is NOT running" -ForegroundColor Red
    Write-Host ""
    Write-Host "Starting it now..." -ForegroundColor Yellow
    if (Test-Path $BIN) {
        Start-Process -FilePath $BIN -WindowStyle Hidden
        Start-Sleep -Seconds 2
        Write-Host "✅ Helper started" -ForegroundColor Green
    } else {
        Write-Host "⚠ Binary not found at: $BIN" -ForegroundColor Yellow
        Write-Host "Run movielibrary-helper.bat first to download it." -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Check health endpoint
Write-Host ""
Write-Host "Checking localhost:$PORT..." -ForegroundColor Cyan
try {
    $r = Invoke-RestMethod "http://localhost:$PORT/api/health" -TimeoutSec 2
    if ($r.app -eq 'movielibrary-helper') {
        Write-Host "✅ Helper responding (version: $($r.version))" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Helper not responding on port $PORT" -ForegroundColor Red
}

Write-Host ""
Write-Host "Opening Movie Library..." -ForegroundColor Cyan
Start-Process "http://localhost:$PORT"
Start-Sleep -Seconds 1