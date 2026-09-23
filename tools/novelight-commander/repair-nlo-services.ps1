param(
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\Commander"
$BridgeRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\commander-bridge"
if (-not $ConfigPath) { $ConfigPath = Join-Path $BridgeRoot "config.json" }
$BridgeTokenPath = Join-Path $BridgeRoot "github-token.dpapi"
$TunnelKeyPath = Join-Path $RuntimeRoot "control-plane-key.dpapi"
$BridgeRunner = Join-Path $Here "run-github-bridge.ps1"
$TunnelInstaller = Join-Path $Here "install-openai-tunnel-autostart.ps1"
$WatchdogLog = Join-Path $RuntimeRoot "watchdog.log"

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

function Write-WatchdogLog([string]$Message) {
  $Stamp = Get-Date -Format o
  Add-Content -Path $WatchdogLog -Value "$Stamp $Message"
}

function Get-ProcessCount([string]$Pattern) {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { [string]$_.CommandLine -match $Pattern }).Count
}

$BridgeDaemonCount = Get-ProcessCount "github-bridge-daemon[.]js"
$BridgeRunnerCount = Get-ProcessCount "run-github-bridge[.]ps1"

if ($BridgeDaemonCount -eq 0 -and $BridgeRunnerCount -eq 0) {
  if ((Test-Path $ConfigPath) -and (Test-Path $BridgeTokenPath) -and (Test-Path $BridgeRunner)) {
    Write-WatchdogLog "GitHub Bridge missing; starting bridge supervisor."
    $BridgeArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $BridgeRunner, "-ConfigPath", $ConfigPath)
    Start-Process -FilePath "powershell.exe" -ArgumentList $BridgeArgs -WindowStyle Hidden
    Start-Sleep -Seconds 3
  } else {
    Write-WatchdogLog "GitHub Bridge recovery skipped because required local files are missing."
  }
}

$TunnelRunnerCount = Get-ProcessCount "run-openai-tunnel[.]ps1"
$TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue

if ($TunnelRunnerCount -eq 0) {
  if (-not $TunnelTask -and (Test-Path $TunnelKeyPath) -and (Test-Path $TunnelInstaller)) {
    Write-WatchdogLog "Tunnel task missing; installing tunnel autostart."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TunnelInstaller *>> $WatchdogLog
    $TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue
  } elseif ($TunnelTask) {
    Write-WatchdogLog "Tunnel supervisor missing; starting scheduled tunnel task."
    Start-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel"
  } else {
    Write-WatchdogLog "Tunnel recovery skipped because task or encrypted key is missing."
  }
  Start-Sleep -Seconds 3
}

$BridgeDaemonCount = Get-ProcessCount "github-bridge-daemon[.]js"
$BridgeRunnerCount = Get-ProcessCount "run-github-bridge[.]ps1"
$TunnelRunnerCount = Get-ProcessCount "run-openai-tunnel[.]ps1"
$TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue

Write-Output ("bridge_daemon_processes: " + $BridgeDaemonCount)
Write-Output ("bridge_supervisor_processes: " + $BridgeRunnerCount)
Write-Output ("tunnel_supervisor_processes: " + $TunnelRunnerCount)
Write-Output ("tunnel_task: " + $(if ($TunnelTask) { $TunnelTask.State } else { "missing" }))
Write-Output ("watchdog_log: " + $WatchdogLog)
