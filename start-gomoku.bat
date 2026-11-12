@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   五子棋 · 联机服务器
echo ================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [!] 没找到 Node.js，请先安装：https://nodejs.org/
  echo.
  pause
  exit /b 1
)
node gomoku-server.mjs
echo.
echo 服务器已退出。按任意键关闭窗口。
pause >nul
