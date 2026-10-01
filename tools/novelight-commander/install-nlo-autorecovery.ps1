param(
  [string]$TaskName = "NOVELIGHT Commander Watchdog",
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\Commander"
$BridgeRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\commander-bridge"
if (-not $ConfigPath) { $ConfigPath = Join-Path $BridgeRoot "config.json" }
$RepairScript = Join-Path $Here "repair-nlo-services.ps1"
$BridgeRunner = Join-Path $Here "run-github-bridge.ps1"
$TunnelKeyPath = Join-Path $RuntimeRoot "control-plane-key.dpapi"
$TunnelInstaller = Join-Path $Here "install-openai-tunnel-autostart.ps1"
$PluginAutoregisterScript = Join-Path $Here "src\chatgpt-plugin-autoregister.js"
$PluginStatePath = Join-Path $RuntimeRoot "chatgpt-plugin.json"

if (-not (Test-Path $RepairScript)) { throw "repair-nlo-services.ps1 is missing." }
if (-not (Test-Path $ConfigPath)) { throw "Bridge config file is missing." }

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

$TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue
if (-not $TunnelTask) {
  if (-not (Test-Path $TunnelKeyPath)) { throw "Encrypted tunnel credential is missing." }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TunnelInstaller
  if ($LASTEXITCODE -ne 0) { throw "Tunnel autostart installer failed with exit code $LASTEXITCODE." }
}

function Write-HiddenLauncher(
  [string]$Path,
  [string]$Command,
  [bool]$WaitForExit
) {
  $EscapedCommand = $Command.Replace('"', '""')
  $WaitLiteral = if ($WaitForExit) { "True" } else { "False" }
  $Body = 'CreateObject("WScript.Shell").Run "' + $EscapedCommand + '", 0, ' + $WaitLiteral
  Set-Content -Path $Path -Value $Body -Encoding ascii
}

$StartupDir = [Environment]::GetFolderPath("Startup")
$LegacyStartupFile = Join-Path $StartupDir "NOVELIGHT-Commander-Bridge.cmd"
$StartupFile = Join-Path $StartupDir "NOVELIGHT-Commander-Bridge.vbs"
$BridgeCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $BridgeRunner + '" -ConfigPath "' + $ConfigPath + '"'
Write-HiddenLauncher -Path $StartupFile -Command $BridgeCommand -WaitForExit $false
Remove-Item -Path $LegacyStartupFile -Force -ErrorAction SilentlyContinue

$WatchdogLauncher = Join-Path $RuntimeRoot "nlo-watchdog.vbs"
$WatchdogCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $RepairScript + '" -ConfigPath "' + $ConfigPath + '"'
Write-HiddenLauncher -Path $WatchdogLauncher -Command $WatchdogCommand -WaitForExit $true

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$WScript = (Get-Command wscript.exe -ErrorAction Stop).Source
$Arguments = '//B //NoLogo "{0}"' -f $WatchdogLauncher

$Action = New-ScheduledTaskAction -Execute $WScript -Argument $Arguments -WorkingDirectory $Here
$LogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentIdentity
$MinuteTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentIdentity -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($LogonTrigger, $MinuteTrigger) -Settings $Settings -Principal $Principal -Description "Repairs NOVELIGHT Commander Tunnel and GitHub Bridge every minute when needed." -Force | Out-Null

& $RepairScript -ConfigPath $ConfigPath

$PluginAutoregisterStarted = $false
$PluginAutoregisterTimedOut = $false
$PluginProcess = $null
if (Test-Path $PluginAutoregisterScript) {
  if (-not $env:NOVELIGHT_COMMANDER_TUNNEL_ID) {
    $SavedTunnelId = [Environment]::GetEnvironmentVariable("NOVELIGHT_COMMANDER_TUNNEL_ID", "User")
    if ($SavedTunnelId) { $env:NOVELIGHT_COMMANDER_TUNNEL_ID = $SavedTunnelId }
  }
  $Node = Get-Command node -ErrorAction SilentlyContinue
  if ($Node -and $env:NOVELIGHT_COMMANDER_TUNNEL_ID) {
    $PluginProcess = Start-Process -FilePath $Node.Source -ArgumentList @($PluginAutoregisterScript) -WindowStyle Hidden -PassThru
    $PluginAutoregisterStarted = $true
    $Deadline = (Get-Date).AddSeconds(90)
    while (-not $PluginProcess.HasExited -and (Get-Date) -lt $Deadline) {
      Start-Sleep -Milliseconds 500
      $PluginProcess.Refresh()
    }
    if (-not $PluginProcess.HasExited) {
      $PluginAutoregisterTimedOut = $true
      Stop-Process -Id $PluginProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

$PluginState = $null
if (Test-Path $PluginStatePath) {
  try {
    $PluginState = Get-Content -Raw -Path $PluginStatePath | ConvertFrom-Json
  } catch {
    $PluginState = $null
  }
}

$WatchdogTask = Get-ScheduledTask -TaskName $TaskName
$WatchdogInfo = Get-ScheduledTaskInfo -TaskName $TaskName
$TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue

Write-Output ("watchdog_task: " + $WatchdogTask.State)
Write-Output ("watchdog_last_result: " + $WatchdogInfo.LastTaskResult)
Write-Output ("tunnel_task: " + $(if ($TunnelTask) { $TunnelTask.State } else { "missing" }))
Write-Output ("bridge_startup_launcher: " + [bool](Test-Path $StartupFile))
Write-Output ("watchdog_hidden_launcher: " + [bool](Test-Path $WatchdogLauncher))
Write-Output ("chatgpt_plugin_autoregister_started: " + $PluginAutoregisterStarted)
Write-Output ("chatgpt_plugin_autoregister_timed_out: " + $PluginAutoregisterTimedOut)
Write-Output ("chatgpt_plugin_state_present: " + [bool]$PluginState)
Write-Output ("chatgpt_plugin_status: " + $(if ($PluginState) { [string]$PluginState.status } else { "unknown" }))
Write-Output ("chatgpt_plugin_id: " + $(if ($PluginState -and $PluginState.pluginId) { [string]$PluginState.pluginId } else { "none" }))
Write-Output ("chatgpt_plugin_installed: " + $(if ($PluginState -and $null -ne $PluginState.installed) { [string]$PluginState.installed } else { "unknown" }))
Write-Output ("chatgpt_plugin_profile: " + $(if ($PluginState -and $PluginState.profile) { [string]$PluginState.profile } else { "unknown" }))
Write-Output ("chatgpt_plugin_name_filled: " + $(if ($PluginState -and $PluginState.details -and $null -ne $PluginState.details.nameFilled) { [string]$PluginState.details.nameFilled } else { "unknown" }))
Write-Output ("chatgpt_plugin_description_filled: " + $(if ($PluginState -and $PluginState.details -and $null -ne $PluginState.details.descriptionFilled) { [string]$PluginState.details.descriptionFilled } else { "unknown" }))
Write-Output ("chatgpt_plugin_tunnel_filled: " + $(if ($PluginState -and $PluginState.details -and $null -ne $PluginState.details.tunnelFilled) { [string]$PluginState.details.tunnelFilled } else { "unknown" }))
Write-Output ("chatgpt_plugin_reason: " + $(if ($PluginState -and $PluginState.reason) { [string]$PluginState.reason } elseif ($PluginState -and $PluginState.error) { [string]$PluginState.error } else { "none" }))
Write-Output "autorecovery_installed: true"
