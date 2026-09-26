@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instala Node.js 20 o superior desde https://nodejs.org y vuelve a ejecutar este archivo. & pause & exit /b 1)
call corepack enable
call corepack pnpm install --frozen-lockfile || (pause & exit /b 1)
call corepack pnpm run package:hostinger || (pause & exit /b 1)
echo.
echo Listo. Sube worldbox3d-hostinger.zip a Hostinger (Administrador de archivos ^> public_html ^> Extraer).
pause
