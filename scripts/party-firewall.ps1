# Lets other Tarkov MoA PCs reach this one:
#   TCP 8787  the party relay        UDP 8788  "is anyone hosting a party?"
#   TCP 8789  a linked second PC     UDP 8790  "is a PC of mine here?"
#   TCP 8791  the map on a phone on the home Wi-Fi (home subnet only)
# Only from the Radmin VPN network (26.0.0.0/8) and from this PC's own home
# subnet (LocalSubnet). Nobody on the internet can. The app itself also refuses
# anyone outside those networks, and keeps the party off networks Windows calls
# Public. The app runs this the first time it needs it; Windows asks for admin
# rights with its own prompt. Run with -Remove to delete the rules.
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$Rules = @(
  @{ Name = 'Tarkov MoA party'; Protocol = 'TCP'; Ports = @('8787', '8789'); Remote = '26.0.0.0/8' },
  @{ Name = 'Tarkov MoA party (busca)'; Protocol = 'UDP'; Ports = @('8788', '8790'); Remote = '26.0.0.0/8' },
  @{ Name = 'Tarkov MoA rede de casa'; Protocol = 'TCP'; Ports = @('8787', '8789'); Remote = 'LocalSubnet' },
  @{ Name = 'Tarkov MoA rede de casa (busca)'; Protocol = 'UDP'; Ports = @('8788', '8790'); Remote = 'LocalSubnet' },
  @{ Name = 'Tarkov MoA celular'; Protocol = 'TCP'; Ports = @('8791'); Remote = 'LocalSubnet' }
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
      -LocalPort $r.Ports -RemoteAddress $r.Remote -Profile Any | Out-Null
  }
}
exit 0
