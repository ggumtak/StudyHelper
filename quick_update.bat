@echo off
setlocal

rem ============================================
rem Quick Update - exe 재빌드 없이 코드만 업데이트
rem src, data, config 폴더만 패키징해서 GitHub에 업로드
rem ============================================

set "BASE=%~dp0archive_all"
cd /d "%BASE%"

set "VERSION=%~1"
if "%VERSION%"=="" set /p VERSION=Enter version (e.g. 1.0.3): 
if "%VERSION%"=="" (
    echo Version is required. Exiting.
    goto :end
)

set "RELEASE_ASSET=StudyHelper-win-x64.zip"
set "RELEASE_REPO=ggumtak/StudyHelper"

echo.
echo ========================================
echo  Quick Update (exe 재빌드 없음!)
echo ========================================
echo.

echo [1/4] 기존 ZIP 삭제...
if exist "dist\%RELEASE_ASSET%" del /q "dist\%RELEASE_ASSET%"

echo [2/4] ZIP 생성 (exe + src + data + config)...
powershell -NoLogo -NoProfile -Command ^
 "Compress-Archive -Path 'dist/StudyHelper.exe','dist/StudyHelperLauncher.exe','dist/StudyHelperPatcher.exe','src','data','config' -DestinationPath 'dist/%RELEASE_ASSET%' -Force"
if errorlevel 1 goto :end

echo [3/4] SHA256 체크섬 계산...
for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "(Get-FileHash 'dist/%RELEASE_ASSET%' -Algorithm SHA256).Hash"`) do set "CHECKSUM=%%i"
if "%CHECKSUM%"=="" (
    echo Failed to compute checksum.
    goto :end
)

set "RELEASE_URL=https://github.com/%RELEASE_REPO%/releases/download/v%VERSION%/%RELEASE_ASSET%"

echo [4/4] version.json 업데이트...
powershell -NoLogo -NoProfile -Command ^
 "$json = @{ version = '%VERSION%'; core_version = '%VERSION%'; launcher_version = '%VERSION%'; patcher_version = '%VERSION%'; url = '%RELEASE_URL%'; checksum = '%CHECKSUM%' }; $json | ConvertTo-Json | Set-Content -Path 'version.json' -Encoding UTF8"
if errorlevel 1 goto :end

echo.
echo [5/5] Git 커밋 및 푸시...
call ..\sync.bat

rem GitHub Release 업로드
where gh >nul 2>&1
if errorlevel 1 (
    echo [INFO] gh CLI not found. 수동으로 업로드 필요.
    echo   - dist\%RELEASE_ASSET%
    echo   - version.json
) else (
    echo [INFO] GitHub Release 업로드 중...
    gh release view v%VERSION% --repo %RELEASE_REPO% >nul 2>&1
    if errorlevel 1 (
        gh release create v%VERSION% dist/%RELEASE_ASSET% version.json -t "v%VERSION%" -n "StudyHelper v%VERSION% (quick update)" --repo %RELEASE_REPO%
    ) else (
        gh release upload v%VERSION% dist/%RELEASE_ASSET% version.json --clobber --repo %RELEASE_REPO%
    )
)

echo.
echo ========================================
echo  완료! (exe 재빌드 없이 업데이트됨)
echo ========================================

:end
pause
