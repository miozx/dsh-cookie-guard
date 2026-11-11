@echo off
chcp 65001 >nul
setlocal EnableExtensions
set "HERE=%~dp0"
set "PROJ=%HERE%.."
set "LOGDIR=%PROJ%\logs"
set "LOG=%LOGDIR%\launcher.log"

rem DSH exe: the generated start-dsh.cmd passes CG_DSH_EXE; fall back to the default install spot
if defined CG_DSH_EXE set "DSH_EXE=%CG_DSH_EXE%"
if not defined DSH_EXE set "DSH_EXE=D:\Deepseek\DeepSeek Harness.exe"
for %%F in ("%DSH_EXE%") do set "DSH_DIR=%%~dpF"
if defined DSH_DIR set "DSH_DIR=%DSH_DIR:~0,-1%"

rem CRITICAL: when this script is launched by DSH (or by our helper), the env carries
rem ELECTRON_RUN_AS_NODE=1, which makes the exe start as Node and exit at once.
set "ELECTRON_RUN_AS_NODE="

rem pin cwd so nothing depends on who called us
cd /d "%PROJ%"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

call :log "---- launcher start (user=%USERNAME% cwd=%CD%) ----"
call :log "dsh exe: %DSH_EXE%"

rem find a node runtime: PATH first, then the one DSH ships with itself
rem (users who installed from npm usually have no node.exe on PATH)
set "NODE="
where node >nul 2>&1 && set "NODE=node"
if not defined NODE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if exist "%%D\dependencies\node\bin\node.exe" set "NODE=%%D\dependencies\node\bin\node.exe"
  )
)
if not defined NODE (
  call :log "no node runtime found - skip cookie check"
  goto :launch
)
call :log "node: %NODE%"
"%NODE%" "%PROJ%\scripts\prelaunch.mjs" --threshold 1 --keep 1 >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
call :log "prelaunch rc=%RC%"

:launch
if not exist "%DSH_EXE%" (
  call :log "ERROR: DSH exe not found: %DSH_EXE%"
  echo.
  echo   Missing: %DSH_EXE%
  echo   If DSH is installed elsewhere, reinstall the shortcut from the Cookie Guard panel.
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
