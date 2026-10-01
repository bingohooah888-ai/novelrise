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
$BridgeHeartbeatPath = Join-Path $BridgeRoot "heartbeat.json"
$BridgeBusyStatePath = Join-Path $RuntimeRoot "bridge-busy-watch.json"
$BridgeHeartbeatMaxAgeSeconds = 120
$BridgeHeartbeatMaxFailures = 3
$BridgeBusyMaxAgeSeconds = 300

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

function Write-WatchdogLog([string]$Message) {
  $Stamp = Get-Date -Format o
  Add-Content -Path $WatchdogLog -Value "$Stamp $Message"
}

function Get-ProcessCount([string]$Pattern) {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { [string]$_.CommandLine -match $Pattern }).Count
}

function Get-FileAgeSeconds([string]$Path) {
  if (-not (Test-Path $Path)) { return [double]::PositiveInfinity }
  return ((Get-Date) - (Get-Item $Path).LastWriteTime).TotalSeconds
}

function Read-BridgeHeartbeat {
  if (-not (Test-Path $BridgeHeartbeatPath)) {
    return [pscustomobject]@{ status = "missing"; consecutivePollFailures = 0; requestId = "" }
  }
  try {
    $Raw = Get-Content -Raw -Path $BridgeHeartbeatPath | ConvertFrom-Json
    return [pscustomobject]@{
      status = [string]$Raw.status
      consecutivePollFailures = [int]$Raw.consecutivePollFailures
      requestId = [string]$Raw.requestId
    }
  } catch {
    return [pscustomobject]@{ status = "invalid"; consecutivePollFailures = $BridgeHeartbeatMaxFailures; requestId = "" }
  }
}

function Get-BridgeBusyAgeSeconds($Heartbeat) {
  if ($Heartbeat.status -ne "busy" -or -not $Heartbeat.requestId) {
    Remove-Item -Path $BridgeBusyStatePath -Force -ErrorAction SilentlyContinue
    return 0
  }

  $Now = Get-Date
  $FirstSeen = $Now
  $ExistingRequestId = ""
  if (Test-Path $BridgeBusyStatePath) {
    try {
      $Saved = Get-Content -Raw -Path $BridgeBusyStatePath | ConvertFrom-Json
      $ExistingRequestId = [string]$Saved.requestId
      if ($ExistingRequestId -eq $Heartbeat.requestId) {
        $Parsed = [datetime]::Parse([string]$Saved.firstSeen)
        $FirstSeen = $Parsed
      }
    } catch {
      $ExistingRequestId = ""
    }
  }

  if ($ExistingRequestId -ne $Heartbeat.requestId) {
    $Record = [pscustomobject]@{
      requestId = $Heartbeat.requestId
      firstSeen = $Now.ToString("o")
    }
    $Record | ConvertTo-Json | Set-Content -Path $BridgeBusyStatePath -Encoding UTF8
    return 0
  }

  return ($Now - $FirstSeen).TotalSeconds
}

$BridgeDaemonCount = Get-ProcessCount "github-bridge-daemon[.]js"
$BridgeRunnerCount = Get-ProcessCount "run-github-bridge[.]ps1"
$BridgeHeartbeatAgeSeconds = Get-FileAgeSeconds $BridgeHeartbeatPath
$BridgeHeartbeat = Read-BridgeHeartbeat
$BridgeBusyAgeSeconds = Get-BridgeBusyAgeSeconds $BridgeHeartbeat
$BridgeHeartbeatStale = (
  ($BridgeDaemonCount -gt 0 -or $BridgeRunnerCount -gt 0) -and
  $BridgeHeartbeatAgeSeconds -gt $BridgeHeartbeatMaxAgeSeconds
)
$BridgeHeartbeatDegraded = (
  ($BridgeDaemonCount -gt 0 -or $BridgeRunnerCount -gt 0) -and
  (
    $BridgeHeartbeat.status -eq "degraded" -or
    $BridgeHeartbeat.status -eq "invalid"
  ) -and
  $BridgeHeartbeat.consecutivePollFailures -ge $BridgeHeartbeatMaxFailures
)
$BridgeBusyTimedOut = (
  ($BridgeDaemonCount -gt 0 -or $BridgeRunnerCount -gt 0) -and
  $BridgeHeartbeat.status -eq "busy" -and
  $BridgeBusyAgeSeconds -ge $BridgeBusyMaxAgeSeconds
)
$BridgeNeedsRecycle = $BridgeHeartbeatStale -or $BridgeHeartbeatDegraded -or $BridgeBusyTimedOut

