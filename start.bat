@echo off
cd /d "%~dp0"
start "Potok server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8787/"
