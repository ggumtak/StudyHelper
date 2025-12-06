@echo off
setlocal

rem ---------------------------------------------
rem Build all StudyHelper executables (one-file)
rem ---------------------------------------------
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

rem Ensure dependencies (PyInstaller + runtime deps)
%PY_CMD% -m pip install -r src\\requirements.txt --upgrade

rem Clean dist/build
if exist build rd /s /q build
if exist dist rd /s /q dist

rem 1) StudyHelper.exe (main app) - uses StudyHelper.spec (bundles web_app/data/config)
echo [INFO] Building StudyHelper.exe...
%PY_CMD% -m PyInstaller --noconfirm --clean StudyHelper.spec

rem 2) StudyHelperLauncher.exe (thin launcher/updater)
echo [INFO] Building StudyHelperLauncher.exe...
%PY_CMD% -m PyInstaller --noconfirm --clean --onefile --noconsole --name StudyHelperLauncher src\\scripts\\launcher.py

rem 3) StudyHelperPatcher.exe (release downloader/patcher)
echo [INFO] Building StudyHelperPatcher.exe...
%PY_CMD% -m PyInstaller --noconfirm --clean --onefile --name StudyHelperPatcher src\\scripts\\patcher.py

echo.
echo [INFO] Done. Outputs are in dist\\
echo [INFO] Distribute StudyHelper.exe + StudyHelperLauncher.exe + StudyHelperPatcher.exe together.
echo.
pause
