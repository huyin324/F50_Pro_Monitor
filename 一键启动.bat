@echo off
chcp 936 >nul 2>nul
title F50 Pro Monitor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto NO_NODE
if not exist "node_modules\vite" goto NEED_INSTALL
goto READY

:NEED_INSTALL
echo [1/2] 首次运行，正在安装前端依赖（约 1 分钟）...
call npm install --no-audit --no-fund
if errorlevel 1 goto FAIL

:READY
echo [2/2] 正在启动 F50 Pro Monitor（浏览器预览模式）...
start "F50ProMonitor Server" /min cmd /c "node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 1420"
timeout /t 4 >nul
start "" http://127.0.0.1:1420
echo.
echo 已启动。默认设备地址 http://192.168.0.1，可在界面「设置」中修改。
echo 关闭「F50ProMonitor Server」最小化窗口即可停止服务。
timeout /t 3 >nul
goto END

:NO_NODE
echo [错误] 未检测到 Node.js。请安装 Node.js 18 或更高版本后重试。
pause
goto END

:FAIL
echo [错误] 依赖安装失败，请检查网络或手动执行 npm install。
pause
goto END

:END
