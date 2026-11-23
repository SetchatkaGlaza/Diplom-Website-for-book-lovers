@echo off
REM Запуск сайта "Книгоманы" в Windows — двойным щелчком по этому файлу.
REM
REM   Postgres и Docker устанавливать не нужно: если Postgres не найден,
REM   сайт поднимется на встроенной базе в папке .data.
REM
REM   start.bat          обычный запуск (данные сохраняются)
REM   start.bat --reset  начать с чистой базы
REM   start.bat --doctor только проверить окружение, не запускать сайт
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js не найден.
  echo Установите Node.js 22 LTS с https://nodejs.org , затем закройте это окно
  echo и запустите start.bat снова.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Нужен Node.js 20 или новее. Сейчас: 
  node -v
  echo Скачайте LTS: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo == Устанавливаю зависимости, это займет пару минут ==
  call npm ci
  if errorlevel 1 (
    echo.
    echo Установка не удалась. Проверьте интернет и права на папку.
    pause
    exit /b 1
  )
)

if /I "%~1"=="--doctor" (
  call npm run doctor
  pause
  exit /b 0
)

if /I "%~1"=="--reset" (
  echo == Чищу базу и заливаю демо-данные ==
  call npm run db:reset
)

echo.
echo == Запускаю сайт: http://localhost:3000 ==
echo    Вход: anna@example.com / reader2026
echo    Остановить: Ctrl+C
echo.
if not defined PORT set PORT=3000
call npm start
echo.
echo Сайт остановлен.
pause
