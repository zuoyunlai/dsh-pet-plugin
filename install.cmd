@echo off
setlocal
echo.
echo  dsh-pet installer for DeepSeek Harness
echo  --------------------------------------
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%~1"=="" pause
exit /b %RC%
