@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
set "DSH_EXE=D:\Deepseek\DeepSeek Harness.exe"

where node >nul 2>nul
if errorlevel 1 (
  echo [cookie-guard] node not found, launching without check
  goto :launch
)

node "%HERE%..\scripts\prelaunch.mjs" --threshold 40 --keep 1

:launch
if not exist "%DSH_EXE%" (
  echo [cookie-guard] DSH not found: "%DSH_EXE%"
  pause
  exit /b 1
)
start "" "%DSH_EXE%"
exit /b 0
