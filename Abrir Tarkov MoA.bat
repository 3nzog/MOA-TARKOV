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
rem  Depois baixa as dependencias (npm), compila a versao final uma vez e abre
rem  o MoA sem deixar terminal aberto. Nas proximas vezes so confere e abre;
rem  recompila sozinho quando o codigo do projeto mudar.
rem ============================================================================
setlocal EnableExtensions
title Tarkov MoA
cd /d "%~dp0"

echo.
echo  ===  Tarkov MoA  ===
echo.

if not exist "package.json" goto :no_project

call :refresh_path

rem ---- Atualizar pelo Git ---------------------------------------------------------
rem  Se esta pasta veio do GitHub (tem .git), baixa a versao mais nova antes de
rem  abrir. Sem internet, sem Git ou com mudancas locais que conflitam, segue com
rem  a versao que ja esta aqui. Se a atualizacao trouxer um .bat novo, este
rem  arquivo reinicia com ele (--atualizado evita repetir a busca).
if /i "%~1"=="--atualizado" goto :updated
if not exist ".git" goto :updated
where git >nul 2>&1
if errorlevel 1 goto :updated
set "OLDHEAD="
for /f %%H in ('git rev-parse HEAD 2^>nul') do set "OLDHEAD=%%H"
echo  [..] Procurando atualizacao no GitHub...
rem  Tudo num bloco so: o cmd le o bloco inteiro antes de rodar, entao trocar
rem  este arquivo no meio do git pull nao atrapalha o que vem depois.
(
  git -c credential.helper= -c credential.helper=manager pull --ff-only --quiet >nul 2>&1
  if errorlevel 1 (
    echo  [!!] Nao deu para atualizar agora - sem internet, ou arquivos mudados aqui.
    echo       Abrindo a versao que ja esta instalada.
  ) else (
    for /f %%H in ('git rev-parse HEAD 2^>nul') do (
      if /i not "%%H"=="%OLDHEAD%" (
        echo  [ok] Atualizado para a versao mais nova.
        call "%~f0" --atualizado
        exit /b
      )
    )
    echo  [ok] Ja esta na versao mais nova.
  )
)
:updated

rem ---- winget ------------------------------------------------------------------
where winget >nul 2>&1
if errorlevel 1 set "NO_WINGET=1"

rem ---- Node.js -----------------------------------------------------------------
:check_node
where node >nul 2>&1
if errorlevel 1 goto :install_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)" >nul 2>&1
if errorlevel 1 goto :upgrade_node
echo  [ok] Node.js
goto :check_rust

:install_node
echo  [..] Node.js nao encontrado. Instalando o Node.js LTS...
call :winget_install OpenJS.NodeJS.LTS || goto :fail
call :refresh_path
where node >nul 2>&1
if errorlevel 1 goto :restart_needed
echo  [ok] Node.js instalado
goto :check_rust

:upgrade_node
echo  [..] Node.js muito antigo para este projeto. Atualizando para o LTS...
call :winget_install OpenJS.NodeJS.LTS upgrade || goto :fail
call :refresh_path
echo  [ok] Node.js atualizado

rem ---- Rust --------------------------------------------------------------------
:check_rust
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where rustup >nul 2>&1
if errorlevel 1 goto :install_rust
cargo -V >nul 2>&1
if errorlevel 1 goto :rust_toolchain
echo  [ok] Rust
goto :check_msvc

:install_rust
echo  [..] Rust nao encontrado. Instalando o rustup...
call :winget_install Rustlang.Rustup || goto :fail
call :refresh_path
if exist "%USERPROFILE%\.cargo\bin\rustup.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where rustup >nul 2>&1
if errorlevel 1 goto :restart_needed

:rust_toolchain
echo  [..] Preparando o compilador Rust (stable-msvc)...
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal || goto :fail
rustup default stable-x86_64-pc-windows-msvc || goto :fail
echo  [ok] Rust pronto

