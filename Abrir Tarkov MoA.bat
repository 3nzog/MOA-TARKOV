@echo off
rem ============================================================================
rem  Tarkov MoA - instala, atualiza e abre. Um arquivo so para tudo.
rem
rem  Fora da pasta do programa (Downloads, Area de Trabalho...): INSTALA em
rem  "Documentos\Tarkov MoA" (baixa do GitHub; se ja estiver instalado, atualiza
rem  mesmo uma instalacao antiga ou quebrada), cria o atalho na Area de Trabalho
rem  e segue abrindo. Dentro da pasta do programa: ATUALIZA e ABRE.
rem
rem  Abrindo, na primeira vez instala (pelo winget, das fontes oficiais) o que
rem  nao estiver no PC:
rem    - Git                         (baixa as versoes novas do GitHub)
rem    - Node.js LTS                 (roda a interface)
rem    - Rust (rustup)               (compila o nucleo do app)
rem    - Visual Studio Build Tools   (compilador C++ que o Rust usa no Windows)
rem    - WebView2 Runtime            (motor da janela; ja vem no Windows 11)
rem  Antes de tudo, pega no GitHub o .bat mais novo e passa a vez para ele (veja
rem  o passo 0). Depois busca a versao mais nova no GitHub, baixa as
rem  dependencias (npm), compila a versao final uma vez e abre o MoA sem deixar
rem  terminal aberto. Nas proximas vezes so confere e abre; recompila sozinho
rem  quando o codigo do projeto mudar.
rem
rem  O nome continua "Abrir Tarkov MoA.bat": o .exe, os atalhos e os .bat
rem  antigos procuram por ele.
rem
rem  Este arquivo NAO guarda senha nem token. O repositorio e publico: baixar
rem  e atualizar nao pede login. Se um dia ele voltar a ser privado, o Git abre
rem  o login do GitHub no navegador e cada pessoa entra com a PROPRIA conta.
rem
rem  Mandado para alguem (Downloads, uma mensagem), ele instala ou conserta a
rem  instalacao e depois se apaga: dai em diante vale o atalho Tarkov MoA.
rem
rem  Tudo o que acontece fica anotado em %TEMP%\TarkovMoA.log (e o que o Git
rem  responde ao abrir, em %TEMP%\TarkovMoA-atualizacao.log).
rem
rem  Visual: o arquivo e UTF-8 (chcp 65001) e usa as cores do terminal do
rem  Windows 10/11 (sequencias ANSI). O log fica em texto puro, sem cores.
rem ============================================================================
setlocal EnableExtensions
chcp 65001 >nul
title Tarkov MoA
set "REPO=https://github.com/3nzog/MOA-TARKOV.git"
if defined MOA_REPO set "REPO=%MOA_REPO%"
rem  Um log por vez que se abre (a instalacao chama a abertura: o mesmo log).
set "LOG=%TEMP%\TarkovMoA.log"
if not defined MOA_LOG_ON (
  set "MOA_LOG_ON=1"
  > "%LOG%" echo Tarkov MoA - %DATE% %TIME%
  >>"%LOG%" ver
)
rem  Git refuses a folder another Windows user made, or one copied from another
rem  PC ("dubious ownership"), and every update then fails. This file only
rem  works in the program's own folders: Git trusts them while it runs.
set "GIT_CONFIG_COUNT=1"
set "GIT_CONFIG_KEY_0=safe.directory"
set "GIT_CONFIG_VALUE_0=*"

rem ---- Instalar ou abrir --------------------------------------------------------------
rem  --instalar: instalar (de uma copia em %TEMP%, veja abaixo). --copia e
rem  --atualizado: abrir (passo 0). Sem nada: abre se este arquivo esta na pasta
rem  do programa, senao instala.
if /i "%~1"=="--instalar" goto :install
if /i "%~1"=="--copia" goto :open
if /i "%~1"=="--atualizado" goto :open
if not exist "%~dp0package.json" goto :install
if not exist "%~dp0src-tauri\" goto :install
rem  A pasta do programa, mas sem o Git do GitHub (copia manual, zip, instalador
rem  muito antigo): ela nunca se atualizaria. Instala uma que se atualiza, rodando
rem  de uma copia em %TEMP%, porque esta pasta pode ser renomeada no caminho.
if exist "%~dp0.git\" goto :open
set "ICOPY=%TEMP%\TarkovMoA-instalar-%RANDOM%%RANDOM%.bat"
copy /y "%~f0" "%ICOPY%" >nul 2>&1
if errorlevel 1 goto :open
(
  call "%ICOPY%" --instalar
  del "%ICOPY%" >nul 2>&1
  exit /b
)

rem =============================================================================
rem  INSTALAR
rem =============================================================================
:install
rem  Nada aberto dentro da pasta que pode ser renomeada.
cd /d "%TEMP%"
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
if defined MOA_DEST set "DEST=%MOA_DEST%"
call :ok "Pasta de instalação" "%DEST%"

call :need_git
if errorlevel 2 goto :i_no_winget
if errorlevel 1 goto :i_git_missing
:i_git_ok
set "GITV="
for /f "tokens=3" %%v in ('git --version 2^>nul') do set "GITV=%%v"
call :ok "Git" "%GITV%"
git --version >>"%LOG%" 2>&1

rem  So o gerenciador de credenciais do Git (login pelo navegador, guardado no
rem  Windows). Nada de senha ou token neste arquivo.
set "GITAUTH=-c credential.helper= -c credential.helper=manager"

