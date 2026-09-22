@echo off
cd /d "%~dp0server"

if not exist "node_modules" (
  echo Installing server dependencies (first run only)...
  call npm install
)

echo Starting Alrayhan Perfumes server...
call npm start
pause
