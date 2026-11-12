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
rem ============================================================================
setlocal EnableExtensions
title Tarkov MoA - instalador
set "REPO=https://github.com/3nzog/MOA-TARKOV.git"
set "LOG=%TEMP%\TarkovMoA-instalador.log"
> "%LOG%" echo Tarkov MoA - instalador - %DATE% %TIME%
>>"%LOG%" echo Windows: & ver >>"%LOG%" 2>&1

echo.
echo  ===  Tarkov MoA - instalador  ===
echo.

call :refresh_path

rem ---- Pasta de destino: Documentos (mesmo se o Windows mover para o OneDrive) --
set "DOCS="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "DOCS=%%D"
if not defined DOCS set "DOCS=%USERPROFILE%\Documents"
set "DEST=%DOCS%\Tarkov MoA"
call :say "Pasta de instalacao: %DEST%"
echo.

rem ---- Git ----------------------------------------------------------------------
where git >nul 2>&1
if not errorlevel 1 goto :git_ok
call :say "[..] Git nao encontrado. Instalando o Git para Windows (pode pedir permissao)..."
where winget >nul 2>&1
if errorlevel 1 goto :no_winget
winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements >>"%LOG%" 2>&1
call :refresh_path
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>&1
if errorlevel 1 goto :git_missing
:git_ok
call :say "[ok] Git"
git --version >>"%LOG%" 2>&1

rem  So o gerenciador de credenciais do Git (login pelo navegador, guardado no
rem  Windows). Nada de senha ou token neste arquivo.
set "GITAUTH=-c credential.helper= -c credential.helper=manager"

rem ---- Baixar ou atualizar -------------------------------------------------------
if exist "%DEST%\.git" goto :update
if exist "%DEST%\" (
  dir /b /a "%DEST%" 2>nul | findstr "^" >nul && goto :dest_busy
)

echo.
call :say "[..] Baixando o Tarkov MoA do GitHub..."
echo       Se abrir uma janela ou o navegador pedindo login, entre com a SUA
echo       conta do GitHub (a que foi convidada para o repositorio).
echo.
git %GITAUTH% clone "%REPO%" "%DEST%" >>"%LOG%" 2>&1
if errorlevel 1 goto :clone_failed
call :say "[ok] Baixado"
goto :shortcut

:update
tasklist /fi "imagename eq tarkov-companion.exe" 2>nul | find /i "tarkov-companion.exe" >nul
if not errorlevel 1 goto :close_app_first
call :say "[..] Ja instalado. Atualizando para a versao mais nova..."
git -C "%DEST%" %GITAUTH% pull --ff-only >>"%LOG%" 2>&1
if errorlevel 1 goto :update_failed
call :say "[ok] Atualizado"

rem ---- Atalho na Area de Trabalho -----------------------------------------------
:shortcut
if not exist "%DEST%\Abrir Tarkov MoA.bat" goto :broken_copy
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Tarkov MoA.lnk')); $s.TargetPath = Join-Path $env:DEST 'Abrir Tarkov MoA.bat'; $s.WorkingDirectory = $env:DEST; $s.IconLocation = (Join-Path $env:DEST 'src-tauri\icons\icon.ico') + ',0'; $s.Description = 'Tarkov MoA'; $s.Save()" >>"%LOG%" 2>&1
if errorlevel 1 (
  call :say "[!!] Nao deu para criar o atalho. Abra pelo Abrir Tarkov MoA.bat na pasta."
) else (
  call :say "[ok] Atalho Tarkov MoA na Area de Trabalho"
)

rem ---- Abrir (o abridor instala o resto e compila na primeira vez) --------------
echo.
call :say "[..] Abrindo o Tarkov MoA (na primeira vez ele instala o resto e compila)"
call "%DEST%\Abrir Tarkov MoA.bat"
exit /b %errorlevel%

rem =============================================================================
rem  Subrotinas
rem =============================================================================

rem  :say "texto" - mostra na tela e anota no log.
:say
echo  %~1
>>"%LOG%" echo %~1
exit /b 0

rem  Recarrega o PATH do registro, para enxergar o que acabou de ser instalado.
:refresh_path
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

rem =============================================================================
rem  Erros: cada um explica o que fazer, anota no log e para em :stop.
rem =============================================================================
:no_winget
call :say "ERRO: o winget nao esta disponivel neste Windows."
call :say "Instale o Instalador de Aplicativo (App Installer) pela Microsoft Store,"
call :say "ou o Git pelo site git-scm.com, e rode este arquivo de novo."
goto :stop

:git_missing
call :say "ERRO: o Git nao foi instalado, ou este terminal ainda nao enxerga ele."
call :say "Feche esta janela e abra o instalador de novo. Se continuar, instale o Git"
call :say "pelo site git-scm.com e rode o instalador outra vez."
goto :stop

:dest_busy
call :say "ERRO: ja existe a pasta %DEST% com outros arquivos,"
call :say "que nao e uma instalacao do Tarkov MoA. Para nao apagar nada seu, parei."
call :say "Renomeie ou mova essa pasta e rode o instalador de novo."
goto :stop

:clone_failed
call :say "ERRO: nao deu para baixar do GitHub. As causas mais comuns:"
call :say " - a sua conta do GitHub ainda nao foi convidada para o repositorio, ou o"
call :say "   convite nao foi aceito - veja o e-mail do GitHub ou github.com/notifications;"
call :say " - o login do GitHub foi cancelado ou feito com outra conta;"
call :say " - sem internet."
call :say "A resposta do GitHub esta logo acima, neste arquivo."
if exist "%DEST%\" rd "%DEST%" 2>nul
goto :stop

:close_app_first
call :say "ERRO: feche o Tarkov MoA antes de atualizar e rode o instalador de novo."
goto :stop

:update_failed
call :say "ERRO: nao deu para atualizar. Se voce mexeu em arquivos dentro da pasta do"
call :say "programa, o Git nao sobrescreve as suas mudancas. Veja a resposta acima."
goto :stop

:broken_copy
call :say "ERRO: a pasta %DEST% nao tem o Abrir Tarkov MoA.bat."
call :say "A copia parece incompleta: mova essa pasta para outro lugar e rode de novo."
goto :stop

rem  Mostra onde esta o log, abre no Bloco de Notas e so fecha digitando SAIR.
:stop
echo.
echo  ------------------------------------------------------------------
echo   Algo deu errado. O que aconteceu esta anotado em:
echo   %LOG%
echo   (o arquivo abriu no Bloco de Notas - mande ele para quem te ajudar)
echo  ------------------------------------------------------------------
start "" notepad "%LOG%"
:stop_wait
if defined MOA_NO_WAIT exit /b 1
echo.
set "ANS="
set /p "ANS=  Digite SAIR e aperte Enter para fechar: "
if /i not "%ANS%"=="SAIR" goto :stop_wait
exit /b 1
