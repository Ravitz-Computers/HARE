@echo off
setlocal
cd /d "%~dp0"

echo ================================================================
echo   HARE Installer Builder  --  Ravitz Computers
echo.
echo   This builds ONE FILE: HARE-Setup.exe
echo.
echo   That file is the whole product. Copy it to any Windows PC,
echo   double-click it, and HARE installs -- nothing else to
echo   download, no zip, no second step. Everything travels inside
echo   it: HARE, OpenRGB, the Visual C++ runtime and the driver.
echo.
echo   You only need to do this once, on the PC you build from.
echo   It can take several minutes the first time. Please wait, and
echo   don't close this window.
echo.
echo   Windows will ask for administrator access in a moment -- a
echo   second window opens to do the work; this one shows the
echo   result when it's finished.
echo ================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
    echo ================================================================
    echo   DONE. Your installer is in the "release" folder, named
    echo   HARE-Setup-<version>.exe -- that one file is all anyone
    echo   needs. Send it to whoever wants HARE.
    echo ================================================================
) else (
    echo ================================================================
    echo   SOMETHING WENT WRONG.
    echo   Scroll up and look for the red [ERROR] line above -- it says
    echo   what failed.
    echo.
    echo   A full log of this run was also saved to:
    echo     %~dp0build.log
    echo   If you're not sure what to do, send that file to whoever set
    echo   this up -- it has everything needed to figure out what
    echo   happened. Once it's fixed, just run build.bat again; it's
    echo   safe to re-run.
    echo ================================================================
)
echo.
pause
exit /b %EXITCODE%
