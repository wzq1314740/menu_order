@echo off
title 桂亭 · 卸载局域网点餐服务
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo 请右键点击 uninstall.bat，选择“以管理员身份运行”。
  pause
  exit /b 1
)
python server.py --uninstall
echo.
echo 订单和菜单数据保存在 data 文件夹，未被删除。
pause
