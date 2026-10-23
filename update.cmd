@echo off
setlocal
echo.
echo  dsh-pet update (files only, profile untouched)
echo  ---------------------------------------------
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Update %*
set "RC=%ERRORLEVEL%"
echo.
if "%~1"=="" pause
exit /b %RC%
