@echo off
setlocal
echo.
echo  dsh-pet install status
echo  ----------------------
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Verify %*
set "RC=%ERRORLEVEL%"
echo.
if "%~1"=="" pause
exit /b %RC%
