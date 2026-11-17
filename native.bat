@echo off
chcp 936 >nul 2>nul
title F50 Pro Monitor - 原生窗口版
cd /d "%~dp0"

if not exist "F50_Pro_Monitor.exe" goto NO_EXE
if not exist "WebView2Loader.dll" goto NO_DLL
echo 正在启动 F50 Pro Monitor 原生窗口（需 WebView2 Runtime）...
start "" "F50_Pro_Monitor.exe"
goto END

:NO_EXE
echo [错误] 未找到 F50_Pro_Monitor.exe。
echo        请运行「构建原生版_本机GNU.bat」，或改用「一键启动.bat」浏览器模式。
pause
goto END

:NO_DLL
echo [错误] 未找到 WebView2Loader.dll。
echo        GNU 构建版需要该 DLL 与 exe 放在同一目录，请勿单独移动 exe。
pause
goto END

:END
