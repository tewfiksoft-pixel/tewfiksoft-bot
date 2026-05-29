@echo off
title TewfikSoft Auto-Sync Watcher
color 0A
echo ============================================
echo    TewfikSoft - Synchronisation Automatique
echo ============================================
echo.
echo Ce programme surveille la base de donnees et
echo synchronise automatiquement avec le Bot.
echo.
echo NE PAS FERMER CETTE FENETRE !
echo.
cd /d "%~dp0"
node auto_sync_watcher.cjs
pause
