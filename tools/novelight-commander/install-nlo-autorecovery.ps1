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

if (-not (Test-Path $RepairScript)) { throw "repair-nlo-services.ps1 is missing." }
if (-not (Test-Path $ConfigPath)) { throw "Bridge config file is missing." }

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

$TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue
if (-not $TunnelTask) {
  if (-not (Test-Path $TunnelKeyPath)) { throw "Encrypted tunnel credential is missing." }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TunnelInstaller
  if ($LASTEXITCODE -ne 0) { throw "Tunnel autostart installer failed with exit code $LASTEXITCODE." }
}

$StartupDir = [Environment]::GetFolderPath("Startup")
$StartupFile = Join-Path $StartupDir "NOVELIGHT-Commander-Bridge.cmd"
$StartupBody = "@echo off" + [Environment]::NewLine + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $BridgeRunner + '" -ConfigPath "' + $ConfigPath + '"'
Set-Content -Path $StartupFile -Value $StartupBody -Encoding ascii

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -ConfigPath "{1}"' -f $RepairScript, $ConfigPath

$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Here
$LogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentIdentity
$MinuteTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentIdentity -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($LogonTrigger, $MinuteTrigger) -Settings $Settings -Principal $Principal -Description "Repairs NOVELIGHT Commander Tunnel and GitHub Bridge every minute when needed." -Force | Out-Null

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $RepairScript -ConfigPath $ConfigPath
if ($LASTEXITCODE -ne 0) { throw "Initial NLO autorecovery repair failed with exit code $LASTEXITCODE." }

$WatchdogTask = Get-ScheduledTask -TaskName $TaskName
$WatchdogInfo = Get-ScheduledTaskInfo -TaskName $TaskName
$TunnelTask = Get-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel" -ErrorAction SilentlyContinue

Write-Output ("watchdog_task: " + $WatchdogTask.State)
Write-Output ("watchdog_last_result: " + $WatchdogInfo.LastTaskResult)
Write-Output ("tunnel_task: " + $(if ($TunnelTask) { $TunnelTask.State } else { "missing" }))
Write-Output ("bridge_startup_launcher: " + [bool](Test-Path $StartupFile))
Write-Output "autorecovery_installed: true"
