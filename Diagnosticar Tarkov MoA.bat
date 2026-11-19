@echo off
rem ============================================================================
rem  Tarkov MoA - DIAGNOSTICO E CONSERTO.
rem
rem  Para mandar a quem tem o Tarkov MoA com problema (nao atualiza, abre a
rem  versao antiga, da erro do Git). Rode de qualquer lugar (Downloads, uma
rem  mensagem). Ele:
rem    - confere tudo o que o MoA precisa neste PC e diz o que esta errado;
rem    - conserta o que der: a pasta do programa (Git, travas, endereco do
rem      GitHub, pasta que nao atualiza: guardada de lado e baixada de novo),
rem      atualiza para a versao mais nova, apaga o .exe antigo, desinstala o
rem      MoA antigo de instalador (com o atualizador dele), faz os atalhos
rem      abrirem pelo Abrir Tarkov MoA.bat, libera o firewall (o Windows pede
rem      permissao) e corrige o "iniciar com o Windows";
rem    - salva um relatorio na Area de Trabalho e abre no Bloco de Notas;
rem    - abre o Tarkov MoA pelo jeito certo (compila na primeira vez) e se apaga.
rem
rem  Nao guarda senha nem token, nao mexe no jogo (so olha onde ele guarda os
rem  logs e os prints) e nao apaga o que o MoA lembra (progresso, configuracoes).
rem  O diagnostico em si e o texto em PowerShell no fim deste arquivo.
rem ============================================================================
setlocal EnableExtensions
chcp 65001 >nul
title Tarkov MoA - diagnostico e conserto
set "MOA_DIAG_FILE=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = [IO.File]::ReadAllText($env:MOA_DIAG_FILE, [Text.Encoding]::UTF8); $m = '##' + 'POWERSHELL' + '##'; $i = $t.LastIndexOf($m); if ($i -lt 0) { exit 1 }; Invoke-Expression $t.Substring($i + $m.Length)"
set "DIAG_RC=%errorlevel%"

set "DEST=%MOA_DEST%"
if not defined DEST for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "DEST=%%D\Tarkov MoA"

if "%DIAG_RC%"=="0" goto :open
if "%DIAG_RC%"=="2" goto :problems
echo.
echo   O Tarkov MoA nao ficou instalado: veja o relatorio (o motivo esta nele),
echo   resolva e rode este arquivo de novo.
if defined MOA_NO_WAIT exit /b 1
:wait_exit
set "ANS="
set /p "ANS=  Digite SAIR e aperte Enter para fechar: "
if /i not "%ANS%"=="SAIR" goto :wait_exit
exit /b 1

:problems
echo.
echo   Sobrou algum problema (esta no relatorio). O Tarkov MoA abre mesmo assim.
if not defined MOA_NO_WAIT set /p "ANS=  Aperte Enter para continuar: "

:open
echo.
echo   Abrindo o Tarkov MoA pelo jeito certo (na primeira vez ele compila: alguns minutos)...
timeout /t 3 >nul 2>&1
if not defined MOA_TESTE call "%DEST%\Abrir Tarkov MoA.bat" --atualizado
rem  Feito: este arquivo se apaga (dai em diante, o atalho Tarkov MoA). Fica
rem  se estiver dentro da pasta do programa.
if /i "%~dp0"=="%DEST%\" exit /b 0
rem  Nor in a copy of the project (a developer folder: it is part of it).
if exist "%~dp0package.json" exit /b 0
(goto) 2>nul & del "%~f0"
exit /b 0

##POWERSHELL##
# Tarkov MoA - diagnosis and repair. Run by "Diagnosticar Tarkov MoA.bat"
# (this text lives inside the .bat, after its marker line).
#
# It looks at everything the app needs on this PC, says what is wrong, fixes
# what it can, writes a report on the Desktop, and leaves the installed copy
# up to date so "Abrir Tarkov MoA.bat" builds and opens the newest version.
#
# What it never does: read or touch the game's memory or files (it only looks
# where the game keeps its logs and screenshots), store a password or token,
# or delete what the app remembers (that lives in Windows, not in the program
# folder). A folder it replaces is kept aside, renamed.
#
# Environment for tests: MOA_DEST (install folder), MOA_REPO (repository),
# MOA_TESTE (touch nothing outside the install folder: no uninstalling, no
# shortcuts, no firewall, no start-with-Windows value, no Desktop report).

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$Repo = if ($env:MOA_REPO) { $env:MOA_REPO } else { 'https://github.com/3nzog/MOA-TARKOV.git' }
$Docs = [Environment]::GetFolderPath('MyDocuments')
$Dest = if ($env:MOA_DEST) { $env:MOA_DEST } else { Join-Path $Docs 'Tarkov MoA' }
$Test = [bool]$env:MOA_TESTE
$Bat = Join-Path $Dest 'Abrir Tarkov MoA.bat'
$Exe = Join-Path $Dest 'src-tauri\target\release\tarkov-companion.exe'
$Stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$Report = New-Object System.Collections.Generic.List[string]
$Counts = @{ OK = 0; FIX = 0; WARN = 0; FAIL = 0 }
$Updated = $false

