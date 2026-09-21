param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$BridgeRoot = Split-Path -Parent $ConfigPath
$TokenPath = Join-Path $BridgeRoot 'github-token.dpapi'
$LogPath = Join-Path $BridgeRoot 'bridge.log'
$DaemonPath = Join-Path $Here 'src\github-bridge-daemon.js'

if (-not (Test-Path $ConfigPath)) { throw 'Bridge config file is missing.' }
if (-not (Test-Path $TokenPath)) { throw 'Encrypted GitHub token is missing.' }
if (-not (Test-Path $DaemonPath)) { throw 'Bridge daemon is missing.' }

$EncryptedToken = Get-Content -Raw -Path $TokenPath
$SecureToken = $EncryptedToken | ConvertTo-SecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
  $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  $env:NOVELIGHT_BRIDGE_GITHUB_TOKEN = $PlainToken
  $env:NOVELIGHT_BRIDGE_CONFIG = $ConfigPath

  node $DaemonPath *>> $LogPath
} finally {
  Remove-Item Env:NOVELIGHT_BRIDGE_GITHUB_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:NOVELIGHT_BRIDGE_CONFIG -ErrorAction SilentlyContinue
  Remove-Variable PlainToken -ErrorAction SilentlyContinue
  if ($Bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
  }
}
