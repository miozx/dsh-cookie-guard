@echo off
chcp 65001 >nul
title Cookie Guard 面板
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%tools\open-panel.ps1"
if errorlevel 1 pause