# Git never stops to ask anything, and trusts the program's folder.
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = '*'

function Section([string]$title) {
  Write-Host ''
  Write-Host ("  ▌ " + $title) -ForegroundColor Cyan
  $Report.Add('')
  $Report.Add('== ' + $title + ' ==')
}

# One finding: OK (fine), FIX (was wrong, fixed now), WARN (worth knowing),
# FAIL (wrong and not fixed: what to do is in the detail).
function Item([string]$kind, [string]$text, [string]$detail = '') {
  $Counts[$kind]++
  $mark = @{ OK = '✔'; FIX = '✚'; WARN = '▲'; FAIL = '✖' }[$kind]
  $color = @{ OK = 'Green'; FIX = 'Cyan'; WARN = 'Yellow'; FAIL = 'Red' }[$kind]
  $label = @{ OK = 'OK'; FIX = 'CONSERTADO'; WARN = 'ATENCAO'; FAIL = 'PROBLEMA' }[$kind]
  Write-Host ("    " + $mark + "  " + $text) -ForegroundColor $color
  if ($detail) { Write-Host ("       " + $detail) -ForegroundColor DarkGray }
  $Report.Add(('[{0}] {1}' -f $label, $text))
  if ($detail) { $Report.Add('      ' + $detail) }
}

function Git-Run([string[]]$argv) {
  $out = & git @argv 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $out.Trim() }
}

function Git-ErrorLine([string]$text) {
  $l = ($text -split "`r?`n" | Where-Object { $_ -match '^(fatal|error):' } | Select-Object -Last 1)
  if ($l) { return $l } else { return ($text -split "`r?`n" | Select-Object -Last 1) }
}

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# The Tarkov MoA processes whose program lives under a folder.
function MoA-In([string]$folder) {
  $d = $folder.TrimEnd('\') + '\'
  @(Get-Process tarkov-companion -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) })
}

function Close-MoA-In([string]$folder) {
  $p = MoA-In $folder
  if ($p.Count -eq 0) { return 0 }
  foreach ($x in $p) { [void]$x.CloseMainWindow() }
  Start-Sleep -Seconds 4
  foreach ($x in $p) { if (-not $x.HasExited) { try { $x.Kill() } catch {} } }
  Start-Sleep -Milliseconds 500
  return $p.Count
}

function Folder-Aside([string]$folder) {
  $n = $folder + ' (antiga)'
  $i = 2
  while (Test-Path -LiteralPath $n) { $n = $folder + " (antiga $i)"; $i++ }
  [void](Close-MoA-In $folder)
  try {
    Move-Item -LiteralPath $folder -Destination $n -ErrorAction Stop
    return $n
  } catch { return $null }
}

function Fresh-Clone {
  $r = Git-Run @('clone', $Repo, $Dest)
  if ($r.Code -eq 0) { $script:Updated = $true; return $true }
  Item FAIL 'Nao deu para baixar o Tarkov MoA do GitHub' (Git-ErrorLine $r.Out)
  return $false
}

Write-Host ''
Write-Host '  TARKOV MOA  ·  diagnostico e conserto' -ForegroundColor White
Write-Host '  ─────────────────────────────────────────────' -ForegroundColor DarkGray
$Report.Add('Tarkov MoA - relatorio do diagnostico - ' + $Stamp)

