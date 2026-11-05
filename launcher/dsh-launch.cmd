@echo off
chcp 65001 >nul
setlocal EnableExtensions
set "HERE=%~dp0"
set "PROJ=%HERE%.."
set "LOGDIR=%PROJ%\logs"
set "LOG=%LOGDIR%\launcher.log"
set "DSH_EXE=D:\Deepseek\DeepSeek Harness.exe"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

echo [%DATE% %TIME%] ---- launcher start (user=%USERNAME%) ---->>"%LOG%"

where node >nul 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] node not in PATH - skip cookie check>>"%LOG%"
  goto :launch
)

echo [%DATE% %TIME%] node resolved:>>"%LOG%"
where node >>"%LOG%" 2>&1
node "%PROJ%\scripts\prelaunch.mjs" --threshold 40 --keep 1 >>"%LOG%" 2>&1
echo [%DATE% %TIME%] prelaunch exit=%ERRORLEVEL%>>"%LOG%"

:launch
if not exist "%DSH_EXE%" (
  echo [%DATE% %TIME%] ERROR: DSH exe not found at "%DSH_EXE%">>"%LOG%"
  echo.
  echo Cannot find "%DSH_EXE%"
  pause
  exit /b 1
)
echo [%DATE% %TIME%] starting DSH>>"%LOG%"
start "" "%DSH_EXE%"
exit /b 0
