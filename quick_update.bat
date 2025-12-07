@echo off
setlocal

rem ==========================================================
rem Quick Update (one-click, auto handles everything)
rem - Version input (arg > auto bump > prompt)
rem - Auto build exes if missing (uses src\scripts\build_exe.bat)
rem - Zip exe3 + src + data + config + version.json
rem - Compute SHA256, write version.json, copy to repo root
rem - Auto upload to GitHub Release (zip + version.json)
rem - Auto git add/commit/push (can skip via SKIP_SYNC=1)
rem   * Set GH_UPLOAD=0 to skip release upload
rem ==========================================================

set "BASE=%~dp0archive_all"
set "RELEASE_ASSET=StudyHelper-win-x64.zip"
set "RELEASE_REPO=ggumtak/StudyHelper"
if not defined GH_UPLOAD set "GH_UPLOAD=1"
if not defined SKIP_SYNC set "SKIP_SYNC=0"

cd /d "%BASE%"

rem ----- Version input (argument > prompt > default bump) -----
set "VERSION=%~1"
set "DEFAULT_VERSION="
for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "try { $j = Get-Content 'version.json' | ConvertFrom-Json; if ($j.version) { $v = [version]$j.version; Write-Output ('{0}.{1}.{2}' -f $v.Major, $v.Minor, ($v.Build + 1)) } } catch { '' }"`) do set "DEFAULT_VERSION=%%i"
if "%VERSION%"=="" set /p VERSION=Enter version [%DEFAULT_VERSION%]: 
if "%VERSION%"=="" set "VERSION=%DEFAULT_VERSION%"
if "%VERSION%"=="" set /p VERSION=Enter version (e.g. 1.0.5): 
if "%VERSION%"=="" (
  echo Version is required. Exiting.
  goto :end
)

echo.
echo ========================================
echo  Quick Update (auto build/upload)
echo ========================================
echo.

echo [1/7] Prepare dist folder...
if not exist "dist" mkdir "dist"

echo [2/7] Ensure exe files (auto build if missing)...
set "EXE1=dist/StudyHelper.exe"
set "EXE2=dist/StudyHelperLauncher.exe"
set "EXE3=dist/StudyHelperPatcher.exe"
if not exist "%EXE1%" if not exist "%EXE2%" if not exist "%EXE3%" (
  set "NOPAUSE=1"
  call src\scripts\build_exe.bat
)
if not exist "%EXE1%" (
  echo [ERROR] %EXE1% missing. build_exe.bat failed.
  goto :end
)
if not exist "%EXE2%" (
  echo [ERROR] %EXE2% missing. build_exe.bat failed.
  goto :end
)
if not exist "%EXE3%" (
  echo [ERROR] %EXE3% missing. build_exe.bat failed.
  goto :end
)

echo [3/7] Build ZIP (exe3 + src + data + config + version.json)...
powershell -NoLogo -NoProfile -Command "Compress-Archive -Path 'dist/StudyHelper.exe','dist/StudyHelperLauncher.exe','dist/StudyHelperPatcher.exe','src','data','config','version.json' -DestinationPath 'dist/%RELEASE_ASSET%' -Force"
if errorlevel 1 goto :end

echo [4/7] Compute SHA256...
for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "(Get-FileHash 'dist/%RELEASE_ASSET%' -Algorithm SHA256).Hash"`) do set "CHECKSUM=%%i"
if "%CHECKSUM%"=="" (
  echo SHA256 compute failed.
  goto :end
)

set "RELEASE_URL=https://github.com/%RELEASE_REPO%/releases/download/v%VERSION%/%RELEASE_ASSET%"

echo [5/7] Write version.json...
powershell -NoLogo -NoProfile -Command " $json = @{ version = '%VERSION%'; core_version = '%VERSION%'; launcher_version = '%VERSION%'; patcher_version = '%VERSION%'; url = '%RELEASE_URL%'; checksum = '%CHECKSUM%' }; $json | ConvertTo-Json | Set-Content -Path 'version.json' -Encoding UTF8"
if errorlevel 1 goto :end
copy /y "version.json" "..\\version.json" >nul 2>&1

echo [6/7] Upload to GitHub Release...
if "%GH_UPLOAD%"=="1" (
  where gh >nul 2>&1
  if errorlevel 1 (
    echo [WARN] gh CLI not found. Install/login then retry.
    goto :end
  )
  gh auth status >nul 2>&1
  if errorlevel 1 (
    echo [WARN] gh not authenticated. Run "gh auth login" then retry.
    goto :end
  )
  gh release view v%VERSION% --repo %RELEASE_REPO% >nul 2>&1
  if errorlevel 1 (
    gh release create v%VERSION% dist/%RELEASE_ASSET% version.json -t "v%VERSION%" -n "StudyHelper update v%VERSION%" --repo %RELEASE_REPO%
  ) else (
    gh release upload v%VERSION% dist/%RELEASE_ASSET% version.json --clobber --repo %RELEASE_REPO%
  )
) else (
  echo [INFO] GH_UPLOAD=0, skipping release upload.
)

echo [7/7] Git sync (push main)...
if "%SKIP_SYNC%"=="0" (
  if exist "..\\sync.bat" (
    call ..\\sync.bat
  ) else (
    echo [WARN] sync.bat missing; skipping git push.
  )
) else (
  echo [INFO] SKIP_SYNC=1, skipping git push.
)

echo.
echo Done. Version %VERSION% ^| URL: %RELEASE_URL%

:end
if /i not "%NOPAUSE_QUICK%"=="1" pause
