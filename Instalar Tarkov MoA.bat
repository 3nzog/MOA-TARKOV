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
rem  Depois cria o atalho "Tarkov MoA" na Area de Trabalho e abre o programa
rem  (que instala o resto do que faltar: Node.js, Rust, compilador C++...).
rem ============================================================================
setlocal EnableExtensions
title Tarkov MoA - instalador
set "REPO=https://github.com/3nzog/MOA-TARKOV.git"

echo.
echo  ===  Tarkov MoA - instalador  ===
echo.

call :refresh_path

rem ---- Pasta de destino: Documentos (mesmo se o Windows mover para o OneDrive) --
set "DOCS="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "DOCS=%%D"
if not defined DOCS set "DOCS=%USERPROFILE%\Documents"
set "DEST=%DOCS%\Tarkov MoA"
echo  Pasta de instalacao: "%DEST%"
echo.

rem ---- Git ----------------------------------------------------------------------
where git >nul 2>&1
if not errorlevel 1 goto :git_ok
echo  [..] Git nao encontrado. Instalando o Git para Windows...
where winget >nul 2>&1
if errorlevel 1 goto :no_winget
winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
call :refresh_path
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>&1
if errorlevel 1 goto :restart_needed
:git_ok
echo  [ok] Git

rem  So o gerenciador de credenciais do Git (login pelo navegador, guardado no
rem  Windows). Nada de senha ou token neste arquivo.
set "GITAUTH=-c credential.helper= -c credential.helper=manager"

rem ---- Baixar ou atualizar -------------------------------------------------------
if exist "%DEST%\.git" goto :update
if exist "%DEST%\" (
  dir /b /a "%DEST%" 2>nul | findstr "^" >nul && goto :dest_busy
)

echo.
echo  [..] Baixando o Tarkov MoA do GitHub...
echo       Se o navegador abrir pedindo login, entre com a SUA conta do GitHub
echo       (a que foi convidada para o repositorio).
echo.
git %GITAUTH% clone "%REPO%" "%DEST%"
if errorlevel 1 goto :clone_failed
echo  [ok] Baixado
goto :shortcut

:update
tasklist /fi "imagename eq tarkov-companion.exe" 2>nul | find /i "tarkov-companion.exe" >nul
if not errorlevel 1 goto :close_app_first
echo  [..] Ja instalado. Atualizando para a versao mais nova...
git -C "%DEST%" %GITAUTH% pull --ff-only
if errorlevel 1 goto :update_failed
echo  [ok] Atualizado

rem ---- Atalho na Area de Trabalho -----------------------------------------------
:shortcut
if not exist "%DEST%\Abrir Tarkov MoA.bat" goto :broken_copy
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Tarkov MoA.lnk')); $s.TargetPath = Join-Path $env:DEST 'Abrir Tarkov MoA.bat'; $s.WorkingDirectory = $env:DEST; $s.IconLocation = (Join-Path $env:DEST 'src-tauri\icons\icon.ico') + ',0'; $s.Description = 'Tarkov MoA'; $s.Save()"
if errorlevel 1 (
  echo  [!!] Nao deu para criar o atalho. Abra pelo "Abrir Tarkov MoA.bat" na pasta.
) else (
  echo  [ok] Atalho "Tarkov MoA" na Area de Trabalho
)

rem ---- Abrir (o abridor instala o resto e compila na primeira vez) --------------
echo.
call "%DEST%\Abrir Tarkov MoA.bat"
exit /b %errorlevel%

rem =============================================================================
rem  Subrotinas
rem =============================================================================

rem  Recarrega o PATH do registro, para enxergar o que acabou de ser instalado.
:refresh_path
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

rem =============================================================================
rem  Erros
rem =============================================================================
:no_winget
echo.
echo  O winget nao esta disponivel neste Windows. Instale o "Instalador de
echo  Aplicativo" (App Installer) pela Microsoft Store, ou o Git pelo site
echo  git-scm.com, e rode este arquivo de novo.
goto :end_pause

:restart_needed
echo.
echo  O Git foi instalado, mas este terminal ainda nao enxerga ele.
echo  Feche esta janela e abra o instalador de novo.
goto :end_pause

:dest_busy
echo.
echo  Ja existe uma pasta "%DEST%" com outros arquivos, que nao e uma
echo  instalacao do Tarkov MoA. Para nao apagar nada seu, o instalador parou.
echo  Renomeie ou mova essa pasta e rode o instalador de novo.
goto :end_pause

:clone_failed
echo.
echo  Nao deu para baixar. As causas mais comuns:
echo   - a sua conta do GitHub ainda nao foi convidada para o repositorio, ou o
echo     convite nao foi aceito (veja o e-mail do GitHub ou github.com/notifications);
echo   - o login no navegador foi cancelado;
echo   - sem internet.
echo  Resolva e rode o instalador de novo.
if exist "%DEST%\" rd "%DEST%" 2>nul
goto :end_pause

:close_app_first
echo.
echo  Feche o Tarkov MoA antes de atualizar e rode o instalador de novo.
goto :end_pause

:update_failed
echo.
echo  Nao deu para atualizar. Se voce mexeu em arquivos dentro da pasta do
echo  programa, o Git nao sobrescreve as suas mudancas. Veja a mensagem acima.
goto :end_pause

:broken_copy
echo.
echo  A pasta "%DEST%" nao tem o "Abrir Tarkov MoA.bat". A copia parece
echo  incompleta: mova essa pasta para outro lugar e rode o instalador de novo.
goto :end_pause

:end_pause
echo.
pause
exit /b 1
