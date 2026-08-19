@echo off
setlocal EnableExtensions
set "BRIDGE_URL=https://www.zocoia.es/zoco-browser-bridge-v3.zip"
set "INSTALL_DIR=%LOCALAPPDATA%\ZocoBrowserBridge"
set "ARCHIVE=%TEMP%\zoco-browser-bridge-v3.zip"

echo.
echo ============================================================
echo   Instalador guiado de Zoco Browser Bridge
echo ============================================================
echo.
echo Este instalador descargara el puente oficial de Zoco y lo
Echo preparara automaticamente. No solicita ni muestra contrasenas.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%BRIDGE_URL%' -OutFile '%ARCHIVE%'; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo.
  echo No se ha podido descargar el puente. Comprueba tu conexion e intentalo de nuevo.
  pause
  exit /b 1
)

if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
mkdir "%INSTALL_DIR%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -LiteralPath '%ARCHIVE%' -DestinationPath '%INSTALL_DIR%' -Force; if (Test-Path '%INSTALL_DIR%\manifest.json') { exit 0 } else { exit 2 } } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo.
  echo No se ha podido preparar el puente de Zoco.
  pause
  exit /b 1
)

for %%C in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
  if exist "%%~C" set "CHROME=%%~C"
)
if not defined CHROME (
  echo.
  echo No se ha encontrado Google Chrome automaticamente.
  echo El puente se ha preparado en: %INSTALL_DIR%
  pause
  exit /b 1
)

echo.
echo El puente se ha preparado correctamente.
echo.
echo Para activarlo con tu sesion personal, Chrome debe reiniciarse.
echo Se cerraran las ventanas de Chrome abiertas. Guarda antes cualquier formulario importante.
choice /C SN /M "Quieres reiniciar Chrome y activar Zoco Browser Bridge ahora"
if errorlevel 2 (
  echo.
  echo Instalacion preparada. Cuando quieras activarla, ejecuta este archivo de nuevo.
  pause
  exit /b 0
)

taskkill /F /IM chrome.exe >nul 2>&1
start "Zoco Browser Bridge" "%CHROME%" --load-extension="%INSTALL_DIR%" "https://www.zocoia.es/computer"
echo.
echo Chrome se ha reiniciado con Zoco Browser Bridge activo.
echo Vuelve a Zoco y utiliza el codigo temporal de vinculacion.
timeout /t 6 >nul
exit /b 0
