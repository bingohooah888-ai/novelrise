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

try {
  $EncryptedToken = (Get-Content -Raw -Path $TokenPath).Trim().TrimStart([char]0xFEFF)
  $SecureToken = $EncryptedToken | ConvertTo-SecureString
  $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
  $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  $env:NOVELIGHT_BRIDGE_GITHUB_TOKEN = $PlainToken
  $env:NOVELIGHT_BRIDGE_CONFIG = $ConfigPath

  node $DaemonPath *>> $LogPath
} catch {
  $Stamp = Get-Date -Format o
  Add-Content -Path $LogPath -Value "$Stamp NOVELIGHT Commander bridge failed: $($_.Exception.Message)"
  throw
} finally {
  Remove-Item Env:NOVELIGHT_BRIDGE_GITHUB_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:NOVELIGHT_BRIDGE_CONFIG -ErrorAction SilentlyContinue
  Remove-Variable PlainToken -ErrorAction SilentlyContinue
  if ($null -ne $Bstr -and $Bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
  }
}
