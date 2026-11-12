@echo off
rem Drag a LinkedIn Campaign Manager export onto this file (or run: convert-linkedin.cmd "C:\path\export.csv" [--account "Name"] [--currency INR] [--date-format dmy]).
rem It writes <export>.converted.csv next to the original, ready for "Import CSV/JSON" on the LinkedIn Ads card of the Paid advertising page.
setlocal
set "NODE=%~dp0..\node\node-v26.13.0-win-x64\node.exe"
if "%~1"=="" (
  echo Drag a LinkedIn export file onto this file, or pass its path as the first argument.
  pause
  exit /b 2
)
"%NODE%" "%~dp0linkedin-export-to-feed.mjs" %*
echo.
pause
