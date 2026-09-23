param(
  [string]$TaskName = "NOVELIGHT Commander Tunnel"
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerPath = Join-Path $Here "run-openai-tunnel.ps1"
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\Commander"
$KeyPath = Join-Path $RuntimeRoot "control-plane-key.dpapi"

if (-not (Test-Path $RunnerPath)) {
  throw "run-openai-tunnel.ps1 is missing."
}
if (-not (Test-Path $KeyPath)) {
  throw "Encrypted tunnel credential is missing. Re-run configure-openai-tunnel.ps1 first."
}

$TunnelLauncher = Join-Path $RuntimeRoot "nlo-tunnel.vbs"
$TunnelCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $RunnerPath + '"'
$EscapedTunnelCommand = $TunnelCommand.Replace('"', '""')
$TunnelLauncherBody = 'CreateObject("WScript.Shell").Run "' + $EscapedTunnelCommand + '", 0, True'
Set-Content -Path $TunnelLauncher -Value $TunnelLauncherBody -Encoding ascii

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$WScript = (Get-Command wscript.exe -ErrorAction Stop).Source
$Arguments = '//B //NoLogo "{0}"' -f $TunnelLauncher

$Action = New-ScheduledTaskAction -Execute $WScript -Argument $Arguments -WorkingDirectory $Here
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentIdentity
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentIdentity -LogonType Interactive -RunLevel Limited

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "Keeps the NOVELIGHT Commander OpenAI Secure MCP Tunnel online without visible console windows." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName

Write-Host "NOVELIGHT Commander tunnel autostart installed."
Write-Host "Task: $($Task.TaskName)"
Write-Host "State: $($Task.State)"
Write-Host "LastTaskResult: $($Info.LastTaskResult)"
Write-Host "HiddenLauncher: $TunnelLauncher"
