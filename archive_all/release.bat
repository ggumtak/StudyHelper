@echo off
setlocal

rem Simple release helper:
rem - Build exe files
rem - Zip them
rem - Compute SHA256
rem - Write version.json
rem - Run sync.bat (git add/commit/push)

set "BASE=%~dp0"
cd /d "%BASE%"

set "VERSION=%~1"
if "%VERSION%"=="" set /p VERSION=Enter version (e.g. 1.0.0):
if "%VERSION%"=="" (
    echo Version is required. Exiting.
    goto :end
)

set "RELEASE_ASSET=StudyHelper-win-x64.zip"
set "RELEASE_REPO=ggumtak/StudyHelper"

echo [1/5] Building executables...
set "NOPAUSE=1"
call src\scripts\build_exe.bat
if errorlevel 1 goto :end

echo [2/5] Zipping dist\%RELEASE_ASSET% ...
if exist "dist\%RELEASE_ASSET%" del /q "dist\%RELEASE_ASSET%"
powershell -NoLogo -NoProfile -Command ^
 "Compress-Archive -Path 'dist/StudyHelper.exe','dist/StudyHelperLauncher.exe','dist/StudyHelperPatcher.exe' -DestinationPath 'dist/%RELEASE_ASSET%' -Force"
if errorlevel 1 goto :end

echo [3/5] Computing SHA256...
for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "(Get-FileHash 'dist/%RELEASE_ASSET%' -Algorithm SHA256).Hash"`) do set "CHECKSUM=%%i"
if "%CHECKSUM%"=="" (
    echo Failed to compute checksum.
    goto :end
)

set "RELEASE_URL=https://github.com/%RELEASE_REPO%/releases/download/v%VERSION%/%RELEASE_ASSET%"

echo [4/5] Writing version.json...
powershell -NoLogo -NoProfile -Command ^
 "$json = @{ version = '%VERSION%'; url = '%RELEASE_URL%'; checksum = '%CHECKSUM%' }; $json | ConvertTo-Json | Set-Content -Path 'version.json' -Encoding UTF8"
if errorlevel 1 goto :end

echo [5/5] Running sync.bat (git add/commit/push)...
call ..\sync.bat

rem Optional: auto upload to GitHub Release when GH_UPLOAD=1 and gh CLI is available
if "%GH_UPLOAD%"=="1" (
    where gh >nul 2>&1
    if errorlevel 1 (
        echo [INFO] gh CLI not found. Skipping auto upload.
    ) else (
        echo [INFO] Publishing to GitHub Releases via gh...
        gh release view v%VERSION% --repo %RELEASE_REPO% >nul 2>&1
        if errorlevel 1 (
            gh release create v%VERSION% dist/%RELEASE_ASSET% -t "v%VERSION%" -n "StudyHelper v%VERSION%" --repo %RELEASE_REPO%
        ) else (
            gh release upload v%VERSION% dist/%RELEASE_ASSET% --clobber --repo %RELEASE_REPO%
        )
    )
)

echo.
echo Done. Upload dist\%RELEASE_ASSET% to GitHub Releases with tag v%VERSION%.

:end
if /i not "%NOPAUSE_RELEASE%"=="1" pause
