@echo off
chcp 65001 >nul
echo ========================================
echo    GitHub sync running...
echo ========================================

cd /d "%~dp0"

:: Stage changes
git add .

:: Commit only when staged files exist
git diff --cached --quiet
if %errorlevel% neq 0 (
    git commit -m "auto sync %date% %time%"
    echo [OK] Changes committed
) else (
    echo [INFO] No changes to commit
)

:: Push to GitHub
git push
if %errorlevel% equ 0 (
    echo [OK] Pushed to GitHub
) else (
    echo [ERROR] Push failed
)

echo ========================================
echo    Sync done! Closing in 2 seconds
echo ========================================
timeout /t 2 >nul
