@echo off
title Brainrot Heist server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org then run this again.
  pause
  exit /b
)
if not exist node_modules (
  echo First run: installing, this takes a moment...
  call npm install
)
rem Change these two if you want:
set GAME_PASSWORD=000
set PORT=3000
echo.
echo Game starting. Open http://localhost:3000 on this computer.
echo Other computers on the same wifi can use http://YOUR-IP:3000 (run ipconfig to see it).
echo Leave this window open while people play. Close it to stop the game.
echo.
node server.js
pause
