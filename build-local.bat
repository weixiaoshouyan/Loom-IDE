@echo off
chcp 65001 >nul
title Loom IDE - 本地构建脚本

echo ========================================
echo   Loom IDE (织网) 本地构建
echo   Loom IDE v0.2.0 - VSCode Feature Parity
echo ========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js 未安装，请先安装 Node.js (>=18)
    echo         下载: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js 已安装

:: Install dependencies
echo.
echo [1/4] 安装依赖 (npm install)...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] npm install 可能有问题，尝试继续...
)

:: Compile TypeScript main process
echo.
echo [2/4] 编译主进程 TypeScript...
node _compile-fix.js
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] TypeScript 编译失败！
    pause
    exit /b 1
)
echo [OK] 主进程编译成功

:: Build Vite renderer
echo.
echo [3/4] Vite 构建渲染进程...
call npx vite build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Vite 构建失败！
    pause
    exit /b 1
)
echo [OK] 渲染进程构建成功

:: electron-builder packaging
echo.
echo [4/4] electron-builder 打包 Windows NSIS...
call npx electron-builder --win
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] electron-builder 打包失败！
    pause
    exit /b 1
)

echo.
echo ========================================
echo   构建完成！
echo   安装包位于: release\ 目录
echo ========================================
echo.
echo [可选] 推送到 GitHub...
echo   仓库: https://github.com/weixiaoshouyan/Loom-IDE.git
echo.
set /p PUSH="是否推送到 GitHub? (Y/N): "
if /i "%PUSH%"=="Y" (
    echo 正在推送...
    git push -u origin main
    if %ERRORLEVEL% EQU 0 (
        echo [OK] 推送成功!
    ) else (
        echo [ERROR] 推送失败，请检查网络和认证
    )
)
pause
