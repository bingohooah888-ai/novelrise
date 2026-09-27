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
$NodePath = (Get-Command node -ErrorAction Stop).Source

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

  $RestartDelaySeconds = 2
  $MaxRestartDelaySeconds = 60

  while ($true) {
    $StartedAt = Get-Date
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
      # Windows PowerShell 5 surfaces native stderr as NativeCommandError records.
      # Node deprecation warnings must not terminate the NLO supervisor; the native
      # process exit code remains the authority for restart decisions below.
      $ErrorActionPreference = 'Continue'
      & $NodePath $DaemonPath *>> $LogPath
      $ExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $PreviousErrorActionPreference
    }
    $Stamp = Get-Date -Format o

    if ($ExitCode -eq 75) {
      Add-Content -Path $LogPath -Value "$Stamp NOVELIGHT Commander bridge requested a planned restart; restarting in 2 seconds."
      $RestartDelaySeconds = 2
      Start-Sleep -Seconds 2
      continue
    }

    if ($ExitCode -eq 0) {
      Add-Content -Path $LogPath -Value "$Stamp NOVELIGHT Commander bridge exited normally; supervisor stopping."
      break
    }

    $RuntimeSeconds = ((Get-Date) - $StartedAt).TotalSeconds
    if ($RuntimeSeconds -ge 60) {
      $RestartDelaySeconds = 2
    }

    Add-Content -Path $LogPath -Value "$Stamp NOVELIGHT Commander bridge exited with code $ExitCode; restarting in $RestartDelaySeconds seconds."
    Start-Sleep -Seconds $RestartDelaySeconds
    $RestartDelaySeconds = [Math]::Min($MaxRestartDelaySeconds, [Math]::Max(2, $RestartDelaySeconds * 2))
  }
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