rem ---- 2. Baixar ou atualizar -------------------------------------------------------
set "GLOG=%TEMP%\TarkovMoA-git.log"
rem  Asked by the opening, when the installed folder would not update: a fresh one.
if defined MOA_REPAIR (
  set "MOA_REPAIR="
  set "REPAIRED=1"
  if exist "%DEST%\" goto :i_old_copy
)
if exist "%DEST%\.git" goto :i_update
rem  Uma pasta "Tarkov MoA" que nao veio do GitHub (instalador antigo, copia
rem  manual) nunca se atualiza: ela e guardada com outro nome, nada se apaga,
rem  e uma instalacao nova que se atualiza sozinha e baixada no lugar.
if exist "%DEST%\" (
  dir /b /a "%DEST%" 2>nul | findstr "^" >nul && goto :i_old_copy
)
:i_fresh_clone

call :section "2/4" "Baixando o Tarkov MoA"
call :run "Baixando do GitHub"
git %GITAUTH% clone "%REPO%" "%DEST%" >>"%LOG%" 2>&1
if errorlevel 1 goto :i_clone_failed
call :ok "Baixado"
goto :i_shortcut

:i_update
call :section "2/4" "Atualizando o Tarkov MoA"
rem  O MoA aberto fica aberto: atualizar o codigo nao mexe no .exe. A abertura
rem  so fecha ele se precisar compilar a versao nova (e abre ela no fim).
call :run "Já instalado: buscando a versão mais nova"
set "LOGINRETRY="
rem  A folder whose Git is half set up (seen: no branch ever fetched, no
rem  version checked out) is repaired first: the GitHub address and the
rem  standard "fetch every branch" rule.
git -C "%DEST%" remote get-url origin >nul 2>&1 || git -C "%DEST%" remote add origin "%REPO%" >>"%LOG%" 2>&1
rem  The program's own GitHub address (an old install may point elsewhere).
git -C "%DEST%" remote set-url origin "%REPO%" >>"%LOG%" 2>&1
git -C "%DEST%" config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*" >>"%LOG%" 2>&1
:i_update_fetch
git -C "%DEST%" %GITAUTH% fetch --prune origin > "%GLOG%" 2>&1
set "FETCHERR=%errorlevel%"
type "%GLOG%" >>"%LOG%" 2>nul
if not "%FETCHERR%"=="0" goto :i_update_fetch_failed
set "UPSTREAM="
for /f "delims=" %%U in ('git -C "%DEST%" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2^>nul') do set "UPSTREAM=%%U"
if not defined UPSTREAM git -C "%DEST%" rev-parse --verify --quiet origin/main >nul 2>&1 && set "UPSTREAM=origin/main"
if not defined UPSTREAM git -C "%DEST%" rev-parse --verify --quiet origin/master >nul 2>&1 && set "UPSTREAM=origin/master"
if not defined UPSTREAM goto :i_update_failed
set "OLDHEAD="
for /f %%H in ('git -C "%DEST%" rev-parse --verify --quiet HEAD 2^>nul') do set "OLDHEAD=%%H"
set "NEWHEAD="
for /f %%H in ('git -C "%DEST%" rev-parse "%UPSTREAM%" 2^>nul') do set "NEWHEAD=%%H"
if not defined NEWHEAD goto :i_update_failed
rem  No version in the folder at all: take GitHub's whole, over what is there.
if not defined OLDHEAD (
  call :note "A pasta não tinha uma versão do GitHub registrada: baixando a completa."
  git -C "%DEST%" symbolic-ref HEAD refs/heads/main >>"%LOG%" 2>&1
  git -C "%DEST%" reset --hard "%UPSTREAM%" >>"%LOG%" 2>&1
  git -C "%DEST%" branch --set-upstream-to="%UPSTREAM%" >>"%LOG%" 2>&1
  goto :i_update_check
)
if /i "%NEWHEAD%"=="%OLDHEAD%" (
  call :ok "Já está na versão mais nova"
  goto :i_shortcut
)
rem  Arquivos mudados na pasta (o npm costuma mexer no package-lock.json) ficam
rem  guardados num "git stash"; historico divergente fica num branch de copia.
rem  Nada se perde, e a pasta passa a seguir o GitHub.
set "DIRTY="
for /f "delims=" %%L in ('git -C "%DEST%" status --porcelain --untracked-files^=no 2^>nul') do set "DIRTY=1"
if defined DIRTY (
  git -C "%DEST%" stash push -m "Tarkov MoA: mudancas locais guardadas antes de atualizar" >>"%LOG%" 2>&1
  call :note "Arquivos mudados na pasta foram guardados (git stash)."
)
git -C "%DEST%" merge --ff-only "%UPSTREAM%" >>"%LOG%" 2>&1
if errorlevel 1 (
  set "STAMP=%DATE:/=-%_%TIME::=-%"
  call set "STAMP=%%STAMP: =0%%"
  call set "STAMP=%%STAMP:,=-%%"
  call set "STAMP=%%STAMP:.=-%%"
  call git -C "%DEST%" branch "moa-backup-%%STAMP%%" >>"%LOG%" 2>&1
  git -C "%DEST%" reset --hard "%UPSTREAM%" >>"%LOG%" 2>&1
  call :note "O histórico da pasta tinha divergido: uma cópia ficou num branch moa-backup."
)
git -C "%DEST%" branch --set-upstream-to="%UPSTREAM%" >>"%LOG%" 2>&1
:i_update_check
set "NOWHEAD="
for /f %%H in ('git -C "%DEST%" rev-parse HEAD 2^>nul') do set "NOWHEAD=%%H"
if /i not "%NOWHEAD%"=="%NEWHEAD%" goto :i_update_failed
call :ok "Atualizado para a versão mais nova"
goto :i_shortcut

