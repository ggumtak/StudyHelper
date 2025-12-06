@echo off
rem One-click release with auto GitHub upload (requires gh login)
set GH_UPLOAD=1
call archive_all\release.bat
