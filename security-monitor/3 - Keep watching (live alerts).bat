@echo off
title Security Monitor - Watching (close this window to stop)
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SecurityMonitor.ps1" -Watch -IntervalMinutes 5