rem  O fetch falhou: login vencido/de outra conta, sem acesso, ou sem internet.
:i_update_fetch_failed
call :git_error "%GLOG%"
call :net_error "%GLOG%"
if not errorlevel 1 goto :i_no_network
call :auth_error "%GLOG%"
if errorlevel 1 goto :i_update_failed
if defined LOGINRETRY goto :i_no_access
set "LOGINRETRY=1"
call :warn "O GitHub não aceitou o login salvo neste PC"
call :note "Vamos entrar de novo: vai abrir a janela de login do GitHub. Entre com a"
call :note "SUA conta, a que foi convidada para o repositório do Tarkov MoA."
(echo protocol=https& echo host=github.com) | git %GITAUTH% credential reject >>"%LOG%" 2>&1
goto :i_update_fetch

:i_no_network
call :err_head "Sem conexão com o GitHub"
call :err "Confira a internet e rode o Abrir Tarkov MoA.bat de novo."
goto :i_stop

:i_no_access
call :err_head "Esta conta do GitHub não tem acesso ao Tarkov MoA"
call :err "Peça ao dono do repositório para conferir o acesso da sua conta"
call :err "e rode o Abrir Tarkov MoA.bat de novo."
goto :i_stop

rem ---- 3. Atalho na Area de Trabalho -----------------------------------------------
:i_shortcut
if defined MOA_SO_ATUALIZAR exit /b 0
rem  MOA_TESTE (tests): no shortcut on the Desktop and no opening.
if defined MOA_TESTE goto :i_opening
call :section "3/4" "Atalho"
if not exist "%DEST%\Abrir Tarkov MoA.bat" goto :i_broken_copy
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Tarkov MoA.lnk')); $s.TargetPath = Join-Path $env:DEST 'Abrir Tarkov MoA.bat'; $s.WorkingDirectory = $env:DEST; $s.IconLocation = (Join-Path $env:DEST 'src-tauri\icons\icon.ico') + ',0'; $s.Description = 'Tarkov MoA'; $s.Save()" >>"%LOG%" 2>&1
if errorlevel 1 (
  call :warn "Não deu para criar o atalho: abra pelo Abrir Tarkov MoA.bat na pasta"
) else (
  call :ok "Atalho Tarkov MoA" "na Área de Trabalho"
)

rem ---- 4. Abrir (o abridor instala o resto e compila na primeira vez) --------------
:i_opening
call :section "4/4" "Abrindo"
call :ok "Instalação pronta"
call :note "Na primeira vez o programa instala o que falta e compila; leva alguns minutos."
timeout /t 2 >nul 2>&1
rem  A copia instalada (a mais nova, recem baixada) segue: requisitos, compilar e abrir.
if not defined MOA_TESTE call "%DEST%\Abrir Tarkov MoA.bat" --atualizado
rem  This file came from outside (Downloads, a message): its job is done, the
rem  installed copy and its shortcut take over, so it deletes itself. Not a
rem  copy in %TEMP% (its caller deletes it) nor the installed one.
if /i "%~dp0"=="%DEST%\" exit /b 0
echo "%~n0" | findstr /i /c:"TarkovMoA-instalar" /c:"TarkovMoA-abrir" >nul && exit /b 0
>>"%LOG%" echo Este arquivo se apagou: use o atalho Tarkov MoA (ou o Abrir Tarkov MoA.bat em %DEST%).
(goto) 2>nul & del "%~f0"

rem =============================================================================
rem  ABRIR
rem =============================================================================
:open
rem ---- 0. Sempre o .bat mais novo ----------------------------------------------------
rem  Antes de tudo, este arquivo busca no GitHub o .bat mais novo e passa a vez
rem  para ele: grava a versao nova numa copia em %TEMP% e roda a copia (--copia).
rem  A copia atualiza a pasta, e com isso o .bat velho daqui e trocado pelo novo
rem  (mesmo nome, entao o atalho do Menu Iniciar e o .exe continuam achando), e
rem  segue com tudo. Assim quem roda e sempre o .bat mais novo, mesmo num PC que
rem  ficou com um velho, e o cmd nunca le um arquivo que esta sendo trocado no
rem  meio. Quando a copia termina, este arquivo a apaga. Sem Git, sem internet ou
rem  sem login no GitHub, segue com este mesmo arquivo (o passo 1 diz o motivo).
set "PROJECT=%~dp0"
set "LAUNCHER_COPY="
set "FETCHED="
if /i "%~1"=="--copia" (
  set "PROJECT=%~2"
  set "LAUNCHER_COPY=%~f0"
  if /i "%~3"=="buscado" set "FETCHED=1"
)
cd /d "%PROJECT%"
set "SELF=%CD%\Abrir Tarkov MoA.bat"
if defined LAUNCHER_COPY goto :handover_done
if /i "%~1"=="--atualizado" goto :handover_done
if not exist ".git" goto :handover_done
where git >nul 2>&1
if errorlevel 1 goto :handover_done
rem  No login window here: if GitHub wants one, step 1 below asks for it.
set "GIT_TERMINAL_PROMPT=0"
set "GCM_INTERACTIVE=never"
call :fix_origin
git remote get-url origin >nul 2>&1 && git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*" >nul 2>&1
git -c credential.helper= -c credential.helper=manager fetch --quiet --prune origin >nul 2>&1
if errorlevel 1 goto :handover_skip
set "UP0="
for /f "delims=" %%U in ('git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2^>nul') do set "UP0=%%U"
if not defined UP0 git rev-parse --verify --quiet origin/main >nul 2>&1 && set "UP0=origin/main"
if not defined UP0 goto :handover_skip
set "NEWBAT=%TEMP%\TarkovMoA-abrir-%RANDOM%%RANDOM%.bat"
git cat-file --filters "%UP0%:Abrir Tarkov MoA.bat" > "%NEWBAT%" 2>nul
if errorlevel 1 goto :handover_failed
rem  Only a .bat that knows how to run as a copy takes over.
findstr /c:"--copia" "%NEWBAT%" >nul 2>&1
if errorlevel 1 goto :handover_failed
rem  One block: cmd reads it whole before running it, so nothing of this file
rem  (which the copy replaces) is read again: run the copy, delete it, leave.
(
  set "GIT_TERMINAL_PROMPT="
  set "GCM_INTERACTIVE="
  call "%NEWBAT%" --copia "%CD%" buscado
  del "%NEWBAT%" >nul 2>&1
  exit /b
)
:handover_failed
del "%NEWBAT%" >nul 2>&1
:handover_skip
set "GIT_TERMINAL_PROMPT="
set "GCM_INTERACTIVE="
:handover_done
set "EXE=src-tauri\target\release\tarkov-companion.exe"
call :ui_init
call :banner

