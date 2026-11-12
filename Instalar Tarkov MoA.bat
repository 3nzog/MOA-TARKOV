@echo off
rem ============================================================================
rem  Tarkov MoA - instalador.
rem
rem  Pode ficar em qualquer lugar (Downloads, Area de Trabalho...): instala
rem  sempre em "Documentos\Tarkov MoA". Se ja estiver instalado, atualiza para
rem  a versao mais nova do repositorio.
rem
rem  O repositorio e privado. Este arquivo NAO guarda senha nem token: na
rem  primeira vez o Git abre o login do GitHub no navegador, e cada pessoa entra
rem  com a PROPRIA conta. Essa conta precisa ter sido convidada para o
rem  repositorio (GitHub > Settings > Collaborators) e ter aceitado o convite.
rem
rem  Tudo o que acontece fica anotado em %TEMP%\TarkovMoA-instalador.log. Se der
rem  erro, esse arquivo abre no Bloco de Notas e a janela so fecha digitando SAIR,
rem  para ninguem perder a mensagem apertando Enter.
rem
rem  Visual: o arquivo e UTF-8 (chcp 65001) e usa as cores do terminal do
rem  Windows 10/11 (sequencias ANSI). O log fica em texto puro, sem cores.
rem ============================================================================
setlocal EnableExtensions
chcp 65001 >nul
title Tarkov MoA - instalador
set "REPO=https://github.com/3nzog/MOA-TARKOV.git"
set "LOG=%TEMP%\TarkovMoA-instalador.log"
> "%LOG%" echo Tarkov MoA - instalador - %DATE% %TIME%
>>"%LOG%" echo Windows: & ver >>"%LOG%" 2>&1
call :ui_init
call :banner

call :refresh_path

rem ---- 1. Pasta de destino e Git ---------------------------------------------------
rem  Documentos, mesmo se o Windows mover a pasta para o OneDrive.
call :section "1/4" "Pasta e Git"
set "DOCS="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "DOCS=%%D"
if not defined DOCS set "DOCS=%USERPROFILE%\Documents"
set "DEST=%DOCS%\Tarkov MoA"
call :ok "Pasta de instalação" "%DEST%"

where git >nul 2>&1
if not errorlevel 1 goto :git_ok
call :run "Git não encontrado: instalando o Git para Windows"
call :note "Pode pedir permissão do Windows."
where winget >nul 2>&1
if errorlevel 1 goto :no_winget
winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements >>"%LOG%" 2>&1
call :refresh_path
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>&1
if errorlevel 1 goto :git_missing
:git_ok
set "GITV="
for /f "tokens=3" %%v in ('git --version 2^>nul') do set "GITV=%%v"
call :ok "Git" "%GITV%"
git --version >>"%LOG%" 2>&1

rem  So o gerenciador de credenciais do Git (login pelo navegador, guardado no
rem  Windows). Nada de senha ou token neste arquivo.
set "GITAUTH=-c credential.helper= -c credential.helper=manager"

rem ---- 2. Baixar ou atualizar -------------------------------------------------------
if exist "%DEST%\.git" goto :update
if exist "%DEST%\" (
  dir /b /a "%DEST%" 2>nul | findstr "^" >nul && goto :dest_busy
)

call :section "2/4" "Baixando o Tarkov MoA"
call :run "Baixando do GitHub"
call :note "Se abrir uma janela ou o navegador pedindo login, entre com a SUA"
call :note "conta do GitHub (a que foi convidada para o repositório)."
git %GITAUTH% clone "%REPO%" "%DEST%" >>"%LOG%" 2>&1
if errorlevel 1 goto :clone_failed
call :ok "Baixado"
goto :shortcut

:update
call :section "2/4" "Atualizando o Tarkov MoA"
tasklist /fi "imagename eq tarkov-companion.exe" 2>nul | find /i "tarkov-companion.exe" >nul
if not errorlevel 1 goto :close_app_first
call :run "Já instalado: buscando a versão mais nova"
git -C "%DEST%" %GITAUTH% pull --ff-only >>"%LOG%" 2>&1
if errorlevel 1 goto :update_failed
call :ok "Atualizado"

