@echo off
chcp 936 >nul 2>nul
title F50 Pro Monitor - Tauri 开发版
cd /d "%~dp0"

where cargo >nul 2>nul
if errorlevel 1 goto NO_RUST
if not exist "node_modules\vite" goto NEED_INSTALL
goto READY

:NEED_INSTALL
call npm install --no-audit --no-fund
if errorlevel 1 goto FAIL

:READY
echo 正在启动 Tauri 原生窗口（需要 Rust + MSVC 构建工具 + WebView2）...
call npm run tauri:dev
goto END

:NO_RUST
echo [错误] 未检测到 cargo。请先安装 Rust 与 VS 2022 生成工具，或改用「一键启动.bat」。
pause
goto END

:FAIL
echo [错误] 依赖安装失败。
pause
goto END

:END
