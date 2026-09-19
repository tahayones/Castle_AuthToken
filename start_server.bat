@echo off
cd /d "%~dp0"
title Castle Token API - Cloudflare Tunnel Launcher

echo ========================================================
echo    Castle Token API - Portable Launcher
echo ========================================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not added to PATH.
    echo Please install Python from https://www.python.org/
    pause
    exit /b 1
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not added to PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing Node dependencies...
    call npm install --omit=dev
)

echo Checking Python dependencies...
python -m pip install -r requirements.txt --quiet

if not exist cloudflared.exe (
    echo Downloading cloudflared.exe...
    curl.exe -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -o cloudflared.exe
)

echo Starting Castle Token API server on port 8000...
start "Castle API Server" /B python server.py

timeout /t 3 /nobreak >nul

echo.
echo ========================================================
echo   Connecting Cloudflare Public HTTPS Tunnel...
echo   Your public URL will appear below:
echo ========================================================
echo.

cloudflared.exe tunnel --url http://localhost:8000
