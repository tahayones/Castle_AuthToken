@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Castle Token API - Cloudflare Tunnel Launcher

set "PATH=%LocalAppData%\Programs\Python\Python312;%LocalAppData%\Programs\Python\Python312\Scripts;%LocalAppData%\Programs\Python\Python311;%LocalAppData%\Programs\Python\Python311\Scripts;%ProgramFiles%\Python312;%ProgramFiles%\Python311;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%PATH%"

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Python is not installed. Downloading Python 3.11...
    curl.exe -L "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe" -o "%temp%\python_installer.exe"
    echo [INFO] Installing Python silently...
    start /wait "" "%temp%\python_installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 SimpleInstall=1
    del "%temp%\python_installer.exe" 2>nul
    set "PATH=%LocalAppData%\Programs\Python\Python311;%LocalAppData%\Programs\Python\Python311\Scripts;!PATH!"
)

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python installation failed. Please install Python manually.
    pause
    exit /b 1
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Node.js is not installed. Downloading Node.js 20 LTS...
    curl.exe -L "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -o "%temp%\node_installer.msi"
    echo [INFO] Installing Node.js silently...
    msiexec /i "%temp%\node_installer.msi" /qn /norestart
    del "%temp%\node_installer.msi" 2>nul
    set "PATH=%ProgramFiles%\nodejs;!PATH!"
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js installation failed. Please install Node.js manually.
    pause
    exit /b 1
)

if not exist node_modules (
    echo [INFO] Installing Node dependencies...
    call npm install --omit=dev
)

echo [INFO] Checking Python dependencies...
python -m pip install -r requirements.txt --quiet

if not exist cloudflared.exe (
    echo [INFO] Downloading cloudflared.exe...
    curl.exe -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -o cloudflared.exe
)

python launcher.py
pause
