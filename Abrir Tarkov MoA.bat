@echo off
rem ============================================================================
rem  Tarkov MoA - abre o programa e instala o que faltar.
rem
rem  Na primeira vez, instala (pelo winget, das fontes oficiais) o que nao
rem  estiver no PC:
rem    - Node.js LTS                 (roda a interface)
rem    - Rust (rustup)               (compila o nucleo do app)
rem    - Visual Studio Build Tools   (compilador C++ que o Rust usa no Windows)
rem    - WebView2 Runtime            (motor da janela; ja vem no Windows 11)
rem  Antes de abrir, busca a versao mais nova no GitHub (git pull). Depois baixa
rem  as dependencias (npm), compila a versao final uma vez e abre o MoA sem
rem  deixar terminal aberto. Nas proximas vezes so confere e abre; recompila
rem  sozinho quando o codigo do projeto mudar.
rem
rem  Visual: o arquivo e UTF-8 (chcp 65001) e usa as cores do terminal do
rem  Windows 10/11 (sequencias ANSI).
rem ============================================================================
setlocal EnableExtensions
chcp 65001 >nul
title Tarkov MoA
cd /d "%~dp0"
set "SELF=%~f0"
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
rem  Nada se perde. Se a atualizacao trouxer um .bat novo, este arquivo
rem  reinicia com ele (--atualizado evita repetir a busca).
call :section "1/4" "Atualização"
if /i "%~1"=="--atualizado" (
  call :ok "Atualizado para a versão mais nova"
  goto :updated
)
if not exist ".git" (
  call :note "Esta pasta não veio do GitHub: abrindo a versão que está aqui."
  goto :updated
)
where git >nul 2>&1
if errorlevel 1 (
  call :note "Git não instalado: abrindo a versão que está aqui."
  goto :updated
)
set "GITLOG=%TEMP%\TarkovMoA-atualizacao.log"
> "%GITLOG%" echo Tarkov MoA - atualizacao - %DATE% %TIME%
set "OLDHEAD="
for /f %%H in ('git rev-parse HEAD 2^>nul') do set "OLDHEAD=%%H"
call :run "Procurando novidades no GitHub"
git -c credential.helper= -c credential.helper=manager fetch --prune origin >>"%GITLOG%" 2>&1
if errorlevel 1 goto :update_fetch_failed
set "UPSTREAM="
for /f "delims=" %%U in ('git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2^>nul') do set "UPSTREAM=%%U"
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
  if defined DIRTY (
    git stash push -m "Tarkov MoA: mudancas locais guardadas antes de atualizar" >>"%GITLOG%" 2>&1
    call :note "Arquivos mudados nesta pasta foram guardados (git stash)."
  )
  git merge --ff-only "%UPSTREAM%" >>"%GITLOG%" 2>&1
  if errorlevel 1 (
    git branch "moa-backup-%STAMP%" >>"%GITLOG%" 2>&1
    git reset --hard "%UPSTREAM%" >>"%GITLOG%" 2>&1
    call :note "O histórico desta pasta tinha divergido: uma cópia ficou em moa-backup-%STAMP%."
  )
  for /f %%H in ('git rev-parse HEAD 2^>nul') do (
    if /i "%%H"=="%NEWHEAD%" (
      call :ok "Versão nova baixada" "reiniciando com ela"
      call "%~f0" --atualizado
      exit /b
    )
  )
  call :warn "Não deu para aplicar a versão nova"
  call :note "Detalhes em %GITLOG%. Abrindo a versão que já está instalada."
)
goto :updated

:update_fetch_failed
rem  Diz o motivo pelo que o Git respondeu (o registro completo fica no log).
findstr /i /c:"Authentication failed" /c:"Repository not found" /c:"could not read Username" /c:"403" /c:"denied" "%GITLOG%" >nul 2>&1
if not errorlevel 1 (
  call :warn "O GitHub não aceitou a conta deste PC para baixar o Tarkov MoA"
  call :note "O repositório é privado: entre com a conta do GitHub que tem acesso"
  call :note "quando a janela de login abrir, ou peça acesso ao dono do repositório."
  goto :update_fallback
)
findstr /i /c:"Could not resolve host" /c:"unable to access" /c:"timed out" /c:"Failed to connect" "%GITLOG%" >nul 2>&1
if not errorlevel 1 (
  call :warn "Sem conexão com o GitHub agora"
  goto :update_fallback
)
call :warn "Não deu para procurar a versão nova"
:update_fallback
call :note "Detalhes em %GITLOG%."
call :note "Abrindo a versão que já está instalada."
:updated
if defined MOA_SO_ATUALIZAR exit /b 0

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
powershell -NoProfile -ExecutionPolicy Bypass -Command "$exe = Get-Item -LiteralPath '%EXE%' -ErrorAction SilentlyContinue; if (-not $exe) { exit 1 }; $t = $exe.LastWriteTimeUtc; $dirs = 'src','src-tauri\src','src-tauri\capabilities','src-tauri\icons','public','data\snapshot'; $files = 'package.json','package-lock.json','index.html','vite.config.ts','src-tauri\Cargo.toml','src-tauri\Cargo.lock','src-tauri\tauri.conf.json','scripts\tarkovtracker-key.ps1'; $all = @(Get-ChildItem -LiteralPath $dirs -Recurse -File -ErrorAction SilentlyContinue) + @(Get-Item -LiteralPath $files -ErrorAction SilentlyContinue); if ($all | Where-Object { $_.LastWriteTimeUtc -gt $t } | Select-Object -First 1) { exit 1 }; exit 0"
if not errorlevel 1 (
  call :ok "Já compilado" "nada mudou desde a última vez"
  tasklist /fi "imagename eq tarkov-companion.exe" 2>nul | find /i "tarkov-companion.exe" >nul
  if not errorlevel 1 goto :already_open
  goto :launch
)

rem  Precisa recompilar e o MoA esta aberto: ele segura o .exe, entao fecha
rem  (o que voce marcou ja esta salvo) e abre a versao nova no fim.
tasklist /fi "imagename eq tarkov-companion.exe" 2>nul | find /i "tarkov-companion.exe" >nul
if not errorlevel 1 (
  call :run "Fechando o MoA aberto para instalar a versão nova"
  taskkill /im tarkov-companion.exe >nul 2>&1
  timeout /t 4 >nul
  taskkill /f /im tarkov-companion.exe >nul 2>&1
)

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
call npx tauri build --no-bundle
set "BUILDERR=%errorlevel%"
echo %R%
if not "%BUILDERR%"=="0" goto :build_failed
if not exist "%EXE%" goto :build_failed
call :ok "Compilado"

rem ---- 4. Abrir (sem terminal) ----------------------------------------------------
:launch
call :section "4/4" "Abrindo"
call :ok "Tudo pronto"
call :start_menu
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
exit /b 0

:run
echo     %RUNC%●%R%  %TXT%%~1%R%%DIM%...%R%
exit /b 0

:warn
echo     %WARNC%▲%R%  %TXT%%~1%R%
exit /b 0

:note
echo        %DIM%%~1%R%
exit /b 0

rem  :err "linha" - uma linha dentro do quadro de erro
:err
echo   %ERRC%┃%R%  %TXT%%~1%R%
exit /b 0

:err_head
echo.
echo   %ERRC%┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%R%
echo   %ERRC%┃%R%  %ERRC%%B%✖  %~1%R%
echo   %ERRC%┃%R%
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
