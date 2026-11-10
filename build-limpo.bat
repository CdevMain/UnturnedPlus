@echo off
REM ============================================================
REM  Unturned+ - build LIMPO, fora do OneDrive
REM
REM  Por que este script existe:
REM  O projeto mora dentro do OneDrive. O OneDrive fica sincronizando
REM  a pasta enquanto o empacotador escreve nela, e trava arquivos no
REM  meio do caminho. Quando isso acontece com o "app.asar" (que
REM  guarda TODO o codigo do app), o electron-builder nao consegue
REM  reescrever, segue adiante calado, e sai um .exe de 170 MB que
REM  abre e nao acha nada - o tal do "corrompido".
REM
REM  Aqui o projeto e copiado para uma pasta local, o build acontece
REM  la (longe do OneDrive), o resultado e CONFERIDO, e so os .exe
REM  prontos voltam para ca.
REM ============================================================
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "ORIGEM=%~dp0"
set "TRABALHO=%LOCALAPPDATA%\unturned-plus-build"
set "SAIDA=%~dp0build-final"

echo.
echo  == Unturned+ : build limpo ==
echo.
echo  Projeto : %ORIGEM%
echo  Build em: %TRABALHO%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org
  goto fim_erro
)

REM ---- 1. copiar o projeto (sem node_modules, dist e .git) ----
echo  [1/5] Copiando o projeto para fora do OneDrive...
robocopy "%ORIGEM:~0,-1%" "%TRABALHO%" /MIR /XD node_modules dist build-final .git .vs /XF *.log /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo  [X] Falha ao copiar os arquivos.
  goto fim_erro
)

cd /d "%TRABALHO%"

REM ---- 2. apagar restos de build anterior ----
echo  [2/5] Limpando builds anteriores...
if exist "dist" rmdir /s /q "dist"

REM ---- 3. dependencias ----
if not exist "node_modules\" (
  echo  [3/5] Instalando dependencias ^(so na primeira vez^)...
  call npm install
  if errorlevel 1 goto fim_erro
) else (
  echo  [3/5] Dependencias ja instaladas.
)

REM ---- 4. empacotar ----
echo  [4/5] Empacotando... a primeira vez baixa o Electron e o NSIS.
echo.
call npm run dist
if errorlevel 1 goto fim_erro

REM ---- 5. CONFERIR ----
REM Este passo e o motivo do script. Um app.asar vazio passa
REM despercebido e vira um .exe que so quebra na mao do testador.
echo.
echo  [5/5] Conferindo o resultado...

set "ASAR=%TRABALHO%\dist\win-unpacked\resources\app.asar"
if not exist "%ASAR%" (
  echo  [X] app.asar nao foi gerado.
  goto fim_erro
)
for %%A in ("%ASAR%") do set "TAM=%%~zA"
if "!TAM!"=="0" (
  echo  [X] app.asar saiu VAZIO ^(0 bytes^) - o .exe nao vai funcionar.
  echo      Feche o Unturned+, o VS Code e o antivirus, e rode de novo.
  goto fim_erro
)
echo      app.asar: !TAM! bytes  [ok]

set "ACHOU="
for %%F in ("%TRABALHO%\dist\*.exe") do set "ACHOU=1"
if not defined ACHOU (
  echo  [X] Nenhum .exe foi gerado em dist.
  goto fim_erro
)

REM ---- trazer o resultado de volta ----
if not exist "%SAIDA%" mkdir "%SAIDA%"
copy /y "%TRABALHO%\dist\*.exe" "%SAIDA%" >nul

echo.
echo  == Pronto ==
echo.
for %%F in ("%SAIDA%\*.exe") do echo   %%~nxF   ^(%%~zF bytes^)
echo.
echo  Os arquivos estao em: %SAIDA%
echo  Para mandar aos amigos, use o "-portable.exe".
echo.
start "" "%SAIDA%"
pause
exit /b 0

:fim_erro
echo.
echo  [X] A build nao terminou. Copie as ultimas linhas acima e mande para a Sara.
echo.
pause
exit /b 1
