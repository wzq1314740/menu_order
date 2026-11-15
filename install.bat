@echo off
title 桂亭 · 安装局域网点餐服务
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo 请右键点击 install.bat，选择“以管理员身份运行”。
  pause
  exit /b 1
)
where python >nul 2>&1
if errorlevel 1 (
  echo 未找到 Python。请先安装 Python 3，安装时勾选 "Add python.exe to PATH"，然后重新运行本脚本。
  start "" https://www.python.org/downloads/windows/
  pause
  exit /b 1
)
python server.py --install
echo.
echo 安装完成。请把上面的地址发给需要使用的设备。
pause
