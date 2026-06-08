@echo off
chcp 65001 >nul
title Loom IDE - 开发模式
color 0A

echo.
echo   ========================================
echo     Loom IDE (织网) - 开发模式启动
echo   ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [!] Node.js 未安装，请先安装 Node.js
    echo       下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo   [1/3] 安装/修复依赖...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo   [!] npm install 失败，请检查网络连接
    pause
    exit /b 1
)

echo.
echo   [2/3] 编译主进程 TypeScript...
call npx tsc -p tsconfig.main.json
if %ERRORLEVEL% NEQ 0 (
    echo   [!] TypeScript 编译失败
    pause
    exit /b 1
)

echo.
echo   [3/3] 启动开发服务器...
echo.
echo   正在启动 Vite (端口5174) + Electron
echo   按 Ctrl+C 可停止服务
echo.

:: 设置开发模式环境变量
set NODE_ENV=development

:: 先启动 Vite dev server（后台，端口5174）
start "Vite Dev Server" /min cmd /c "npx vite --port 5174"

:: 等 Vite 就绪
echo   等待 Vite 启动...
timeout /t 5 /nobreak >nul

:: 启动 Electron
call npx electron .

echo.
echo   Loom IDE 已关闭
echo   正在关闭 Vite 服务器...
taskkill /fi "WINDOWTITLE eq Vite Dev Server" /f >nul 2>&1
pause
