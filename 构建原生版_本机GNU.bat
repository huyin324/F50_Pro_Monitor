@echo off
chcp 936 >nul 2>nul
title F50 Pro Monitor - 本机 GNU 工具链构建
cd /d "%~dp0"

for %%i in ("%~dp0..\_rusthome\gnu\bin") do set "RUST_BIN=%%~fi"
for %%i in ("%~dp0..\_rusthome\cargo") do set "CARGO_HOME=%%~fi"
for %%i in ("%~dp0..\_rusthome\rustup_ascii") do set "RUSTUP_HOME=%%~fi"
for %%i in ("%~dp0..\_rusttmp") do set "TMP_ASCII=%%~fi"
for %%i in ("%~dp0src-tauri\target-gnu2") do set "CARGO_TARGET_DIR=%%~fi"
if not exist "%TMP_ASCII%" md "%TMP_ASCII%"
set "CARGO_INCREMENTAL=0"
set "CARGO_BUILD_JOBS=1"
set "TMP=%TMP_ASCII%"
set "TEMP=%TMP_ASCII%"
set "TMPDIR=%TMP_ASCII%"
set "PATH=%RUST_BIN%;C:\mingw64\bin;%PATH%"

if not exist "%RUST_BIN%\cargo.exe" goto NO_TOOLCHAIN
where node >nul 2>nul
if errorlevel 1 goto NO_NODE
if not exist "node_modules\vite" call npm install --no-audit --no-fund

echo [1/3] 构建前端 dist ...
call npm run build
if errorlevel 1 goto FAIL

echo [2/3] 编译 Rust release（首次约 10 分钟）...
pushd "%~dp0src-tauri"
"%RUST_BIN%\cargo.exe" build --release -j 1 --features custom-protocol
if errorlevel 1 goto FAIL_POP
popd

echo [3/3] 复制可执行程序到项目根目录 ...
copy /Y "%CARGO_TARGET_DIR%\release\f50-pro-monitor.exe" "%~dp0F50_Pro_Monitor.exe" >nul
if errorlevel 1 goto FAIL
copy /Y "%CARGO_TARGET_DIR%\release\WebView2Loader.dll" "%~dp0WebView2Loader.dll" >nul
if errorlevel 1 goto FAIL
echo.
echo 构建完成：F50_Pro_Monitor.exe + WebView2Loader.dll（两者需保持同一目录）
pause
goto END

:FAIL_POP
popd
goto FAIL

:NO_TOOLCHAIN
echo [错误] 未找到纯 ASCII 工具链：%RUST_BIN%
echo        请阅读 README「原生 exe 构建环境」章节准备工具链，
echo        或安装 VS 2022 C++ 生成工具后使用「构建可执行程序.bat」。
pause
goto END

:NO_NODE
echo [错误] 未检测到 Node.js，无法构建前端。
pause
goto END

:FAIL
echo [错误] 构建失败，请查看上方日志。
pause
goto END

:END
