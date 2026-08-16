@echo off
REM  DarDesign -- double-click this to start everything for the demo.
REM  No commands to type. It starts the backend, the app, checks whether
REM  the GPU is reachable, and opens the browser.
title DarDesign - starting the demo
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo-start.ps1"
