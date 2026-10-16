@echo off
setlocal

rem One-time build script - run this on a Windows PC with Python installed
rem to produce dist\TaskOrganizer.exe. PyInstaller can't cross-compile, so
rem this must be run on Windows itself (not Mac/Linux/WSL).
rem
rem Double-click this file, or run it from a terminal:
rem     windows\build.bat
rem
rem Uses its own .venv-win folder so it never touches the macOS .venv when
rem the project folder is shared between computers (e.g. through iCloud).

set "ROOT=%~dp0.."
pushd "%ROOT%"

set "VENV_PY=.venv-win\Scripts\python.exe"

if exist "%VENV_PY%" goto :venv_ready

rem "python" on PATH may be the Microsoft Store placeholder, which only prints
rem "Python was not found", so try the py launcher first and check each one runs.
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1 && set "PY=py -3"
if not defined PY (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo.
    echo Could not find Python 3.9 or newer.
    echo Install it from https://python.org/downloads ^(tick "Add python.exe to PATH"^),
    echo or turn off the "python.exe" App execution alias in
    echo Settings ^> Apps ^> Advanced app settings ^> App execution aliases.
    goto :fail
)

echo Creating virtual environment with: %PY%
%PY% -m venv .venv-win
if errorlevel 1 (
    echo.
    echo Could not create the virtual environment in .venv-win.
    goto :fail
)

:venv_ready
echo Installing dependencies...
"%VENV_PY%" -m pip install --upgrade pip
if errorlevel 1 goto :fail
"%VENV_PY%" -m pip install -r requirements.txt pyinstaller
if errorlevel 1 goto :fail

echo.
echo Generating app icon...
"%VENV_PY%" windows\make_icon.py
if errorlevel 1 goto :fail

echo.
echo Building TaskOrganizer.exe (this can take a minute)...
"%VENV_PY%" -m PyInstaller windows\taskorganizer.spec --noconfirm
if errorlevel 1 goto :fail

popd

echo.
echo ============================================================
echo Done! The app is at dist\TaskOrganizer.exe
echo Send that single file to anyone who wants to run it -
echo they don't need Python or anything else installed.
echo ============================================================
pause
exit /b 0

:fail
echo.
echo Build failed - see the messages above.
popd
pause
exit /b 1
