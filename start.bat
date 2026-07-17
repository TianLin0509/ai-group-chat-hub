@echo off
rem AI Group Chat Hub launcher
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo [!] Dependencies not installed. Run install.ps1 first:
  echo     powershell -ExecutionPolicy Bypass -File install.ps1
  echo.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
