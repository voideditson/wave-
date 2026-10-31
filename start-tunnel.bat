@echo off
title Brainrot Heist public link
cd /d "%~dp0"
set CF=cloudflared.exe
if exist "%~dp0cloudflared.exe" (
  set CF="%~dp0cloudflared.exe"
) else (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo cloudflared.exe was not found in this folder: %~dp0
    pause
    exit /b
  )
)
echo Look for a line with https://something.trycloudflare.com below. That is your public link.
%CF% tunnel --url http://localhost:3000
pause