rem ---- 3. Atalho na Area de Trabalho -----------------------------------------------
:shortcut
call :section "3/4" "Atalho"
if not exist "%DEST%\Abrir Tarkov MoA.bat" goto :broken_copy
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Tarkov MoA.lnk')); $s.TargetPath = Join-Path $env:DEST 'Abrir Tarkov MoA.bat'; $s.WorkingDirectory = $env:DEST; $s.IconLocation = (Join-Path $env:DEST 'src-tauri\icons\icon.ico') + ',0'; $s.Description = 'Tarkov MoA'; $s.Save()" >>"%LOG%" 2>&1
if errorlevel 1 (
  call :warn "Não deu para criar o atalho: abra pelo Abrir Tarkov MoA.bat na pasta"
) else (
  call :ok "Atalho Tarkov MoA" "na Área de Trabalho"
)

rem ---- 4. Abrir (o abridor instala o resto e compila na primeira vez) --------------
call :section "4/4" "Abrindo"
call :ok "Instalação pronta"
call :note "Na primeira vez o programa instala o que falta e compila; leva alguns minutos."
timeout /t 2 >nul 2>&1
call "%DEST%\Abrir Tarkov MoA.bat"
exit /b %errorlevel%

rem =============================================================================
rem  Visual (cada linha tambem vai para o log, em texto puro)
rem =============================================================================

:ui_init
for /f %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"
set "R=%ESC%[0m"
set "B=%ESC%[1m"
set "TXT=%ESC%[38;2;228;232;222m"
set "DIM=%ESC%[38;2;120;128;114m"
set "ACC=%ESC%[38;2;127;214;172m"
set "OKC=%ESC%[38;2;96;222;150m"
set "RUNC=%ESC%[38;2;118;188;242m"
set "WARNC=%ESC%[38;2;240;192;92m"
set "ERRC=%ESC%[38;2;242;104;104m"
set "G1=%ESC%[38;2;186;244;214m"
set "G2=%ESC%[38;2;150;230;192m"
set "G3=%ESC%[38;2;127;214;172m"
set "G4=%ESC%[38;2;104;196;186m"
set "G5=%ESC%[38;2;94;174;204m"
set "G6=%ESC%[38;2;90;150;214m"
set "BARW=48"
set "BARON=━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
set "BAROFF=────────────────────────────────────────────────"
exit /b 0

:banner
cls
echo.
echo   %G1%████████╗ █████╗ ██████╗ ██╗  ██╗ ██████╗ ██╗   ██╗    ███╗   ███╗ ██████╗  █████╗ %R%
echo   %G2%╚══██╔══╝██╔══██╗██╔══██╗██║ ██╔╝██╔═══██╗██║   ██║    ████╗ ████║██╔═══██╗██╔══██╗%R%
echo   %G3%   ██║   ███████║██████╔╝█████╔╝ ██║   ██║██║   ██║    ██╔████╔██║██║   ██║███████║%R%
echo   %G4%   ██║   ██╔══██║██╔══██╗██╔═██╗ ██║   ██║╚██╗ ██╔╝    ██║╚██╔╝██║██║   ██║██╔══██║%R%
echo   %G5%   ██║   ██║  ██║██║  ██║██║  ██╗╚██████╔╝ ╚████╔╝     ██║ ╚═╝ ██║╚██████╔╝██║  ██║%R%
echo   %G6%   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝   ╚═══╝      ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝%R%
echo.
echo   %DIM%instalador  ·  mapa ao vivo  ·  missões  ·  extrações  ·  party  ·  mesa de armas%R%
echo   %DIM%─────────────────────────────────────────────────────────────────────────────────────%R%
exit /b 0

rem  :section "1/4" "Titulo" - titulo da etapa e a barra de progresso geral
:section
echo.
for /f "tokens=1,2 delims=/" %%a in ("%~1") do call :progress %%a %%b
echo   %ACC%▌%R% %B%%TXT%%~2%R%  %DIM%etapa %~1%R%
>>"%LOG%" echo.
>>"%LOG%" echo == %~2 (etapa %~1) ==
exit /b 0

rem  :progress <feito> <total> - barra que enche conforme as etapas
:progress
set /a "FILL=%~1*BARW/%~2", "EMPTY=BARW-FILL", "PCT=%~1*100/%~2"
call set "ON=%%BARON:~0,%FILL%%%"
call set "OFF=%%BAROFF:~0,%EMPTY%%%"
echo   %G2%%ON%%DIM%%OFF%%R%  %B%%TXT%%PCT%%%%R%
exit /b 0

