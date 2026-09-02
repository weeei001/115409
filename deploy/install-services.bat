@echo off
chcp 65001 >nul
setlocal

REM 雙擊即可，會自動要求系統管理員權限。
REM 註冊 stock-backend / stock-rag / stock-frontend / stock-scheduler 四個 Windows 服務。

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 需要系統管理員權限，正在提權...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-services.ps1"

echo.
echo log 在 deploy\logs\
pause
