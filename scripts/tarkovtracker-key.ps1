# Stores a TarkovTracker API token in the Windows Credential Manager so the
# Tarkov MoA app can use it. Run it in its own console window:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tarkovtracker-key.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tarkovtracker-key.ps1 -Remove
#
# The token is typed into a hidden prompt (nothing is echoed), checked against
# api.tarkovtracker.org/token, and written to Credential Manager. It is never
# printed, logged, written to a file or put on a command line. The app reads it
# back from Credential Manager (target below) inside its Rust core only.
param(
  [switch]$Remove,
  # Only for the self-test: stores without calling the API.
  [switch]$SkipCheck
)

$ErrorActionPreference = 'Stop'
$Target = 'TarkovMoA:TarkovTracker'
$UserName = 'api-token'
$Api = 'https://api.tarkovtracker.org/token'
$UserAgent = 'TarkovMoA/0.9 (+https://github.com/mopocop/Tarkov-moa)'

if (-not ('MoaCred' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MoaCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWriteW(ref CREDENTIAL c, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDeleteW(string target, int type, int flags);
  // The secret is passed as a BSTR from a SecureString and copied straight into
  // the credential blob (UTF-16, no terminator), so no managed string holds it.
  public static void Write(string target, string user, IntPtr bstr, int chars) {
    var c = new CREDENTIAL();
    c.Type = 1;          // CRED_TYPE_GENERIC
    c.Persist = 2;       // CRED_PERSIST_LOCAL_MACHINE: this Windows user, survives reboots
    c.TargetName = target;
    c.UserName = user;
    c.CredentialBlob = bstr;
    c.CredentialBlobSize = chars * 2;
    if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public static bool Delete(string target) { return CredDeleteW(target, 1, 0); }
}
'@
}

function Pause-Exit([int]$code) {
  Write-Host ''
  Read-Host 'Aperte Enter para fechar' | Out-Null
  exit $code
}

$Host.UI.RawUI.WindowTitle = 'Tarkov MoA - chave do TarkovTracker'

if ($Remove) {
  if ([MoaCred]::Delete($Target)) { Write-Host 'Chave removida do Gerenciador de Credenciais.' -ForegroundColor Green }
  else { Write-Host 'Nenhuma chave salva.' -ForegroundColor Yellow }
  Pause-Exit 0
}

Write-Host ''
Write-Host '  Tarkov MoA - chave da API do TarkovTracker' -ForegroundColor Cyan
Write-Host '  ------------------------------------------'
Write-Host '  Cole a chave (Ctrl+V ou botao direito) e aperte Enter.'
Write-Host '  Nada do que voce colar aparece na tela.'
Write-Host '  A chave fica no Gerenciador de Credenciais do Windows e so o MoA a usa.'
Write-Host ''

$secure = Read-Host '  Chave' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $len = $secure.Length
  # Shape check without building a managed copy: read the first 4 chars only.
  $prefix = -join (0..([Math]::Min(3, $len - 1)) | ForEach-Object {
      [char][Runtime.InteropServices.Marshal]::ReadInt16($bstr, $_ * 2)
    })
  $hasSpace = $false
  for ($i = 0; $i -lt $len; $i++) {
    $ch = [char][Runtime.InteropServices.Marshal]::ReadInt16($bstr, $i * 2)
    if ([char]::IsWhiteSpace($ch) -or [char]::IsControl($ch)) { $hasSpace = $true; break }
  }

  if ($len -eq 0) { Write-Host '  Nada colado. Nada foi salvo.' -ForegroundColor Yellow; Pause-Exit 1 }
  if ($hasSpace) { Write-Host '  A chave tem espacos ou quebras de linha. Copie de novo so a chave.' -ForegroundColor Red; Pause-Exit 1 }
  if ($len -lt 8 -or $len -gt 200) { Write-Host '  Tamanho inesperado para uma chave. Nada foi salvo.' -ForegroundColor Red; Pause-Exit 1 }
  if ($prefix -like 'tt_*') { Write-Host '  Chaves antigas "tt_" nao sao mais aceitas. Gere uma nova em tarkovtracker.org.' -ForegroundColor Red; Pause-Exit 1 }
  if ($prefix -cnotin @('PVP_', 'PVE_', 'SZN_')) {
    Write-Host '  A chave deve comecar com PVP_, PVE_ ou SZN_. Nada foi salvo.' -ForegroundColor Red; Pause-Exit 1
  }

  if (-not $SkipCheck) {
    Write-Host '  Conferindo a chave no TarkovTracker...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $ok = $false
    $info = $null
    try {
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      $info = Invoke-RestMethod -Uri $Api -Method Get -UserAgent $UserAgent -Headers @{ Authorization = "Bearer $plain" } -TimeoutSec 20
      $ok = $true
    } catch {
      $status = $null
      if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
      if ($status -eq 401) {
        Write-Host '  O TarkovTracker recusou a chave (401). Nada foi salvo.' -ForegroundColor Red; Pause-Exit 1
      } elseif ($status -eq 403) {
        Write-Host '  A chave nao tem permissao de leitura (GP). Gere uma com "Get Progression".' -ForegroundColor Red; Pause-Exit 1
      } else {
        $why = if ($status) { "HTTP $status" } else { 'sem conexao' }
        Write-Host "  Nao deu para conferir agora ($why)." -ForegroundColor Yellow
        $ans = Read-Host '  Salvar mesmo assim? (s/n)'
        if ($ans -notmatch '^[sSyY]') { Write-Host '  Nada foi salvo.'; Pause-Exit 1 }
      }
    } finally {
      $plain = $null
    }
    if ($ok -and $info) {
      $perms = @($info.permissions)
      $names = @()
      if ($perms -contains 'GP') { $names += 'ler progresso' }
      if ($perms -contains 'WP') { $names += 'gravar progresso' }
      if ($perms -contains 'TP') { $names += 'progresso da equipe' }
      $mode = switch ($info.gameMode) { 'pvp' { 'PvP' } 'pve' { 'PvE' } 'seasonal' { 'Temporada' } default { [string]$info.gameMode } }
      Write-Host "  Chave valida. Modo: $mode. Permissoes: $($names -join ', ')." -ForegroundColor Green
      if ($perms -notcontains 'WP') {
        Write-Host '  Sem "gravar progresso": o MoA vai so importar do TarkovTracker, sem enviar.' -ForegroundColor Yellow
      }
      $info = $null
    }
  }

  [MoaCred]::Write($Target, $UserName, $bstr, $len)
  Write-Host ''
  Write-Host '  Chave salva no Gerenciador de Credenciais do Windows.' -ForegroundColor Green
  Write-Host '  Para remover depois: rode este script com -Remove.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $secure.Dispose()
}
Pause-Exit 0
