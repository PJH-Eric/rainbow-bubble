@echo off
title Rainbow Bubble
cd /d "%~dp0"
set PORT=3140
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required: https://nodejs.org
  pause
  exit /b 1
)
echo Starting Rainbow Bubble at http://localhost:%PORT%
start "" http://localhost:%PORT%
node server.js
pause
