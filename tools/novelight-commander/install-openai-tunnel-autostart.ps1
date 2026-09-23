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

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $RunnerPath

$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Here
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentIdentity
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentIdentity -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "Keeps the NOVELIGHT Commander OpenAI Secure MCP Tunnel online." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName

Write-Host "NOVELIGHT Commander tunnel autostart installed."
Write-Host "Task: $($Task.TaskName)"
Write-Host "State: $($Task.State)"
Write-Host "LastTaskResult: $($Info.LastTaskResult)"
