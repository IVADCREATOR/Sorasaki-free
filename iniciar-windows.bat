@echo off
title Sorasaki free
cd /d "%~dp0"
:inicio
node index.js
echo.
echo A Sorasaki parou. Reiniciando em 5 segundos...
timeout /t 5 /nobreak >nul
goto inicio
