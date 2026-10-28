@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] 没有找到 node，请先安装 Node.js 20+（https://nodejs.org）
  pause
  exit /b 1
)

node scripts\p0-lcu-spike.mjs %*
echo.
pause
