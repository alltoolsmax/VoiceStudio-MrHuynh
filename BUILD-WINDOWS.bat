@echo off
rem Build bo cai Voice Studio - Mr.Huynh. Vi du: BUILD-WINDOWS.bat -Version 1.0.1 -Notes "Sua loi"
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows-mrhuynh.ps1" %*
pause
