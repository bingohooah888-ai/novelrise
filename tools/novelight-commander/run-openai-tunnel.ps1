param(
  [int]$BaseRestartDelaySeconds = 5,
  [int]$MaxRestartDelaySeconds = 60
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\Commander"
$KeyPath = Join-Path $RuntimeRoot "control-plane-key.dpapi"
$LogPath = Join-Path $RuntimeRoot "openai-tunnel.log"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClientInstallRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\TunnelClient"
$ClientInstaller = Join-Path $Here "install-openai-tunnel-client.ps1"
$PluginAutoregisterScript = Join-Path $Here "src\chatgpt-plugin-autoregister.js"

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

function Write-TunnelLog([string]$Message) {
  $Stamp = Get-Date -Format o
  Add-Content -Path $LogPath -Value "$Stamp $Message"
}

function Load-ControlPlaneKey {
  if ($env:CONTROL_PLANE_API_KEY) {
    return $env:CONTROL_PLANE_API_KEY
  }
  if (-not (Test-Path $KeyPath)) {
    throw "CONTROL_PLANE_API_KEY is unavailable and the encrypted local key file is missing. Re-run configure-openai-tunnel.ps1 locally."
  }

  $Encrypted = (Get-Content -Raw -Path $KeyPath).Trim()
  $Secure = $Encrypted | ConvertTo-SecureString
  $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  } finally {
    if ($Bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
    }
  }
}

function Resolve-TunnelClient {
  $Command = Get-Command tunnel-client -ErrorAction SilentlyContinue
  if ($Command) { return $Command.Source }

  $Installed = Get-ChildItem $ClientInstallRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "tunnel-client.exe" } |
    Select-Object -First 1
  if ($Installed) { return $Installed.FullName }

  if (-not (Test-Path $ClientInstaller)) {
    throw "tunnel-client is required and the NOVELIGHT bootstrap installer is missing."
  }

  Write-TunnelLog "tunnel-client is missing; running verified bootstrap installer."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ClientInstaller *>> $LogPath
  if ($LASTEXITCODE -ne 0) {
    throw "OpenAI tunnel-client bootstrap failed with exit code $LASTEXITCODE"
  }

  $Installed = Get-ChildItem $ClientInstallRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "tunnel-client.exe" } |
    Select-Object -First 1
  if (-not $Installed) {
    throw "tunnel-client bootstrap completed but tunnel-client.exe was not found."
  }
  return $Installed.FullName
}

function Start-ChatGptPluginAutoregistration {
  if (-not (Test-Path $PluginAutoregisterScript)) {
    Write-TunnelLog "ChatGPT plugin autoregistration helper is unavailable; continuing tunnel startup."
    return
  }

  if (-not $env:NOVELIGHT_COMMANDER_TUNNEL_ID) {
    $SavedTunnelId = [Environment]::GetEnvironmentVariable("NOVELIGHT_COMMANDER_TUNNEL_ID", "User")
    if ($SavedTunnelId) { $env:NOVELIGHT_COMMANDER_TUNNEL_ID = $SavedTunnelId }
  }
  if (-not $env:NOVELIGHT_COMMANDER_TUNNEL_ID) {
    Write-TunnelLog "ChatGPT plugin autoregistration skipped because tunnel id is unavailable."
    return
  }

  $Node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $Node) {
    Write-TunnelLog "ChatGPT plugin autoregistration skipped because node is unavailable."
    return
  }

  try {
    Start-Process -FilePath $Node.Source -ArgumentList @($PluginAutoregisterScript) -WindowStyle Hidden | Out-Null
    Write-TunnelLog "Started ChatGPT plugin autoregistration helper."
  } catch {
    Write-TunnelLog "Could not start ChatGPT plugin autoregistration helper: $($_.Exception.Message)"
  }
}

$TunnelClient = Resolve-TunnelClient
$ClientDir = Split-Path -Parent $TunnelClient
$env:Path = "$ClientDir;$env:Path"

# Start the idempotent ChatGPT registration helper before loading the control-plane
# credential so the browser helper never inherits that secret.
Start-ChatGptPluginAutoregistration
$env:CONTROL_PLANE_API_KEY = Load-ControlPlaneKey
$DelaySeconds = [Math]::Max(1, $BaseRestartDelaySeconds)

try {
  while ($true) {
    $StartedAt = Get-Date
    try {
      Write-TunnelLog "Checking NOVELIGHT Commander tunnel profile."
      & $TunnelClient doctor --profile novelight-commander --explain *>> $LogPath
      $DoctorExitCode = $LASTEXITCODE
      if ($DoctorExitCode -ne 0) {
        Write-TunnelLog "Tunnel doctor returned code $DoctorExitCode. Continuing to tunnel run; optional Codex plugin/UI checks must not keep NLO offline."
      }

      Write-TunnelLog "Starting NOVELIGHT Commander tunnel."
      & $TunnelClient run --profile novelight-commander *>> $LogPath
      $ExitCode = $LASTEXITCODE
      throw "tunnel-client run exited with code $ExitCode"
    } catch {
      $RuntimeSeconds = ((Get-Date) - $StartedAt).TotalSeconds
      if ($RuntimeSeconds -ge 60) {
        $DelaySeconds = [Math]::Max(1, $BaseRestartDelaySeconds)
      }

      Write-TunnelLog "Tunnel disconnected: $($_.Exception.Message). Restarting in $DelaySeconds seconds."
      Start-Sleep -Seconds $DelaySeconds
      $DelaySeconds = [Math]::Min(
        [Math]::Max(1, $MaxRestartDelaySeconds),
        [Math]::Max(1, $DelaySeconds * 2)
      )
    }
  }
} finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
}