# ---- 1. This PC ------------------------------------------------------------------
Section 'Este PC'
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
Item OK ('Windows: ' + $os.Caption + ' (' + $os.Version + ')')
Item OK ('PowerShell ' + $PSVersionTable.PSVersion.ToString())
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Item OK ('Pasta Documentos: ' + $Docs) $(if ($Docs -match 'OneDrive') { 'Fica no OneDrive: se o OneDrive pausar ou baixar arquivos sob demanda, o Git pode falhar. Se der erro, deixe a pasta "Tarkov MoA" sempre disponivel neste dispositivo.' } else { '' })
try {
  $drive = (Get-Item -LiteralPath $Docs).PSDrive
  $freeGb = [math]::Round($drive.Free / 1GB, 1)
  if ($freeGb -lt 8) { Item WARN ("Pouco espaco livre no disco " + $drive.Name + ": " + $freeGb + ' GB') 'Compilar o MoA pela primeira vez usa uns 5 GB (Rust e dependencias).' }
  else { Item OK ("Espaco livre no disco " + $drive.Name + ": " + $freeGb + ' GB') }
} catch {}

# ---- 2. Git and GitHub ------------------------------------------------------------
Section 'Git e GitHub'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  if (Test-Path "$env:ProgramFiles\Git\cmd\git.exe") { $env:Path = "$env:ProgramFiles\Git\cmd;" + $env:Path }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host '       Instalando o Git (o Windows pode pedir permissao)...' -ForegroundColor DarkGray
    & winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements | Out-Null
    Refresh-Path
    if (Test-Path "$env:ProgramFiles\Git\cmd\git.exe") { $env:Path = "$env:ProgramFiles\Git\cmd;" + $env:Path }
  }
  if (Get-Command git -ErrorAction SilentlyContinue) { Item FIX 'Git nao estava instalado: instalado agora' }
  else { Item FAIL 'Git nao esta instalado e nao deu para instalar' 'Instale pelo site git-scm.com e rode este arquivo de novo.' }
} else {
  Item OK ('Git ' + ((& git --version) -replace 'git version ', ''))
}
$haveGit = [bool](Get-Command git -ErrorAction SilentlyContinue)
$remoteHead = $null
if ($haveGit) {
  $r = Git-Run @('ls-remote', $Repo, 'HEAD')
  if ($r.Code -eq 0 -and $r.Out) {
    $remoteHead = ($r.Out -split '\s+')[0]
    Item OK ('GitHub responde; versao mais nova: ' + $remoteHead.Substring(0, 7))
  } else {
    Item FAIL 'Nao deu para falar com o GitHub' ((Git-ErrorLine $r.Out) + '  — confira a internet, um antivirus ou proxy bloqueando o git.')
  }
}