if not exist "package.json" goto :no_project

call :refresh_path

rem ---- 1. Atualizar pelo Git ------------------------------------------------------
rem  Se esta pasta veio do GitHub (tem .git), baixa a versao mais nova antes de
rem  abrir. Tudo o que o Git responde fica em %TEMP%\TarkovMoA-atualizacao.log.
rem  Arquivos mudados aqui (o npm costuma mexer no package-lock.json) sao
rem  guardados com "git stash" antes; se o historico daqui divergiu do GitHub,
rem  uma copia fica num branch "moa-backup-..." e esta pasta segue o GitHub.
rem  Nada se perde. Rodando como copia (passo 0), a busca ja foi feita e a
rem  atualizacao troca o .bat da pasta pelo novo. Um .bat de versao antiga que
rem  traga um novo reinicia com ele (--atualizado evita repetir a busca).
call :section "1/4" "Atualização"
call :note "Pasta: %CD%"
set "NOUPDATE="
set "NOUPDATE2="
if /i "%~1"=="--atualizado" (
  call :ok "Atualizado para a versão mais nova"
  goto :updated
)
if defined LAUNCHER_COPY call :note "Rodando o .bat mais novo do GitHub"

if not exist ".git" (
  set "NOUPDATE=Esta pasta não veio do GitHub, então ela não se atualiza sozinha."
  set "NOUPDATE2=Rode o Abrir Tarkov MoA.bat de fora desta pasta (Downloads): ele instala uma que se atualiza."
  call :warn "Esta pasta não veio do GitHub"
  goto :updated
)
call :need_git
if errorlevel 1 (
  set "NOUPDATE=O Git não está instalado neste PC, e é ele que baixa a versão nova."
  set "NOUPDATE2=Instale o Git pelo site git-scm.com e abra de novo."
  call :warn "Git não instalado"
  goto :updated
)
set "GITLOG=%TEMP%\TarkovMoA-atualizacao.log"
> "%GITLOG%" echo Tarkov MoA - atualizacao - %DATE% %TIME%
set "OLDHEAD="
for /f %%H in ('git rev-parse --verify --quiet HEAD 2^>nul') do set "OLDHEAD=%%H"
call :run "Procurando novidades no GitHub"
set "LOGINRETRY="
rem  A half set-up Git (no branch ever fetched) is repaired first.
git remote get-url origin >nul 2>&1 && git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*" >>"%GITLOG%" 2>&1
:update_fetch
rem  The copy of step 0 has just fetched: no need to ask GitHub twice.
if defined FETCHED (
  set "FETCHED="
  goto :update_fetched
)
git -c credential.helper= -c credential.helper=manager fetch --prune origin >>"%GITLOG%" 2>&1
if errorlevel 1 goto :update_fetch_failed
:update_fetched
set "UPSTREAM="
for /f "delims=" %%U in ('git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2^>nul') do set "UPSTREAM=%%U"
if not defined UPSTREAM git rev-parse --verify --quiet origin/main >nul 2>&1 && set "UPSTREAM=origin/main"
if not defined UPSTREAM git rev-parse --verify --quiet origin/master >nul 2>&1 && set "UPSTREAM=origin/master"
if not defined UPSTREAM set "UPSTREAM=origin/main"
set "NEWHEAD="
for /f %%H in ('git rev-parse "%UPSTREAM%" 2^>nul') do set "NEWHEAD=%%H"
if not defined NEWHEAD goto :update_fetch_failed
if /i "%NEWHEAD%"=="%OLDHEAD%" (
  call :ok "Já está na versão mais nova"
  goto :updated
)
set "DIRTY="
for /f "delims=" %%L in ('git status --porcelain --untracked-files^=no 2^>nul') do set "DIRTY=1"
set "STAMP=%DATE:/=-%_%TIME::=-%"
set "STAMP=%STAMP: =0%"
set "STAMP=%STAMP:,=-%"
set "STAMP=%STAMP:.=-%"
rem  Tudo num bloco so: o cmd le o bloco inteiro antes de rodar, entao trocar
rem  este arquivo no meio da atualizacao nao atrapalha o que vem depois.
(
  if not defined OLDHEAD (
    rem No version in this folder at all: take GitHub's whole.
    git symbolic-ref HEAD refs/heads/main >>"%GITLOG%" 2>&1
    git reset --hard "%UPSTREAM%" >>"%GITLOG%" 2>&1
    call :note "A pasta não tinha uma versão do GitHub registrada: baixei a completa."
  ) else if defined DIRTY (
    git stash push -m "Tarkov MoA: mudancas locais guardadas antes de atualizar" >>"%GITLOG%" 2>&1
    call :note "Arquivos mudados nesta pasta foram guardados (git stash)."
  )
  if defined OLDHEAD git merge --ff-only "%UPSTREAM%" >>"%GITLOG%" 2>&1
  if errorlevel 1 if defined OLDHEAD (
    git branch "moa-backup-%STAMP%" >>"%GITLOG%" 2>&1
    git reset --hard "%UPSTREAM%" >>"%GITLOG%" 2>&1
    call :note "O histórico desta pasta tinha divergido: uma cópia ficou em moa-backup-%STAMP%."
  )
  git branch --set-upstream-to="%UPSTREAM%" >>"%GITLOG%" 2>&1
  set "MERGED="
  for /f %%H in ('git rev-parse HEAD 2^>nul') do if /i "%%H"=="%NEWHEAD%" set "MERGED=1"
  rem  As the copy of step 0, this file is not the one the update replaced: go on.
  if defined MERGED if defined LAUNCHER_COPY call :ok "Versão nova baixada" "o .bat antigo da pasta foi trocado pelo novo"
  if defined MERGED if not defined LAUNCHER_COPY (
    call :ok "Versão nova baixada" "reiniciando com ela"
    call "%~f0" --atualizado
    exit /b
  )
  if not defined MERGED set "APPLYFAIL=1"
)
if defined APPLYFAIL (
  call :git_error "%GITLOG%"
  goto :update_broken
)
goto :updated

