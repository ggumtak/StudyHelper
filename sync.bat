@echo off
chcp 65001 >nul
echo ========================================
echo    GitHub 동기화 중...
echo ========================================

cd /d "%~dp0"

:: 변경사항 추가
git add .

:: 커밋 (변경사항 있을 때만)
git diff --cached --quiet
if %errorlevel% neq 0 (
    git commit -m "자동 동기화 %date% %time%"
    echo [OK] 변경사항 저장완료
) else (
    echo [INFO] 변경사항 없음
)

:: GitHub에 업로드
git push
if %errorlevel% equ 0 (
    echo [OK] GitHub 업로드 완료!
) else (
    echo [ERROR] 업로드 실패
)

echo ========================================
echo    동기화 완료! 2초 후 창 닫힘
echo ========================================
timeout /t 2 >nul
