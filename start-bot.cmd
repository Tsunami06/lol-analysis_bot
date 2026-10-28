@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js not found. Install Node 20+ first: https://nodejs.org
  pause
  exit /b 1
)

if not exist config\config.json (
  echo [x] config\config.json not found.
  echo     copy config\config.example.json config\config.json
  echo     then edit "group" and "schedule".
  pause
  exit /b 1
)

if not exist config\players.json (
  echo [x] config\players.json not found.
  echo     copy config\players.example.json config\players.json
  echo     then fill in 5 players.
  pause
  exit /b 1
)

echo Starting lol-daily-bot daemon. Keep this window open.
echo Logs will appear below.
echo.
node src\index.mjs daemon

echo.
echo Bot stopped. Press any key to exit.
pause