:update_fetch_failed
rem  Diz o motivo pelo que o Git respondeu (o registro completo fica no log).
call :git_error "%GITLOG%"
call :net_error "%GITLOG%"
if not errorlevel 1 (
  set "NOUPDATE=Sem conexão com o GitHub agora."
  set "NOUPDATE2=Confira a internet e abra de novo."
  call :warn "Sem conexão com o GitHub"
  goto :updated
)
call :auth_error "%GITLOG%"
if errorlevel 1 goto :update_broken
rem  Login salvo vencido ou de outra conta: apaga e pede para entrar de novo, uma vez.
if not defined LOGINRETRY (
  set "LOGINRETRY=1"
  call :warn "O GitHub não aceitou o login salvo neste PC"
  call :note "Vai abrir a janela de login do GitHub: entre com a SUA conta,"
  call :note "a que foi convidada para o repositório do Tarkov MoA."
  (echo protocol=https& echo host=github.com) | git -c credential.helper= -c credential.helper=manager credential reject >>"%GITLOG%" 2>&1
  goto :update_fetch
)
set "NOUPDATE=O GitHub não deixou esta conta baixar o Tarkov MoA."
set "NOUPDATE2=Peça ao dono do repositório para conferir o acesso da sua conta."
call :warn "Esta conta do GitHub não tem acesso ao Tarkov MoA"
goto :updated

rem  Not the network, not GitHub: something in this folder (files held by
rem  OneDrive or an antivirus, a damaged Git folder...). The installed copy is
rem  replaced by a fresh one (the old one is kept aside, nothing is deleted;
rem  what the app remembers lives in Windows, not in this folder). A folder of
rem  one's own (not the install) only says why.
:update_broken
call :is_install_dir
if errorlevel 1 goto :update_broken_say
call :warn "A pasta do programa não se atualiza: baixando uma nova"
if defined GITERR call :note "Erro do Git: %GITERR%"
set "ICOPY=%TEMP%\TarkovMoA-instalar-%RANDOM%%RANDOM%.bat"
copy /y "%~f0" "%ICOPY%" >nul 2>&1
if errorlevel 1 goto :update_broken_say
(
  set "MOA_REPAIR=1"
  call "%ICOPY%" --instalar
  del "%ICOPY%" >nul 2>&1
  exit /b
)
:update_broken_say
set "NOUPDATE=Não deu para atualizar esta pasta."
set "NOUPDATE2=Erro do Git: %GITERR%"
call :warn "Não deu para procurar a versão nova"
:updated
if defined MOA_SO_ATUALIZAR (
  echo MOA-TESTE NOUPDATE=[%NOUPDATE%]
  exit /b 0
)

rem ---- 2. Requisitos -----------------------------------------------------------------
call :section "2/4" "Requisitos do computador"
where winget >nul 2>&1
if errorlevel 1 set "NO_WINGET=1"

rem ---- Node.js -----------------------------------------------------------------
:check_node
where node >nul 2>&1
if errorlevel 1 goto :install_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)" >nul 2>&1
if errorlevel 1 goto :upgrade_node
set "NODEV="
for /f %%v in ('node -v 2^>nul') do set "NODEV=%%v"
call :ok "Node.js" "%NODEV%"
goto :check_rust

:install_node
call :run "Node.js não encontrado: instalando o Node.js LTS"
call :winget_install OpenJS.NodeJS.LTS || goto :fail
call :refresh_path
where node >nul 2>&1
if errorlevel 1 goto :restart_needed
call :ok "Node.js instalado"
goto :check_rust

:upgrade_node
call :run "Node.js muito antigo: atualizando para o LTS"
call :winget_install OpenJS.NodeJS.LTS upgrade || goto :fail
call :refresh_path
call :ok "Node.js atualizado"

rem ---- Rust --------------------------------------------------------------------
:check_rust
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where rustup >nul 2>&1
if errorlevel 1 goto :install_rust
cargo -V >nul 2>&1
if errorlevel 1 goto :rust_toolchain
set "RUSTV="
for /f "tokens=2" %%v in ('rustc --version 2^>nul') do set "RUSTV=%%v"
call :ok "Rust" "%RUSTV%"
goto :check_msvc

:install_rust
call :run "Rust não encontrado: instalando o rustup"
call :winget_install Rustlang.Rustup || goto :fail
call :refresh_path
if exist "%USERPROFILE%\.cargo\bin\rustup.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where rustup >nul 2>&1
if errorlevel 1 goto :restart_needed

:rust_toolchain
call :run "Preparando o compilador Rust (stable-msvc)"
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal || goto :fail
rustup default stable-x86_64-pc-windows-msvc || goto :fail
call :ok "Rust pronto"

