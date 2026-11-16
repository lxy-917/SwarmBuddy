@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-SwarmBuddy.ps1" -RestartBackend
if errorlevel 1 pause
