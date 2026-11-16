@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-SwarmBuddy.ps1" -RestartBackend -NoBrowser
if errorlevel 1 (
  echo Backend restart failed. Please send the error above.
) else (
  echo Backend restarted. Refresh the page and generate a new route.
)
pause