# ---- 3. The program folder --------------------------------------------------------
Section 'Pasta do programa'
Item OK ('Pasta: ' + $Dest)
if ($haveGit -and $remoteHead) {
  $needFresh = $false
  if (-not (Test-Path -LiteralPath $Dest)) {
    Item WARN 'O Tarkov MoA nao esta instalado nesta pasta: baixando'
    $needFresh = $true
  } elseif (-not (Test-Path -LiteralPath (Join-Path $Dest '.git'))) {
    $aside = Folder-Aside $Dest
    if ($aside) { Item FIX 'A pasta nao vinha do GitHub (nunca se atualizaria): guardada de lado e baixada de novo' ('Antiga: ' + $aside); $needFresh = $true }
    else { Item FAIL 'A pasta nao vinha do GitHub e nao deu para renomear' 'Feche o que estiver usando a pasta (o MoA, o Explorer, um editor) e rode de novo.' }
  } else {
    # Git refusing the folder ("dubious ownership"): trusted for good.
    $st = & git -c safe.directory= -C $Dest status --porcelain 2>&1 | Out-String
    if ($st -match 'dubious ownership') {
      $fwd = $Dest -replace '\\', '/'
      & git config --global --add safe.directory $fwd 2>&1 | Out-Null
      Item FIX 'O Git recusava a pasta (criada por outro usuario do Windows): agora ela e confiavel' 'Era isso que travava a atualizacao pelo Abrir Tarkov MoA.bat.'
    }
    # Leftover lock files from a Git that was interrupted.
    if (-not (Get-Process git -ErrorAction SilentlyContinue)) {
      $locks = @(Get-ChildItem -LiteralPath (Join-Path $Dest '.git') -Recurse -Filter '*.lock' -Force -ErrorAction SilentlyContinue)
      if ($locks.Count -gt 0) {
        $locks | Remove-Item -Force -ErrorAction SilentlyContinue
        Item FIX ("Arquivos de trava esquecidos do Git: " + $locks.Count + ' apagados')
      }
    }
    # The program's own GitHub address.
    $origin = (& git -C $Dest remote get-url origin 2>$null | Out-String).Trim()
    if (-not $origin) { & git -C $Dest remote add origin $Repo 2>&1 | Out-Null; Item FIX 'A pasta nao tinha o endereco do GitHub: colocado' }
    elseif ($origin -ne $Repo) { & git -C $Dest remote set-url origin $Repo 2>&1 | Out-Null; Item FIX 'O endereco do GitHub na pasta estava diferente: corrigido' ('Era: ' + ($origin -replace '//[^/@]+@', '//'))}
    & git -C $Dest config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' 2>&1 | Out-Null
    $f = Git-Run @('-C', $Dest, 'fetch', '--prune', 'origin')
    if ($f.Code -ne 0) {
      $why = Git-ErrorLine $f.Out
      $aside = Folder-Aside $Dest
      if ($aside) { Item FIX 'A pasta nao atualizava: guardada de lado e baixada de novo' ('Erro do Git: ' + $why + '  |  Antiga: ' + $aside); $needFresh = $true }
      else { Item FAIL 'A pasta nao atualiza e nao deu para renomear' ('Erro do Git: ' + $why) }
    } else {
      $before = (& git -C $Dest rev-parse --verify --quiet HEAD 2>$null | Out-String).Trim()
      $after = (& git -C $Dest rev-parse origin/main 2>$null | Out-String).Trim()
      if ($before -and $before -eq $after) {
        Item OK ('Ja estava na versao mais nova (' + $after.Substring(0, 7) + ')')
      } else {
        $behind = (& git -C $Dest rev-list --count "HEAD..origin/main" 2>$null | Out-String).Trim()
        $dirty = (& git -C $Dest status --porcelain --untracked-files=no 2>$null | Out-String).Trim()
        if ($dirty) { & git -C $Dest stash push -m 'Tarkov MoA: guardado pelo diagnostico' 2>&1 | Out-Null }
        $old = if ($before) { $before.Substring(0, 7) } else { 'nenhuma' }
        if ($before) { & git -C $Dest branch ('moa-antes-do-diagnostico-' + (Get-Date -Format 'yyyyMMdd-HHmm')) 2>&1 | Out-Null }
        & git -C $Dest symbolic-ref HEAD refs/heads/main 2>&1 | Out-Null
        $reset = Git-Run @('-C', $Dest, 'reset', '--hard', 'origin/main')
        & git -C $Dest branch --set-upstream-to=origin/main 2>&1 | Out-Null
        $now = (& git -C $Dest rev-parse HEAD 2>$null | Out-String).Trim()
        if ($reset.Code -eq 0 -and $now -eq $after) {
          $script:Updated = $true
          Item FIX ('Estava numa versao antiga: atualizado (' + $old + ' -> ' + $after.Substring(0, 7) + ')') $(if ($behind) { "$behind mudancas novas" + $(if ($dirty) { '; arquivos mudados na pasta ficaram guardados (git stash)' } else { '' }) } else { '' })
        } else {
          $aside = Folder-Aside $Dest
          if ($aside) { Item FIX 'A versao nova nao entrava na pasta: guardada de lado e baixada de novo' ('Erro do Git: ' + (Git-ErrorLine $reset.Out)); $needFresh = $true }
          else { Item FAIL 'A versao nova nao entra na pasta' ('Erro do Git: ' + (Git-ErrorLine $reset.Out)) }
        }
      }
    }
  }
  if ($needFresh) {
    if (Fresh-Clone) { Item FIX 'Tarkov MoA baixado do GitHub (versao mais nova)' }
  }
} elseif (Test-Path -LiteralPath $Dest) {
  Item WARN 'Sem Git ou sem GitHub agora: a pasta nao foi atualizada'
}

