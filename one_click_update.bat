@echo off
setlocal
chcp 65001 >nul

rem ====================================================
rem 올인원 자동 업데이트/배포 스크립트
rem - 버전 입력/자동 증가
rem - 실행 중인 프로세스 종료
rem - exe 빌드 + zip 생성
rem - version.json 생성 후 루트 복사
rem - git add/commit/push
rem - GitHub Release 업로드(zip + version.json)
rem ====================================================

set "BASE=%~dp0archive_all"
set "RELEASE_SCRIPT=%BASE%\release.bat"
if not exist "%RELEASE_SCRIPT%" (
    echo release.bat 을 찾을 수 없습니다. 경로를 확인하세요.
    goto :end
)

rem ----- 버전 결정: 인자 > 자동 증가 값 > 수동 입력 -----
set "VERSION=%~1"
set "DEFAULT_VERSION="
for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "try { $j = Get-Content '%BASE%\version.json' | ConvertFrom-Json; if ($j.version) { $v = [version]$j.version; Write-Output ('{0}.{1}.{2}' -f $v.Major, $v.Minor, ($v.Build + 1)) } } catch { '' }"`) do set "DEFAULT_VERSION=%%i"
if "%VERSION%"=="" set /p VERSION=버전을 입력하세요 [%DEFAULT_VERSION%]: 
if "%VERSION%"=="" set "VERSION=%DEFAULT_VERSION%"
if "%VERSION%"=="" set /p VERSION=버전을 입력하세요 (예: 1.0.5): 
if "%VERSION%"=="" (
    echo 버전이 필요합니다. 종료합니다.
    goto :end
)

rem ----- 실행 중인 프로세스 종료 -----
taskkill /IM StudyHelper.exe /F >nul 2>&1
taskkill /IM StudyHelperLauncher.exe /F >nul 2>&1
taskkill /IM StudyHelperPatcher.exe /F >nul 2>&1

rem ----- 빌드/릴리스 + GitHub 업로드 -----
set GH_UPLOAD=1
set NOPAUSE_RELEASE=1
cd /d "%BASE%"
call "%RELEASE_SCRIPT%" %VERSION%

:end
endlocal