rem ---- Visual Studio Build Tools (MSVC) ----------------------------------------
:check_msvc
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto :install_msvc
set "VSPATH="
for /f "usebackq delims=" %%I in (`"%VSWHERE%" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%I"
if not defined VSPATH goto :install_msvc
call :ok "Compilador C++" "Visual Studio Build Tools"
goto :check_webview

:install_msvc
call :run "Compilador C++ não encontrado: instalando o Visual Studio Build Tools"
call :note "Baixa alguns GB e leva vários minutos. O Windows vai pedir permissão."
call :winget_install Microsoft.VisualStudio.2022.BuildTools msvc || goto :fail
call :ok "Visual Studio Build Tools instalado"

rem ---- WebView2 ----------------------------------------------------------------
:check_webview
call :has_webview
if not errorlevel 1 goto :webview_ok
call :run "WebView2 não encontrado: instalando"
call :winget_install Microsoft.EdgeWebView2Runtime || goto :fail
:webview_ok
call :ok "WebView2" "motor da janela"


rem ---- 3. Compilar so quando precisa ----------------------------------------------
rem  A versao final (release) abre sem terminal. Ela e compilada na primeira vez
rem  e de novo so quando algum arquivo do projeto ficar mais novo que ela.
call :section "3/4" "Preparando o programa"
set "EXE=src-tauri\target\release\tarkov-companion.exe"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$exe = Get-Item -LiteralPath '%EXE%' -ErrorAction SilentlyContinue; if (-not $exe) { exit 1 }; $t = $exe.LastWriteTimeUtc; $dirs = 'src','src-tauri\src','src-tauri\capabilities','src-tauri\icons','public','data\snapshot'; $files = 'package.json','package-lock.json','index.html','vite.config.ts','src-tauri\Cargo.toml','src-tauri\Cargo.lock','src-tauri\tauri.conf.json','scripts\tarkovtracker-key.ps1','scripts\party-firewall.ps1'; $all = @(Get-ChildItem -LiteralPath $dirs -Recurse -File -ErrorAction SilentlyContinue) + @(Get-Item -LiteralPath $files -ErrorAction SilentlyContinue); if ($all | Where-Object { $_.LastWriteTimeUtc -gt $t } | Select-Object -First 1) { exit 1 }; exit 0"
if not errorlevel 1 (
  call :ok "Já compilado" "nada mudou desde a última vez"
  tasklist /fi "imagename eq tarkov-companion.exe" 2>nul | find /i "tarkov-companion.exe" >nul
  if not errorlevel 1 goto :already_open
  goto :launch
)

rem  Precisa recompilar e o MoA esta aberto: ele segura o .exe, entao fecha
rem  (o que voce marcou ja esta salvo) e abre a versao nova no fim.
call :close_moa "%CD%" "Fechando o MoA aberto para instalar a versão nova"
rem  The old version goes before the new one is built: nothing (a shortcut or a
rem  pinned icon that opens the .exe directly) can open it any more.
if exist "%EXE%" del /f /q "%EXE%" >nul 2>&1

call :run "Baixando e conferindo as dependências (npm)"
echo %DIM%
call npm install --no-audit --no-fund
set "NPMERR=%errorlevel%"
echo %R%
if not "%NPMERR%"=="0" goto :npm_failed
if exist ".git" git checkout -- package-lock.json >nul 2>&1
call :ok "Dependências prontas"
call :run "Compilando o Tarkov MoA"
call :note "Na primeira vez leva alguns minutos; depois só recompila quando o código mudar."
echo %DIM%
rem  RC is the path of the resource compiler to Rust (RC.EXE): a leftover RC
rem  that is not a file (a .bat that kept a result in it) fails the build with
rem  "Are you sure you have RC.EXE in your $PATH". Rust finds it by itself.
if defined RC if not exist "%RC%" set "RC="
call npx tauri build --no-bundle
set "BUILDERR=%errorlevel%"
echo %R%
if not "%BUILDERR%"=="0" goto :build_failed
if not exist "%EXE%" goto :build_failed
call :ok "Compilado"

rem ---- 4. Abrir (sem terminal) ----------------------------------------------------
:launch
rem  A atualizacao nao aconteceu: a janela fica aberta com o motivo (antes ela
rem  fechava em 2 s e ninguem via o aviso).
if defined NOUPDATE (
  call :err_head "O Tarkov MoA NÃO foi atualizado"
  call :err "%NOUPDATE%"
  call :err "%NOUPDATE2%"
  call :err "Pasta: %CD%"
  echo   %ERRC%┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%R%
  echo.
  if not defined MOA_NO_WAIT set /p "ANS=  %ACC%›%R%  Aperte Enter para abrir a versão que está instalada: "
)
call :section "4/4" "Abrindo"
call :ok "Tudo pronto"
call :start_menu
rem  O .exe aberto por aqui nao confere o GitHub de novo (acabou de conferir).
set "MOA_FROM_LAUNCHER=1"
start "" "%EXE%"
echo.
echo     %ACC%%B%▶  Boa caçada, operador.%R%
echo.
timeout /t 2 >nul
exit /b 0

:already_open
echo.
call :ok "O Tarkov MoA já está aberto" "é só olhar a barra de tarefas"
if exist "%EXE%" call :start_menu
echo.
timeout /t 3 >nul
exit /b 0

rem =============================================================================
rem  Visual
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
echo   %DIM%mapa ao vivo  ·  missões  ·  extrações  ·  party  ·  mesa de armas%R%
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

rem  :winget_install <id> [upgrade|msvc]
:winget_install
if defined NO_WINGET goto :no_winget
if /i "%~2"=="upgrade" (
  winget upgrade -e --id %~1 --silent --accept-package-agreements --accept-source-agreements
  exit /b 0
)
if /i "%~2"=="msvc" (
  winget install -e --id %~1 --accept-package-agreements --accept-source-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  exit /b %errorlevel%
)
winget install -e --id %~1 --silent --accept-package-agreements --accept-source-agreements
exit /b %errorlevel%

rem  :need_git - o Git no PATH, instalando pelo winget se faltar.
rem  errorlevel 0 = pronto, 1 = nao instalou, 2 = sem winget.
:need_git
where git >nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>&1
if not errorlevel 1 exit /b 0
call :run "Git não encontrado: instalando o Git para Windows"
call :note "Pode pedir permissão do Windows."
where winget >nul 2>&1
if errorlevel 1 exit /b 2
winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements >>"%LOG%" 2>&1
call :refresh_path
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

rem  :git_error "<log>" - the last "fatal:" / "error:" line Git wrote, in GITERR.
:git_error
set "GITERR="
for /f "usebackq delims=" %%L in (`findstr /i /c:"fatal:" /c:"error:" "%~1" 2^>nul`) do set "GITERR=%%L"
if not defined GITERR set "GITERR=sem mensagem (veja %~1)"
>>"%LOG%" echo Erro do Git: %GITERR%
exit /b 0

rem  :net_error "<log>" - errorlevel 0 when the Internet or GitHub could not be reached.
:net_error
findstr /i /c:"Could not resolve host" /c:"timed out" /c:"Failed to connect" /c:"Could not connect" /c:"Connection was reset" /c:"Connection reset" "%~1" >nul 2>&1
exit /b %errorlevel%

rem  :auth_error "<log>" - errorlevel 0 when GitHub refused the login. Only
rem  GitHub's own words: "Permission denied" on a file is the folder, not GitHub.
:auth_error
findstr /i /c:"Authentication failed" /c:"Repository not found" /c:"could not read Username" /c:"returned error: 403" /c:"returned error: 401" /c:"terminal prompts disabled" "%~1" >nul 2>&1
exit /b %errorlevel%

rem  :fix_origin - an old install whose GitHub address is not the program's
rem  own (a renamed repository, an old link) points at it again.
:fix_origin
set "ORIGIN="
for /f "delims=" %%O in ('git remote get-url origin 2^>nul') do set "ORIGIN=%%O"
if not defined ORIGIN exit /b 0
if /i "%ORIGIN%"=="%REPO%" exit /b 0
echo %ORIGIN% | findstr /i /c:"github.com/3nzog/MOA-TARKOV" >nul && exit /b 0
call :is_install_dir
if errorlevel 1 exit /b 0
git remote set-url origin "%REPO%" >nul 2>&1
exit /b 0

rem  :is_install_dir - errorlevel 0 when this is the installed copy
rem  (Documentos\Tarkov MoA), not someone's own folder of the code.
:is_install_dir
set "IDIR="
if defined MOA_DEST set "IDIR=%MOA_DEST%"
if not defined IDIR for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "IDIR=%%D\Tarkov MoA"
if /i "%CD%"=="%IDIR%" exit /b 0
exit /b 1

rem  :close_moa "<folder>" "<message>" - closes the Tarkov MoA that runs from
rem  that folder (and only that one: another install, or the player's own
rem  build, stays open), so its files can be replaced.
:close_moa
set "KILLDIR=%~1"
powershell -NoProfile -Command "$d = $env:KILLDIR.TrimEnd('\') + '\'; $p = @(Get-Process tarkov-companion -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) }); if ($p.Count -eq 0) { exit 1 }; exit 0" >nul 2>&1
if errorlevel 1 exit /b 0
call :run "%~2"
powershell -NoProfile -Command "$d = $env:KILLDIR.TrimEnd('\') + '\'; $p = @(Get-Process tarkov-companion -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) }); foreach ($x in $p) { [void]$x.CloseMainWindow() }; Start-Sleep -Seconds 4; foreach ($x in $p) { if (-not $x.HasExited) { $x.Kill() } }" >>"%LOG%" 2>&1
exit /b 0

rem  Recarrega o PATH do registro, para enxergar o que acabou de ser instalado.
:refresh_path
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

rem  Atalho no Menu Iniciar, para achar o MoA pela pesquisa do Windows. Ele
rem  abre por este arquivo, que busca a versao nova antes (2-3 s quando nao ha
rem  nada novo). Antes ele abria o .exe direto e o MoA nunca se atualizava por
rem  ali; o atalho "Atualizar Tarkov MoA" daquela versao e removido.
:start_menu
set "MOA_EXE=%CD%\%EXE%"
set "MOA_BAT=%SELF%"
set "MOA_DIR=%CD%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = [Environment]::GetFolderPath('Programs'); $w = New-Object -ComObject WScript.Shell; $a = $w.CreateShortcut((Join-Path $p 'Tarkov MoA.lnk')); $a.TargetPath = $env:MOA_BAT; $a.WorkingDirectory = $env:MOA_DIR; $a.IconLocation = $env:MOA_EXE + ',0'; $a.Description = 'Tarkov MoA (busca a versao nova e abre)'; $a.Save(); Remove-Item -LiteralPath (Join-Path $p 'Atualizar Tarkov MoA.lnk') -ErrorAction SilentlyContinue" >nul 2>&1
if errorlevel 1 (
  call :warn "Não deu para criar os atalhos no Menu Iniciar"
) else (
  call :ok "Atalhos no Menu Iniciar" "pesquise Tarkov MoA no Windows"
)
exit /b 0

rem  errorlevel 0 = WebView2 instalado
:has_webview
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>&1 && exit /b 0
reg query "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>&1 && exit /b 0
reg query "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>&1 && exit /b 0
exit /b 1

rem =============================================================================
rem  Erros
rem =============================================================================
:no_project
call :err_head "Pasta errada"
call :err "Este arquivo precisa ficar na pasta do projeto (junto do package.json)."
goto :end_pause

:no_winget
call :err_head "O winget não está disponível neste Windows"
call :err "Sem ele não dá para instalar os requisitos sozinho. Instale o"
call :err "Instalador de Aplicativo (App Installer) pela Microsoft Store"
call :err "e rode este arquivo de novo."
goto :end_pause

:restart_needed
call :err_head "Falta só reabrir"
call :err "A instalação terminou, mas este terminal ainda não enxerga o programa novo."
call :err "Feche esta janela e abra o arquivo de novo."
goto :end_pause

:fail
call :err_head "Não deu para instalar um dos requisitos"
call :err "Veja a mensagem acima, resolva e rode este arquivo de novo."
goto :end_pause

:npm_failed
call :err_head "O npm não conseguiu baixar as dependências"
call :err "Confira a internet e tente de novo."
goto :end_pause

:build_failed
call :err_head "A compilação falhou"
call :err "A mensagem do compilador está logo acima."
goto :end_pause

:end_pause
rem  Fica aberta ate digitar SAIR: um Enter sem querer nao some com a mensagem.
call :err "Role para cima para ler tudo, ou tire um print desta janela para"
call :err "quem for te ajudar."
echo   %ERRC%┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%R%
:end_wait
if defined MOA_NO_WAIT exit /b 1
echo.
set "ANS="
set /p "ANS=  %ACC%›%R%  Digite %B%SAIR%R% e aperte Enter para fechar: "
if /i not "%ANS%"=="SAIR" goto :end_wait
exit /b 1

rem =============================================================================
rem  Erros da instalacao: cada um explica o que fazer e para em :i_stop (o log
rem  abre no Bloco de Notas).
rem =============================================================================
:i_no_winget
call :err_head "O winget não está disponível neste Windows"
call :err "Instale o Instalador de Aplicativo (App Installer) pela Microsoft Store,"
call :err "ou o Git pelo site git-scm.com, e rode o Abrir Tarkov MoA.bat de novo."
goto :i_stop

:i_git_missing
call :err_head "O Git não foi instalado"
call :err "Ou este terminal ainda não enxerga ele. Feche esta janela e abra o"
call :err "Abrir Tarkov MoA.bat de novo. Se continuar, instale o Git pelo site"
call :err "git-scm.com e rode outra vez."
goto :i_stop

:i_old_copy
set "OLDDEST=%DEST% (antiga)"
if exist "%OLDDEST%" set "OLDDEST=%DEST% (antiga %RANDOM%)"
call :close_moa "%DEST%" "Fechando o Tarkov MoA desta pasta"
move "%DEST%" "%OLDDEST%" >>"%LOG%" 2>&1
if errorlevel 1 goto :i_dest_busy
call :warn "A pasta antiga não se atualizava sozinha"
call :note "Ela foi guardada como: %OLDDEST%"
call :note "(pode apagar depois que a nova estiver funcionando)"
goto :i_fresh_clone

:i_dest_busy
call :err_head "Já existe uma pasta com outros arquivos"
call :err "%DEST%"
call :err "não é do GitHub e não deu para renomear (algum arquivo dela está aberto)."
call :err "Feche o que estiver usando essa pasta, ou renomeie ela, e rode de novo."
goto :i_stop

:i_clone_failed
call :err_head "Não deu para baixar do GitHub"
call :err "As causas mais comuns:"
call :err " · a sua conta do GitHub ainda não foi convidada para o repositório, ou o"
call :err "   convite não foi aceito (veja o e-mail do GitHub ou github.com/notifications);"
call :err " · o login do GitHub foi cancelado ou feito com outra conta;"
call :err " · sem internet."
call :err "A resposta do GitHub está no log."
if exist "%DEST%\" rd "%DEST%" 2>nul
goto :i_stop

:i_close_app_first
call :err_head "Feche o Tarkov MoA antes de atualizar"
call :err "Depois rode o Abrir Tarkov MoA.bat de novo."
goto :i_stop

:i_update_failed
if not defined REPAIRED (
  set "REPAIRED=1"
  call :warn "A pasta instalada não se atualiza: guardando ela e baixando uma nova"
  goto :i_old_copy_note
)
call :err_head "Não deu para atualizar"
call :err "Nem uma cópia nova deu certo. Erro do Git:"
call :err "%GITERR%"
goto :i_stop
:i_old_copy_note
if defined GITERR call :note "Erro do Git: %GITERR%"
goto :i_old_copy

:i_broken_copy
call :err_head "A cópia parece incompleta"
call :err "A pasta %DEST% não tem o Abrir Tarkov MoA.bat."
call :err "Mova essa pasta para outro lugar e rode o Abrir Tarkov MoA.bat de novo."
goto :i_stop

rem  Mostra onde esta o log, abre no Bloco de Notas e so fecha digitando SAIR.
:i_stop
echo   %ERRC%┃%R%
echo   %ERRC%┃%R%  %DIM%Tudo o que aconteceu está anotado em:%R%
echo   %ERRC%┃%R%  %TXT%%LOG%%R%
echo   %ERRC%┃%R%  %DIM%(abriu no Bloco de Notas: mande ele para quem for te ajudar)%R%
echo   %ERRC%┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%R%
start "" notepad "%LOG%"
:i_stop_wait
if defined MOA_NO_WAIT exit /b 1
echo.
set "ANS="
set /p "ANS=  %ACC%›%R%  Digite %B%SAIR%R% e aperte Enter para fechar: "
if /i not "%ANS%"=="SAIR" goto :i_stop_wait
exit /b 1
