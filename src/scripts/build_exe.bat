@echo off
setlocal

rem -------------------------------
rem Minimal PyInstaller build script
rem -------------------------------
set "BASE=%~dp0"
set "PROJ=%BASE%.."
cd /d "%PROJ%"

rem Pick python command (3.11 priority -> latest 3.x -> python)
set "PY_CMD=py -3.11"
%PY_CMD% --version >nul 2>&1
if %errorlevel% neq 0 (
  set "PY_CMD=py -3"
  %PY_CMD% --version >nul 2>&1 || set "PY_CMD=python"
)

echo [INFO] Using Python: %PY_CMD%

rem Ensure pyinstaller is available
%PY_CMD% -m pip show pyinstaller >nul 2>&1
if %errorlevel% neq 0 (
  echo [INFO] Installing pyinstaller...
  %PY_CMD% -m pip install pyinstaller
)

rem Build launcher.exe
echo [INFO] Building launcher.exe...
%PY_CMD% -m PyInstaller --onefile --noconsole --clean "scripts\\launcher.py"

echo.
echo [INFO] Done. Output: dist\launcher.exe (place web_app, ai_drill alongside)
echo.
pause
