# Lets players on the Radmin VPN network (26.0.0.0/8) reach a party hosted by
# Tarkov MoA on this PC: TCP 8787 (the squad relay) and UDP 8788 (the "is anyone
# hosting?" question). Nobody on the internet or the home LAN can. The app runs
# this the first time it hosts; Windows asks for admin rights with its own
# prompt. Run with -Remove to delete both rules.
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$Rules = @(
  @{ Name = 'Tarkov MoA party'; Protocol = 'TCP'; Port = 8787 },
  @{ Name = 'Tarkov MoA party (busca)'; Protocol = 'UDP'; Port = 8788 }
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$PSCommandPath`"")
  if ($Remove) { $argList += '-Remove' }
  $p = Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait -PassThru
  exit $p.ExitCode
}

foreach ($r in $Rules) {
  if (Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $r.Name
  }
  if (-not $Remove) {
    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow -Protocol $r.Protocol `
      -LocalPort $r.Port -RemoteAddress '26.0.0.0/8' -Profile Any | Out-Null
  }
}
exit 0
