@echo off
chcp 65001 >nul
title Cookie Guard 面板
set "HERE=%~dp0"
set "PS1=%HERE%..\tools\open-panel.ps1"
if not exist "%PS1%" (
  echo.
  echo   Missing: "%PS1%"
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 pause