# ---- 4. The program itself (.exe) ---------------------------------------------------
Section 'Programa (.exe)'
$running = MoA-In $Dest
if (Test-Path -LiteralPath $Exe) {
  $exeAt = (Get-Item -LiteralPath $Exe).LastWriteTime
  $headAt = $null
  if ($haveGit -and (Test-Path -LiteralPath (Join-Path $Dest '.git'))) {
    $iso = (& git -C $Dest log -1 --format=%cI 2>$null | Out-String).Trim()
    if ($iso) { $headAt = [datetime]::Parse($iso) }
  }
  if ($Updated -or ($headAt -and $exeAt -lt $headAt)) {
    [void](Close-MoA-In $Dest)
    try {
      Remove-Item -LiteralPath $Exe -Force -ErrorAction Stop
      Item FIX ('O .exe era de uma versao antiga (' + $exeAt.ToString('dd/MM HH:mm') + '): apagado') 'O Abrir Tarkov MoA.bat compila o novo; a versao antiga nao tem mais como abrir.'
    } catch { Item FAIL 'O .exe antigo nao deu para apagar' 'Feche o Tarkov MoA e rode de novo.' }
  } else {
    Item OK ('O .exe ja e da versao atual (' + $exeAt.ToString('dd/MM HH:mm') + ')')
  }
} else {
  Item OK 'Ainda sem .exe: o Abrir Tarkov MoA.bat compila na primeira vez'
}
$others = @(Get-Process tarkov-companion -ErrorAction SilentlyContinue | Where-Object { $_.Path -and -not $_.Path.StartsWith($Dest.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) })
foreach ($o in $others) { Item WARN ('Outro Tarkov MoA aberto, de outra pasta: ' + $o.Path) 'Ele pode ser uma versao antiga. Feche e abra pelo atalho Tarkov MoA.' }

# ---- 5. Old installs, shortcuts, starting with Windows -----------------------------
Section 'Instalacoes antigas e atalhos'
if ($Test) {
  Item OK 'Pulado (teste)'
} else {
  $keys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  $olds = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^(Tarkov MoA|Tarkov Companion|tarkov-companion)\b' })
  if ($olds.Count -eq 0) { Item OK 'Nenhum Tarkov MoA instalado por instalador (com atualizador proprio)' }
  foreach ($a in $olds) {
    $loc = [string]$a.InstallLocation
    if ($loc) { [void](Close-MoA-In $loc) }
    $u = [string]$a.UninstallString
    try {
      if ($u -match 'msiexec') {
        Start-Process msiexec.exe -ArgumentList ('/x ' + $a.PSChildName + ' /qn') -Wait -ErrorAction Stop
      } elseif ($u) {
        $path = if ($u.StartsWith('"')) { $u.Split('"')[1] } else { $u.Split(' ')[0] }
        # Silent: the app's data (progress, settings) stays.
        Start-Process -FilePath $path -ArgumentList '/S' -Wait -ErrorAction Stop
      }
      Start-Sleep -Seconds 2
      $still = Get-ItemProperty $a.PSPath -ErrorAction SilentlyContinue
      if ($still) { Item FAIL ('Nao deu para desinstalar: ' + $a.DisplayName + ' ' + $a.DisplayVersion) 'Desinstale em Configuracoes do Windows > Aplicativos.' }
      else { Item FIX ('Versao antiga instalada removida (com o atualizador dela): ' + $a.DisplayName + ' ' + $a.DisplayVersion) 'O progresso e as configuracoes ficam.' }
    } catch { Item FAIL ('Nao deu para desinstalar: ' + $a.DisplayName) ($_.Exception.Message) }
  }

  # Shortcuts that open an .exe of the MoA directly open the .bat instead
  # (it updates before opening).
  $sh = New-Object -ComObject WScript.Shell
  $places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'), (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  $icon = Join-Path $Dest 'src-tauri\icons\icon.ico'
  $fixed = 0
  foreach ($lnk in (Get-ChildItem -LiteralPath $places -Filter *.lnk -Recurse -ErrorAction SilentlyContinue)) {
    $l = $sh.CreateShortcut($lnk.FullName)
    $name = [IO.Path]::GetFileName([string]$l.TargetPath).ToLower()
    if ($name -eq 'tarkov-companion.exe' -or $name -eq 'tarkov moa.exe' -or $name -eq 'tarkov companion.exe') {
      try {
        $l.TargetPath = $Bat; $l.Arguments = ''; $l.WorkingDirectory = $Dest
        if (Test-Path -LiteralPath $icon) { $l.IconLocation = $icon + ',0' }
        $l.Save(); $fixed++
      } catch {}
    }
  }
  if ($fixed -gt 0) { Item FIX ("Atalhos que abriam o .exe direto (versao que nao se atualiza): " + $fixed + ' agora abrem pelo Abrir Tarkov MoA.bat') }
  else { Item OK 'Nenhum atalho abrindo o .exe direto' }
  $desk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Tarkov MoA.lnk'
  if ((Test-Path -LiteralPath $Bat) -and -not (Test-Path -LiteralPath $desk)) {
    $l = $sh.CreateShortcut($desk); $l.TargetPath = $Bat; $l.WorkingDirectory = $Dest
    if (Test-Path -LiteralPath $icon) { $l.IconLocation = $icon + ',0' }
    $l.Description = 'Tarkov MoA'; $l.Save()
    Item FIX 'Atalho Tarkov MoA criado na Area de Trabalho'
  } elseif (Test-Path -LiteralPath $desk) {
    $l = $sh.CreateShortcut($desk)
    if ($l.TargetPath -ne $Bat) { $l.TargetPath = $Bat; $l.WorkingDirectory = $Dest; $l.Save(); Item FIX 'O atalho Tarkov MoA da Area de Trabalho apontava para outro lugar: corrigido' }
    else { Item OK 'Atalho Tarkov MoA na Area de Trabalho' }
  }

  # Start with Windows: points at this install's .exe, or is removed.
  $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $val = (Get-ItemProperty -Path $run -Name 'Tarkov MoA' -ErrorAction SilentlyContinue).'Tarkov MoA'
  if ($val) {
    $want = '"' + $Exe + '" --bandeja'
    if ($val -ne $want) { Set-ItemProperty -Path $run -Name 'Tarkov MoA' -Value $want; Item FIX 'Iniciar com o Windows apontava para outra copia: corrigido' }
    else { Item OK 'Iniciar com o Windows: ligado' }
  } else { Item OK 'Iniciar com o Windows: desligado (liga em Configuracoes > Geral)' }
}

