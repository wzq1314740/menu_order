@echo off
title 桂亭 · 局域网点餐服务
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo 未找到 Python。请先安装 Python 3，安装时勾选 "Add python.exe to PATH"。
  start "" https://www.python.org/downloads/windows/
  pause
  exit /b 1
)
echo 正在启动服务，关闭本窗口即停止服务。
echo 如果已通过 install.bat 设置了开机自启，服务已在后台运行，无需再运行本脚本。
echo.
python server.py
pause
