@echo off
REM ============================================================
REM  Unturned+ - gerar os executaveis para Windows
REM
REM  Basta dar dois cliques neste arquivo. Ele instala o que
REM  falta e gera os dois arquivos dentro da pasta "dist":
REM
REM    UnturnedPlus-1.3.0-portable.exe  -> um arquivo so, sem instalar
REM    UnturnedPlus-1.3.0-setup.exe     -> instalador com atalhos
REM ============================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo  == Unturned+ : gerando build para Windows ==
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js nao encontrado.
  echo      Instale a versao LTS em https://nodejs.org e rode de novo.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo  Node %%v

if not exist "node_modules\" (
  echo.
  echo  Instalando dependencias ^(so na primeira vez, pode demorar^)...
  call npm install
  if errorlevel 1 goto erro
) else (
  echo  Dependencias ja instaladas.
)

echo.
echo  Empacotando... a primeira build baixa o Electron ^(~100 MB^).
echo.
call npm run dist
if errorlevel 1 goto erro

echo.
echo  == Pronto ==
echo  Os arquivos estao em: %cd%\dist
echo.
echo  Para mandar para um amigo, use o "-portable.exe":
echo  e um arquivo so, nao precisa instalar nada.
echo.
start "" "%cd%\dist"
pause
exit /b 0

:erro
echo.
echo  [X] A build falhou. Copie as ultimas linhas vermelhas acima
echo      e mande para a Sara.
echo.
pause
exit /b 1
