@echo off
rem One-click release with auto GitHub upload (requires gh login)
set GH_UPLOAD=1

rem Ensure running instances are closed to avoid build failures
taskkill /IM StudyHelper.exe /F >nul 2>&1
taskkill /IM StudyHelperLauncher.exe /F >nul 2>&1
taskkill /IM StudyHelperPatcher.exe /F >nul 2>&1

call archive_all\release.bat
