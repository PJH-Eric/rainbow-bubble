@echo off
title Rainbow Bubble
cd /d "%~dp0"
set PORT=3140
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 26.12.1 or a newer 26.x patch release is required: https://nodejs.org
  pause
  exit /b 1
)

node -e "const [major, minor, patch] = process.versions.node.split('.').map(Number); if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) process.exit(1)"
if errorlevel 1 (
  echo Node.js 26.12.1 or a newer 26.x patch release is required.
  for /f %%V in ('node --version') do echo Current version: %%V
  echo Install Node.js 26.12.1: https://nodejs.org/
  echo.
  pause
  exit /b 1
)
echo Starting Rainbow Bubble at http://localhost:%PORT%
start "" http://localhost:%PORT%
node server.js
pause