# ---- 6. What the build needs --------------------------------------------------------
Section 'Requisitos para compilar'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Item OK ('Node.js ' + (& node -v)) } else { Item WARN 'Node.js nao instalado' 'O Abrir Tarkov MoA.bat instala sozinho.' }
if (Test-Path "$env:USERPROFILE\.cargo\bin\cargo.exe") { $env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path }
if (Get-Command cargo -ErrorAction SilentlyContinue) { Item OK ('Rust ' + ((& rustc --version) -replace '^rustc ', '')) } else { Item WARN 'Rust nao instalado' 'O Abrir Tarkov MoA.bat instala sozinho.' }
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = if (Test-Path $vswhere) { & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath } else { $null }
if ($vs) { Item OK 'Compilador C++ (Visual Studio Build Tools)' } else { Item WARN 'Compilador C++ nao instalado' 'O Abrir Tarkov MoA.bat instala sozinho (alguns GB).' }
$wv = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($wv) { Item OK ('WebView2 ' + $wv.pv) } else { Item WARN 'WebView2 nao encontrado' 'O Abrir Tarkov MoA.bat instala sozinho.' }

# ---- 7. Network: ports and firewall ------------------------------------------------
Section 'Rede (party, PC ligado, celular)'
$ports = 8787, 8789, 8791
foreach ($p in $ports) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    $owner = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($owner -and $owner.Name -ne 'tarkov-companion') { Item WARN ("Porta $p em uso por outro programa: " + $owner.Name) 'Feche esse programa se a party, o PC ligado ou o celular nao funcionarem.' }
  }
}
$rules = 'Tarkov MoA party', 'Tarkov MoA party (busca)', 'Tarkov MoA rede de casa', 'Tarkov MoA rede de casa (busca)', 'Tarkov MoA celular', 'Tarkov MoA celular (Tailscale)'
$missing = @($rules | Where-Object { -not (Get-NetFirewallRule -DisplayName $_ -ErrorAction SilentlyContinue) })
if ($missing.Count -eq 0) { Item OK 'Firewall do Windows liberado para o MoA' }
elseif ($Test) { Item WARN ('Firewall: faltam ' + $missing.Count + ' regras (teste: nao mexido)') }
else {
  $script = Join-Path $Dest 'scripts\party-firewall.ps1'
  if (Test-Path -LiteralPath $script) {
    Write-Host '       Liberando o firewall (o Windows vai pedir permissao)...' -ForegroundColor DarkGray
    Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"' + $script + '"')) -Wait
    $missing = @($rules | Where-Object { -not (Get-NetFirewallRule -DisplayName $_ -ErrorAction SilentlyContinue) })
    if ($missing.Count -eq 0) { Item FIX 'Firewall do Windows liberado para o MoA (party, PC ligado, celular)' }
    else { Item FAIL 'O firewall nao foi liberado' 'A permissao foi recusada. O MoA pede de novo quando precisar.' }
  } else { Item WARN 'Firewall: faltam regras, e a pasta do programa nao tem o script para liberar' }
}

