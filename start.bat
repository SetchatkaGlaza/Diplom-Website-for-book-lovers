@echo off
REM Запуск сайта "Книгоманы" локально в Windows — двойным щелчком.
REM
REM   start.bat          обычный режим: база в папке .data, данные сохраняются
REM   start.bat --reset  начать с чистой базы (демо-данные зальются заново)
REM
REM Postgres устанавливать не нужно: используется PGlite — Postgres внутри Node.
REM Остановить сервер: Ctrl+C в этом окне.
setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node 22 LTS с https://nodejs.org и запустите снова.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Нужен Node 20 или новее. Скачайте LTS: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo == Устанавливаю зависимости, это займет пару минут ==
  call npm ci
  if errorlevel 1 (
    echo Установка не удалась. Проверьте интернет и права на папку.
    pause
    exit /b 1
  )
)

if /I "%~1"=="--reset" (
  echo == Чищу базу .data ==
  if exist .data rmdir /s /q .data
)

echo == Запускаю: http://localhost:3000 ==
echo    Вход для проверки админки: anna@example.com / reader2026
echo    Остановить: Ctrl+C
set DB_DRIVER=pglite
set PGLITE_DATA_DIR=%cd%\.data
if not defined DB_SEED set DB_SEED=true
if not defined PORT set PORT=3000
node src/server.js
pause
