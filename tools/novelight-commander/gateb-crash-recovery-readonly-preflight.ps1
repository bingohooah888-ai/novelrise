# Gate B crash/DPAPI boundary: read-only preflight ONLY. This is NOT approval to execute.
[CmdletBinding()]
param(
  [ValidateSet('Inspect', 'Apply')]
  [string]$Mode = 'Inspect'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Explicitly block mutation even when invoked by an administrator.
if ($Mode -eq 'Apply') {
  Write-Output 'GATEB_CRASH_REAL_EXECUTION_NOT_IMPLEMENTED'
  exit 4
}

$HostNameExpected = 'DESKTOP-8Q4GFC8'
$TargetUserName = 'NOVELIGHT-GateB'
$TaskNameExpected = 'NOVELIGHT-GateB-Independent-Recovery'
$WatchdogDirectory = 'C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$ExistingVault = 'C:\ProgramData\NOVELIGHT\GateB'
$WorkerExpectedSha256 = 'dd418a7a50854c54a182fd3042b8dfadd5b8da77f9c99d106aab4bd706c3e66f'
$AdminSid = 'S-1-5-32-544'
$SystemSid = 'S-1-5-18'
$TaskExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

try {
  if ($env:COMPUTERNAME -cne $HostNameExpected) { throw 'HOST' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'ADMIN_REQUIRED'
  }
  $targetUser = Get-LocalUser -Name $TargetUserName -ErrorAction Stop
  if (-not $targetUser.SID -or $targetUser.Enabled) { throw 'ACCOUNT_NOT_DISABLED' }
  $admins = @(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop)
  if (@($admins | Where-Object {
    $_.SID.Value -ceq $targetUser.SID.Value
  }).Count -ne 0) { throw 'ACCOUNT_IS_ADMIN' }

  $userProfiles = @(Get-CimInstance Win32_UserProfile -Filter (
    "SID='" + $targetUser.SID.Value + "'"
  ) -ErrorAction Stop)
  if ($userProfiles.Count -ne 0) { throw 'PROFILE_ALREADY_EXISTS' }

  $directory = Get-Item -LiteralPath $WatchdogDirectory -Force -ErrorAction Stop
  if (-not $directory.PSIsContainer -or
      ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'UNSAFE_WATCHDOG_DIRECTORY'
  }
  $acl = [IO.Directory]::GetAccessControl($WatchdogDirectory)
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid) {
    throw 'UNSAFE_WATCHDOG_ACL'
  }
  $rules = @($acl.GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]
  ))
  if ($rules.Count -ne 3) { throw 'ACL_RULE_COUNT' }
  foreach ($sid in @($AdminSid, $SystemSid, $targetUser.SID.Value)) {
    $matches = @($rules | Where-Object {
      $_.IdentityReference.Value -ceq $sid -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if ($matches.Count -ne 1) { throw 'ACL_IDENTITY' }
    $rights = $matches[0].FileSystemRights
    if ($sid -ceq $targetUser.SID.Value) {
      $flags = [Security.AccessControl.FileSystemRights]
      if (($rights -band $flags::ReadAndExecute) -ne $flags::ReadAndExecute -or
          ($rights -band $flags::Write) -ne 0 -or
          ($rights -band $flags::Delete) -ne 0 -or
          ($rights -band $flags::ChangePermissions) -ne 0 -or
          ($rights -band $flags::TakeOwnership) -ne 0) {
        throw 'WATCHDOG_WRITABLE_BY_TARGET'
      }
    } elseif (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
              [Security.AccessControl.FileSystemRights]::FullControl) {
      throw 'ADMIN_SYSTEM_ACL'
    }
  }
  $sidText = [IO.File]::ReadAllText(
    (Join-Path $WatchdogDirectory 'target-sid.txt')
  ).Trim()
  if ($sidText -cne $targetUser.SID.Value) { throw 'TARGET_SID_DRIFT' }
  $state = ConvertFrom-Json -InputObject (
    [IO.File]::ReadAllText((Join-Path $WatchdogDirectory 'state.json'))
  ) -ErrorAction Stop
  if ($state.version -ne 1 -or
      $state.host -cne $HostNameExpected -or
      $state.sid -cne $targetUser.SID.Value -or
      $state.taskName -cne $TaskNameExpected -or
      $state.phase -cne 'GUARD_ONLY') { throw 'NOT_GUARD_ONLY' }

  $ownedFiles = @('watchdog.ps1', 'target-sid.txt', 'state.json', 'heartbeat.json')
  $files = @([IO.Directory]::GetFileSystemEntries($WatchdogDirectory))
  if (@($files | Where-Object {
    [IO.Path]::GetFileName($_) -notin $ownedFiles
  }).Count -ne 0) { throw 'UNEXPECTED_WATCHDOG_FILES' }

  $installedWorker = Join-Path $WatchdogDirectory 'watchdog.ps1'
  if ((Get-FileHash -LiteralPath $installedWorker -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $WorkerExpectedSha256) { throw 'WORKER_HASH_DRIFT' }
  if (-not (Test-Path -LiteralPath $ExistingVault -PathType Container)) {
    throw 'VAULT_ABSENT'
  }
  if (@([IO.Directory]::GetFileSystemEntries($ExistingVault)).Count -ne 0) {
    throw 'VAULT_NOT_EMPTY'
  }

  $task = Get-ScheduledTask -TaskName $TaskNameExpected -TaskPath '\' -ErrorAction Stop
  if ($task.State -ne 'Ready' -or
      $task.Principal.UserId -notin @('SYSTEM', 'NT AUTHORITY\SYSTEM', 'S-1-5-18') -or
      $task.Principal.LogonType.ToString() -ne 'ServiceAccount') {
    throw 'TASK_NOT_READY_OR_NOT_SYSTEM'
  }
  $taskActions = @($task.Actions)
  $expectedArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    $installedWorker + '" -Mode Recover'
  if ($taskActions.Count -ne 1 -or
      $taskActions[0].Execute -ine $TaskExe -or
      $taskActions[0].Arguments -cne $expectedArguments) {
    throw 'TASK_ACTION_CHANGED'
  }
  $taskTriggers = @($task.Triggers)
  if ($taskTriggers.Count -ne 2) { throw 'TRIGGER_COUNT' }
  $repeating = @($taskTriggers | Where-Object {
    $_.CimClass.CimClassName -match 'TimeTrigger'
  })
  $startup = @($taskTriggers | Where-Object {
    $_.CimClass.CimClassName -match 'BootTrigger'
  })
  if ($repeating.Count -ne 1 -or $startup.Count -ne 1) {
    throw 'TRIGGER_TYPES_CHANGED'
  }
  $start = [DateTime]::Parse([string]$repeating[0].StartBoundary)
  $duration = [System.Xml.XmlConvert]::ToTimeSpan(
    [string]$repeating[0].Repetition.Duration
  )
  $interval = [System.Xml.XmlConvert]::ToTimeSpan(
    [string]$repeating[0].Repetition.Interval
  )
  if ($interval.TotalSeconds -ne 60 -or
      $duration.TotalDays -ne 7 -or
      $start.Add($duration) -lt (Get-Date).AddMinutes(30)) {
    throw 'WATCHDOG_TRIGGER_EXPIRED_OR_UNSAFE'
  }
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskNameExpected -TaskPath '\' -ErrorAction Stop
  if ($taskInfo.LastTaskResult -ne 0) { throw 'TASK_LAST_RUN_FAILED' }
  $hb = ConvertFrom-Json -InputObject (
    [IO.File]::ReadAllText((Join-Path $WatchdogDirectory 'heartbeat.json'))
  ) -ErrorAction Stop
  $stamp = [DateTime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
  if ($hb.version -ne 1 -or
      [int]$hb.sequence -lt 2 -or
      $hb.status -cne 'WATCHDOG_DISABLED_CONFIRMED' -or
      $hb.observedDisabled -ne $true -or
      $stamp -lt [DateTime]::UtcNow.AddSeconds(-150) -or
      $stamp -gt [DateTime]::UtcNow.AddSeconds(5)) {
    throw 'HEARTBEAT_NOT_FRESH_OR_DISABLED'
  }

  # Important: This is not a proof of killing an already-running process.
  Write-Output 'GATEB_CRASH_READONLY_PREFLIGHT_PASS_BUT_REAL_TEST_NO_GO'
  exit 0
} catch {
  # Never reveal SIDs, profile directories, task XML, error messages, secrets.
  Write-Output 'GATEB_CRASH_READONLY_PREFLIGHT_INCOMPLETE_NO_GO'
  exit 3
}
