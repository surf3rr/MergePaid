@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Install dependencies first with: npm.cmd install
  pause
  exit /b 1
)
call npm.cmd run dev
pause
