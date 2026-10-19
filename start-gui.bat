@echo off
setlocal
if exist "%~dp0desktop\release\ZViewer-win32-x64\ZViewer.exe" (
  start "" "%~dp0desktop\release\ZViewer-win32-x64\ZViewer.exe"
  exit /b 0
)
cd /d "%~dp0desktop"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing the desktop preview dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "" "node_modules\electron\dist\electron.exe" .
