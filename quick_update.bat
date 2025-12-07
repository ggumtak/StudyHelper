@echo off
setlocal

rem ============================================
rem Quick Update (source-only, no exe rebuild)
rem - Zips src/data/config/version.json
rem - Computes SHA256
rem - Updates version.json (version/core_version/url/checksum)
rem - Optional gh upload when GH_UPLOAD=1
rem ============================================

set "BASE=%~dp0archive_all"
cd /d "%BASE%"

set "RELEASE_ASSET=StudyHelper-win-x64.zip"
set "RELEASE_REPO=ggumtak/StudyHelper"

rem ----- Version input (argument > prompt > default bump) -----
set "VERSION=%~1"
set "DEFAULT_VERSION="
for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "try { $j = Get-Content 'version.json' | ConvertFrom-Json; if ($j.version) { $v = [version]$j.version; Write-Output ('{0}.{1}.{2}' -f $v.Major, $v.Minor, ($v.Build + 1)) } } catch { '' }"`) do set "DEFAULT_VERSION=%%i"
if "%VERSION%"=="" set /p VERSION=Enter version [%DEFAULT_VERSION%]: 
if "%VERSION%"=="" set "VERSION=%DEFAULT_VERSION%"
if "%VERSION%"=="" set /p VERSION=Enter version (e.g. 1.0.3): 
if "%VERSION%"=="" (
  echo Version is required. Exiting.
  goto :end
)

echo.
echo ========================================
echo  Quick Update (no exe rebuild)
echo ========================================
echo.

echo [1/5] Preparing dist folder...
if not exist "dist" mkdir "dist"

echo [2/5] Building zip (src + data + config + version.json)...
powershell -NoLogo -NoProfile -Command "Compress-Archive -Path 'src','data','config','version.json' -DestinationPath 'dist/%RELEASE_ASSET%' -Force"
if errorlevel 1 goto :end

echo [3/5] Computing SHA256...
for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "(Get-FileHash 'dist/%RELEASE_ASSET%' -Algorithm SHA256).Hash"`) do set "CHECKSUM=%%i"
if "%CHECKSUM%"=="" (
  echo Failed to compute checksum.
  goto :end
)

set "RELEASE_URL=https://github.com/%RELEASE_REPO%/releases/download/v%VERSION%/%RELEASE_ASSET%"

echo [4/5] Updating version.json...
powershell -NoLogo -NoProfile -Command " $json = @{ version = '%VERSION%'; core_version = '%VERSION%'; launcher_version = '%VERSION%'; patcher_version = '%VERSION%'; url = '%RELEASE_URL%'; checksum = '%CHECKSUM%' }; $json | ConvertTo-Json | Set-Content -Path 'version.json' -Encoding UTF8"
if errorlevel 1 goto :end

echo [5/5] Upload to GitHub Release when GH_UPLOAD=1...
if "%GH_UPLOAD%"=="1" (
  where gh >nul 2>&1
  if errorlevel 1 (
    echo [WARN] gh CLI not found; skipping upload. Files ready in dist/.
  ) else (
    gh auth status >nul 2>&1
    if errorlevel 1 (
      echo [WARN] gh not authenticated. Run "gh auth login" first.
    ) else (
      gh release view v%VERSION% --repo %RELEASE_REPO% >nul 2>&1
      if errorlevel 1 (
        gh release create v%VERSION% dist/%RELEASE_ASSET% version.json -t "v%VERSION%" -n "StudyHelper source update v%VERSION%" --repo %RELEASE_REPO%
      ) else (
        gh release upload v%VERSION% dist/%RELEASE_ASSET% version.json --clobber --repo %RELEASE_REPO%
      )
    )
  )
) else (
  echo Upload skipped (set GH_UPLOAD=1 to auto-upload if gh is installed).
)

echo.
echo Done. version.json URL set to: %RELEASE_URL%
echo Existing EXE stays untouched; launcher will pull this zip on next run.

:end
if /i not "%NOPAUSE_QUICK%"=="1" pause
