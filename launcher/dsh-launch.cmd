@echo off
chcp 65001 >nul
setlocal EnableExtensions
set "HERE=%~dp0"
set "PROJ=%HERE%.."
set "LOGDIR=%PROJ%\logs"
set "LOG=%LOGDIR%\launcher.log"
set "DSH_EXE=D:\Deepseek\DeepSeek Harness.exe"
set "DSH_DIR=D:\Deepseek"

rem CRITICAL: when this script is launched by DSH (or by our helper), the env carries
rem ELECTRON_RUN_AS_NODE=1, which makes the exe start as Node and exit at once.
set "ELECTRON_RUN_AS_NODE="

rem pin cwd so nothing depends on who called us
cd /d "%PROJ%"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

call :log "---- launcher start (user=%USERNAME% cwd=%CD%) ----"

where node >nul 2>&1
if errorlevel 1 (
  call :log "node not in PATH - skip cookie check"
  goto :launch
)
for /f "delims=" %%v in ('where node') do call :log "node resolved: %%v"
node "%PROJ%\scripts\prelaunch.mjs" --threshold 1 --keep 1 >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
call :log "prelaunch rc=%RC%"

:launch
if not exist "%DSH_EXE%" (
  call :log "ERROR: DSH exe not found: %DSH_EXE%"
  echo.
  echo   Missing: %DSH_EXE%
  pause
  exit /b 1
)

call :log "starting DSH"
start "" /D "%DSH_DIR%" "%DSH_EXE%"

rem wait up to 12s and verify a process actually showed up
set /a N=0
:wait
timeout /t 1 /nobreak >nul 2>&1
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" /NH 2>nul | find /I "DeepSeek Harness.exe" >nul && goto :started
set /a N+=1
if %N% GEQ 12 goto :failed
goto :wait

:started
call :log "DSH process detected after %N%s - ok"
exit /b 0

:failed
call :log "ERROR: no DSH process after 12s, retry once without /D"
start "" "%DSH_EXE%"
timeout /t 10 /nobreak >nul 2>&1
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" /NH 2>nul | find /I "DeepSeek Harness.exe" >nul && (
  call :log "retry ok"
  exit /b 0
)
call :log "ERROR: retry also failed - see log"
echo.
echo   DSH did not start. Log:
echo   %LOG%
echo.
pause
exit /b 1

:log
>>"%LOG%" echo [%DATE% %TIME%] %~1
exit /b 0