rem ---- Visual Studio Build Tools (MSVC) ----------------------------------------
:check_msvc
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto :install_msvc
set "VSPATH="
for /f "usebackq delims=" %%I in (`"%VSWHERE%" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%I"
if not defined VSPATH goto :install_msvc
echo  [ok] Compilador C++ (Visual Studio Build Tools)
goto :check_webview

:install_msvc
echo  [..] Compilador C++ nao encontrado. Instalando o Visual Studio Build Tools...
echo       Isso baixa alguns GB e pode levar varios minutos. O Windows vai pedir
echo       permissao de administrador.
call :winget_install Microsoft.VisualStudio.2022.BuildTools msvc || goto :fail
echo  [ok] Visual Studio Build Tools instalado

rem ---- WebView2 ----------------------------------------------------------------
:check_webview
call :has_webview
if not errorlevel 1 goto :webview_ok
echo  [..] WebView2 nao encontrado. Instalando...
call :winget_install Microsoft.EdgeWebView2Runtime || goto :fail
:webview_ok
echo  [ok] WebView2

rem ---- App ja aberto? ---------------------------------------------------------
tasklist /fi "imagename eq tarkov-companion.exe" 2>nul | find /i "tarkov-companion.exe" >nul
if not errorlevel 1 goto :already_open

rem ---- Compilar so quando precisa ----------------------------------------------
rem  A versao final (release) abre sem terminal. Ela e compilada na primeira vez
rem  e de novo so quando algum arquivo do projeto ficar mais novo que ela.
set "EXE=src-tauri\target\release\tarkov-companion.exe"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$exe = Get-Item -LiteralPath '%EXE%' -ErrorAction SilentlyContinue; if (-not $exe) { exit 1 }; $t = $exe.LastWriteTimeUtc; $dirs = 'src','src-tauri\src','src-tauri\capabilities','src-tauri\icons','public','data\snapshot'; $files = 'package.json','package-lock.json','index.html','vite.config.ts','src-tauri\Cargo.toml','src-tauri\Cargo.lock','src-tauri\tauri.conf.json','scripts\tarkovtracker-key.ps1'; $all = @(Get-ChildItem -LiteralPath $dirs -Recurse -File -ErrorAction SilentlyContinue) + @(Get-Item -LiteralPath $files -ErrorAction SilentlyContinue); if ($all | Where-Object { $_.LastWriteTimeUtc -gt $t } | Select-Object -First 1) { exit 1 }; exit 0"
if not errorlevel 1 goto :launch

echo.
echo  [..] Baixando/conferindo as dependencias do projeto (npm)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :npm_failed
echo  [ok] Dependencias prontas
echo.
echo  [..] Compilando o Tarkov MoA. Na primeira vez leva alguns minutos;
echo       depois so recompila quando o codigo mudar.
echo.
call npx tauri build --no-bundle
if errorlevel 1 goto :build_failed
if not exist "%EXE%" goto :build_failed

rem ---- Abrir (sem terminal) ----------------------------------------------------
:launch
start "" "%EXE%"
exit /b 0

:already_open
echo  O Tarkov MoA ja esta aberto.
timeout /t 2 >nul
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
echo  Este arquivo precisa ficar na pasta do projeto (junto do package.json).
goto :end_pause

:no_winget
echo.
echo  O winget nao esta disponivel neste Windows, entao nao da para instalar
echo  sozinho. Instale o "Instalador de Aplicativo" (App Installer) pela
echo  Microsoft Store e rode este arquivo de novo.
goto :end_pause

:restart_needed
echo.
echo  A instalacao terminou, mas este terminal ainda nao enxerga o programa novo.
echo  Feche esta janela e abra o arquivo de novo.
goto :end_pause

:fail
echo.
echo  Nao deu para instalar um dos requisitos. Veja a mensagem acima, resolva e
echo  rode este arquivo de novo.
goto :end_pause

:npm_failed
echo.
echo  O npm nao conseguiu baixar as dependencias. Confira a internet e tente de novo.
goto :end_pause

:build_failed
echo.
echo  A compilacao falhou. Veja a mensagem acima.
goto :end_pause

:end_pause
rem  Fica aberta ate digitar SAIR: um Enter sem querer nao some com a mensagem.
echo.
echo  ------------------------------------------------------------------
echo   Algo deu errado: leia a mensagem acima (role para cima se precisar)
echo   ou tire um print desta janela para quem te ajudar.
echo  ------------------------------------------------------------------
:end_wait
if defined MOA_NO_WAIT exit /b 1
echo.
set "ANS="
set /p "ANS=  Digite SAIR e aperte Enter para fechar: "
if /i not "%ANS%"=="SAIR" goto :end_wait
exit /b 1