rem  :ok "texto" ["detalhe"]
:ok
echo     %OKC%✔%R%  %TXT%%~1%R%  %DIM%%~2%R%
>>"%LOG%" echo [ok] %~1 %~2
exit /b 0

:run
echo     %RUNC%●%R%  %TXT%%~1%R%%DIM%...%R%
>>"%LOG%" echo [..] %~1...
exit /b 0

:warn
echo     %WARNC%▲%R%  %TXT%%~1%R%
>>"%LOG%" echo [!!] %~1
exit /b 0

:note
echo        %DIM%%~1%R%
>>"%LOG%" echo      %~1
exit /b 0

rem  :err "linha" - uma linha dentro do quadro de erro
:err
echo   %ERRC%┃%R%  %TXT%%~1%R%
>>"%LOG%" echo %~1
exit /b 0

:err_head
echo.
echo   %ERRC%┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%R%
echo   %ERRC%┃%R%  %ERRC%%B%✖  %~1%R%
echo   %ERRC%┃%R%
>>"%LOG%" echo.
>>"%LOG%" echo ERRO: %~1
exit /b 0

rem =============================================================================
rem  Subrotinas
rem =============================================================================

rem  Recarrega o PATH do registro, para enxergar o que acabou de ser instalado.
:refresh_path
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

rem =============================================================================
rem  Erros: cada um explica o que fazer, anota no log e para em :stop.
rem =============================================================================
:no_winget
call :err_head "O winget não está disponível neste Windows"
call :err "Instale o Instalador de Aplicativo (App Installer) pela Microsoft Store,"
call :err "ou o Git pelo site git-scm.com, e rode este arquivo de novo."
goto :stop

:git_missing
call :err_head "O Git não foi instalado"
call :err "Ou este terminal ainda não enxerga ele. Feche esta janela e abra o"
call :err "instalador de novo. Se continuar, instale o Git pelo site git-scm.com"
call :err "e rode o instalador outra vez."
goto :stop

:dest_busy
call :err_head "Já existe uma pasta com outros arquivos"
call :err "%DEST%"
call :err "não é uma instalação do Tarkov MoA. Para não apagar nada seu, parei."
call :err "Renomeie ou mova essa pasta e rode o instalador de novo."
goto :stop

:clone_failed
call :err_head "Não deu para baixar do GitHub"
call :err "As causas mais comuns:"
call :err " · a sua conta do GitHub ainda não foi convidada para o repositório, ou o"
call :err "   convite não foi aceito (veja o e-mail do GitHub ou github.com/notifications);"
call :err " · o login do GitHub foi cancelado ou feito com outra conta;"
call :err " · sem internet."
call :err "A resposta do GitHub está no log."
if exist "%DEST%\" rd "%DEST%" 2>nul
goto :stop

:close_app_first
call :err_head "Feche o Tarkov MoA antes de atualizar"
call :err "Depois rode o instalador de novo."
goto :stop

:update_failed
call :err_head "Não deu para atualizar"
call :err "Se você mexeu em arquivos dentro da pasta do programa, o Git não"
call :err "sobrescreve as suas mudanças. A resposta do Git está no log."
goto :stop

:broken_copy
call :err_head "A cópia parece incompleta"
call :err "A pasta %DEST% não tem o Abrir Tarkov MoA.bat."
call :err "Mova essa pasta para outro lugar e rode o instalador de novo."
goto :stop

rem  Mostra onde esta o log, abre no Bloco de Notas e so fecha digitando SAIR.
:stop
echo   %ERRC%┃%R%
echo   %ERRC%┃%R%  %DIM%Tudo o que aconteceu está anotado em:%R%
echo   %ERRC%┃%R%  %TXT%%LOG%%R%
echo   %ERRC%┃%R%  %DIM%(abriu no Bloco de Notas: mande ele para quem for te ajudar)%R%
echo   %ERRC%┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%R%
start "" notepad "%LOG%"
:stop_wait
if defined MOA_NO_WAIT exit /b 1
echo.
set "ANS="
set /p "ANS=  %ACC%›%R%  Digite %B%SAIR%R% e aperte Enter para fechar: "
if /i not "%ANS%"=="SAIR" goto :stop_wait
exit /b 1
