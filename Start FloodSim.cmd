@echo off
rem FloodSim launcher: starts the local server (if it is not already running) and opens the app in your browser.
rem Port 8766 is taken by another program on this PC, so FloodSim uses 8770. Close the "FloodSim server" window to stop it.
setlocal
set PORT=8770
cd /d "%~dp0"

where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules (echo First run: installing packages... & call npm install || (pause & exit /b 1))

rem already running? just open it
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:%PORT%/app/map.html | Out-Null; exit 0 } catch { exit 1 }" && goto open

start "FloodSim server" /min cmd /c "set PORT=%PORT%&& node server/server.mjs"
rem wait for the server to answer (up to ~15 s)
for /l %%i in (1,1,30) do (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:%PORT%/app/map.html | Out-Null; exit 0 } catch { exit 1 }" && goto open
  timeout /t 1 /nobreak >nul
)
echo The server did not start. Run "node server/server.mjs" in this folder to see why.
pause
exit /b 1

:open
start "" http://localhost:%PORT%/app/map.html