# ---- 8. The game (only where it keeps logs and screenshots) -----------------------
Section 'Escape from Tarkov'
$eft = $null
foreach ($k in 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 3932890') {
  $loc = (Get-ItemProperty $k -ErrorAction SilentlyContinue).InstallLocation
  if ($loc -and (Test-Path -LiteralPath $loc)) { $eft = $loc; break }
}
if ($eft) {
  Item OK ('Jogo em: ' + $eft)
  $logs = @((Join-Path $eft 'build\Logs'), (Join-Path $eft 'Logs')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($logs) {
    $last = Get-ChildItem -LiteralPath $logs -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    Item OK ('Logs do jogo: ' + $logs) $(if ($last) { 'Ultima sessao: ' + $last.LastWriteTime.ToString('dd/MM HH:mm') } else { '' })
  } else { Item WARN 'Pasta de logs do jogo nao encontrada' 'Abra o jogo uma vez; depois, no MoA: Configuracoes > Integracoes > Pasta de instalacao do EFT.' }
} else {
  Item WARN 'Instalacao do jogo nao encontrada pelo registro' 'No MoA: Configuracoes > Integracoes > Pasta de instalacao do EFT > Mudar pasta.'
}
$shots = Join-Path $Docs 'Escape from Tarkov\Screenshots'
if (Test-Path -LiteralPath $shots) {
  $n = @(Get-ChildItem -LiteralPath $shots -Filter *.png -ErrorAction SilentlyContinue).Count
  Item OK ('Prints do jogo: ' + $shots) ("$n prints")
} else { Item WARN 'Pasta de prints do jogo nao existe ainda' 'Tire um print no jogo (tecla Print Screen) para ela aparecer.' }

# ---- 9. What the app remembers ------------------------------------------------------
Section 'Dados do MoA'
$data = Join-Path $env:APPDATA 'com.tarkov-companion.app'
$web = Join-Path $env:LOCALAPPDATA 'com.tarkov-companion.app'
if ((Test-Path -LiteralPath $data) -or (Test-Path -LiteralPath $web)) { Item OK 'Progresso e configuracoes do MoA: guardados (nada foi apagado)' }
else { Item OK 'Ainda sem dados do MoA (primeira vez neste PC)' }

# ---- Summary, report ---------------------------------------------------------------
Section 'Resumo'
$sum = ('{0} ok · {1} consertados · {2} avisos · {3} problemas' -f $Counts.OK, $Counts.FIX, $Counts.WARN, $Counts.FAIL)
Write-Host ('    ' + $sum) -ForegroundColor White
$Report.Add($sum)
$Report.Add('')
$Report.Add('Proximo passo: abrir pelo atalho Tarkov MoA (ou o Abrir Tarkov MoA.bat em ' + $Dest + ').')
$tmp = Join-Path $env:TEMP 'TarkovMoA-diagnostico.txt'
$Report | Set-Content -LiteralPath $tmp -Encoding UTF8
if (-not $Test) {
  $out = Join-Path ([Environment]::GetFolderPath('Desktop')) ('Relatorio Tarkov MoA ' + (Get-Date -Format 'yyyy-MM-dd HHmm') + '.txt')
  $Report | Set-Content -LiteralPath $out -Encoding UTF8
  Write-Host ''
  Write-Host ('    Relatorio salvo na Area de Trabalho: ' + (Split-Path $out -Leaf)) -ForegroundColor Gray
  Start-Process notepad.exe -ArgumentList ('"' + $out + '"')
}
# For the .bat: open next, when the install is there.
if ((Test-Path -LiteralPath $Bat) -and $Counts.FAIL -eq 0) { exit 0 }
if (Test-Path -LiteralPath $Bat) { exit 2 }
exit 1
