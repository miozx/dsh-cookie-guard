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

call :log "starting DSH (detached)"
rem Use node's detached spawn so DSH does NOT inherit this console.
rem With plain `start`, closing this window sends CTRL_CLOSE to DSH and kills it.
if not defined NODE goto :plainstart
"%NODE%" "%PROJ%\scripts\spawn-dsh.mjs" --exe "%DSH_EXE%" --wait 2500 >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
call :log "spawn rc=%RC%"
if "%RC%"=="0" goto :ok
call :log "spawn failed - falling back to plain start (window will stay attached)"

:plainstart
start "" /D "%DSH_DIR%" "%DSH_EXE%"

:ok
call :log "launcher done - this window can close now"
exit /b 0

:log
>>"%LOG%" echo [%DATE% %TIME%] %~1
exit /b 0