if ($BridgeNeedsRecycle) {
  if ($BridgeBusyTimedOut) {
    Write-WatchdogLog ("GitHub Bridge busy request timed out (request=" + $BridgeHeartbeat.requestId + ", busy_age=" + [Math]::Round($BridgeBusyAgeSeconds, 1) + "s); recycling bridge processes.")
  } elseif ($BridgeHeartbeatStale) {
    Write-WatchdogLog ("GitHub Bridge heartbeat stale (" + [Math]::Round($BridgeHeartbeatAgeSeconds, 1) + "s); recycling bridge processes.")
  } else {
    Write-WatchdogLog ("GitHub Bridge heartbeat degraded (status=" + $BridgeHeartbeat.status + ", failures=" + $BridgeHeartbeat.consecutivePollFailures + "); recycling bridge processes.")
  }
  $BridgeProcesses = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        [string]$_.CommandLine -match "github-bridge-daemon[.]js|run-github-bridge[.]ps1"
      }
  )
  foreach ($Process in $BridgeProcesses) {
    Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -Path $BridgeBusyStatePath -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  $BridgeDaemonCount = Get-ProcessCount "github-bridge-daemon[.]js"
  $BridgeRunnerCount = Get-ProcessCount "run-github-bridge[.]ps1"
}

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
$NloTunnelClientCount = @(
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      [string]$_.Name -match "^tunnel-client[.]exe$" -and
      [string]$_.CommandLine -match "novelight-commander"
    }
).Count
$TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue
$TunnelHealthy = (
  $TunnelTask -and
  $TunnelTask.State -eq "Running" -and
  $NloTunnelClientCount -gt 0
)

if (-not $TunnelHealthy) {
  if (-not $TunnelTask -and (Test-Path $TunnelKeyPath) -and (Test-Path $TunnelInstaller)) {
    Write-WatchdogLog "Tunnel task missing; installing tunnel autostart."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TunnelInstaller *>> $WatchdogLog
    $TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue
  } elseif ($TunnelTask) {
    Write-WatchdogLog ("Tunnel health failed: task=" + $TunnelTask.State + ", nlo_clients=" + $NloTunnelClientCount + ". Resetting task and clients.")
    Stop-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    $OrphanedTunnelClients = @(
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
          [string]$_.Name -match "^tunnel-client[.]exe$" -and
          [string]$_.CommandLine -match "novelight-commander"
        }
    )
    foreach ($Client in $OrphanedTunnelClients) {
      Write-WatchdogLog ("Stopping orphaned NOVELIGHT tunnel-client process " + $Client.ProcessId + ".")
      Stop-Process -Id $Client.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($OrphanedTunnelClients.Count -gt 0) {
      Start-Sleep -Seconds 1
    }

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
$TunnelClientCount = @(
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.Name -match "^tunnel-client[.]exe$" }
).Count
$NloTunnelClientCount = @(
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      [string]$_.Name -match "^tunnel-client[.]exe$" -and
      [string]$_.CommandLine -match "novelight-commander"
    }
).Count
$TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue
$TunnelInfo = Get-ScheduledTaskInfo -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue
$TunnelLog = Join-Path $RuntimeRoot "openai-tunnel.log"

Write-Output ("bridge_daemon_processes: " + $BridgeDaemonCount)
Write-Output ("bridge_supervisor_processes: " + $BridgeRunnerCount)
Write-Output ("bridge_heartbeat_age_seconds: " + $(if ([double]::IsPositiveInfinity($BridgeHeartbeatAgeSeconds)) { "missing" } else { [Math]::Round($BridgeHeartbeatAgeSeconds, 1) }))
Write-Output ("bridge_heartbeat_status: " + $BridgeHeartbeat.status)
Write-Output ("bridge_heartbeat_failures: " + $BridgeHeartbeat.consecutivePollFailures)
Write-Output ("bridge_heartbeat_stale: " + $BridgeHeartbeatStale)
Write-Output ("bridge_heartbeat_degraded: " + $BridgeHeartbeatDegraded)
Write-Output ("bridge_busy_age_seconds: " + [Math]::Round($BridgeBusyAgeSeconds, 1))
Write-Output ("bridge_busy_timed_out: " + $BridgeBusyTimedOut)
Write-Output ("tunnel_supervisor_processes: " + $TunnelRunnerCount)
Write-Output ("tunnel_client_processes: " + $TunnelClientCount)
Write-Output ("nlo_tunnel_client_processes: " + $NloTunnelClientCount)
Write-Output ("tunnel_healthy: " + $TunnelHealthy)
Write-Output ("tunnel_task: " + $(if ($TunnelTask) { $TunnelTask.State } else { "missing" }))
Write-Output ("tunnel_last_result: " + $(if ($TunnelInfo) { $TunnelInfo.LastTaskResult } else { "missing" }))
Write-Output ("tunnel_last_run: " + $(if ($TunnelInfo) { $TunnelInfo.LastRunTime.ToString("o") } else { "missing" }))
Write-Output ("watchdog_log: " + $WatchdogLog)
if (Test-Path $TunnelLog) {
  Write-Output "tunnel_log_tail:"
  Get-Content -Path $TunnelLog -Tail 12 -ErrorAction SilentlyContinue |
    ForEach-Object {
      [regex]::Replace([string]$_, "(?i)((?:token|secret|password|api[_-]?key)\s*[=:]\s*)\S+", '$1[REDACTED]')
    } |
    Write-Output
}
