@echo off
title Security Monitor - Update and quick scan
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SecurityMonitor.ps1" -QuickScan
echo.
pause
