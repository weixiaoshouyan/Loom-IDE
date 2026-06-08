@echo off
cd /d "E:\工作\SDA配置\loom"
echo Cleaning...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /q package-lock.json
echo Installing dependencies...
npm install --registry=https://registry.npmmirror.com
echo Done!
pause
