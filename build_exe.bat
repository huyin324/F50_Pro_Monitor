@echo off
chcp 936 >nul 2>nul
title F50 Pro Monitor - 构建可执行程序
cd /d "%~dp0"

where cargo >nul 2>nul
if errorlevel 1 goto NO_RUST
if not exist "node_modules\vite" goto NEED_INSTALL
goto READY

:NEED_INSTALL
call npm install --no-audit --no-fund
if errorlevel 1 goto FAIL

:READY
echo 正在构建单文件可执行程序（首次构建需下载 Rust 依赖，约 10-20 分钟）...
call npm run tauri:build
if errorlevel 1 goto FAIL
echo.
echo 构建完成：src-tauri\target\release\f50-pro-monitor.exe
echo 安装包：src-tauri\target\release\bundle\nsis 或 msi
pause
goto END

:NO_RUST
echo [错误] 未检测到 Rust。请先安装 rustup（stable-x86_64-pc-windows-msvc）
echo        以及 Visual Studio 2022「使用 C++ 的桌面开发」工作负载。
pause
goto END

:FAIL
echo [错误] 构建失败，请查看上方日志。
pause
goto END

:END
