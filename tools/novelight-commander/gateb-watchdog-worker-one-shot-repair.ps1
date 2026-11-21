# NOVELIGHT Gate B: one-shot repair of a PRE-EXISTING GUARD_ONLY task worker.
# Default Preflight is read-only. Never Arm, create a task, or enable an account.
[CmdletBinding()]
param(
  [ValidateSet('Preflight', 'Apply')]
  [string]$Mode = 'Preflight',
  [string]$OwnerApproval = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedHost = 'DESKTOP-8Q4GFC8'
$UserName = 'NOVELIGHT-GateB'
$TaskName = 'NOVELIGHT-GateB-Independent-Recovery'
$Root = 'C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$WorkerSource = Join-Path $PSScriptRoot 'gateb-recovery-watchdog-worker.ps1'
$InstalledWorker = Join-Path $Root 'watchdog.ps1'
$TemporaryWorker = Join-Path $Root 'watchdog.ps1.repair-new'
$BackupWorker = Join-Path $Root 'watchdog.ps1.repair-old'
$PowerShellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$OldWorkerSha256 = '766b91d8238572fcbbcefcc2edf825d0d32d29ae2e2bb6d9136845cc3bece5d5'
$NewWorkerSha256 = 'dd418a7a50854c54a182fd3042b8dfadd5b8da77f9c99d106aab4bd706c3e66f'
$AdminSid = 'S-1-5-32-544'
$SystemSid = 'S-1-5-18'
$RequiredApproval = 'REPAIR_ONE_EXISTING_GATEB_WATCHDOG_WORKER_AND_RESTART_TASK'

function Assert-HostAndUser {
  if ($env:COMPUTERNAME -cne $ExpectedHost) { throw 'WRONG_HOST' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'ADMIN_REQUIRED'
  }
  $user = Get-LocalUser -Name $UserName -ErrorAction Stop
  if ($user.Enabled -or -not $user.SID) { throw 'USER_NOT_DISABLED' }
  $admins = @(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop)
  if (@($admins | Where-Object {
      $_.SID.Value -ceq $user.SID.Value
    }).Count -ne 0) { throw 'ACCOUNT_IS_ADMIN' }
  $profiles = @(Get-CimInstance Win32_UserProfile -Filter (
    "SID='" + $user.SID.Value + "'"
  ) -ErrorAction Stop)
  if ($profiles.Count -ne 0) { throw 'USER_PROFILE_PRESENT' }
  return $user
}

function Assert-ProtectedFolder {
  param([string]$MemberSid)
  $dir = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if (-not $dir.PSIsContainer -or
      ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'UNSAFE_DIRECTORY'
  }
  $acl = [IO.Directory]::GetAccessControl($Root)
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid) {
    throw 'UNSAFE_OWNER_OR_INHERITANCE'
  }
  $rules = @($acl.GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]
  ))
  if ($rules.Count -ne 3) { throw 'UNSAFE_ACL_COUNT' }
  foreach ($sid in @($AdminSid, $SystemSid, $MemberSid)) {
    $hits = @($rules | Where-Object {
      $_.IdentityReference.Value -ceq $sid -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if ($hits.Count -ne 1) { throw 'UNSAFE_ACL_IDENTITIES' }
    $rights = $hits[0].FileSystemRights
    if ($sid -eq $MemberSid) {
      $flags = [Security.AccessControl.FileSystemRights]
      if (($rights -band $flags::ReadAndExecute) -ne $flags::ReadAndExecute -or
          ($rights -band $flags::Write) -ne 0 -or
          ($rights -band $flags::Delete) -ne 0 -or
          ($rights -band $flags::ChangePermissions) -ne 0 -or
          ($rights -band $flags::TakeOwnership) -ne 0) {
        throw 'TARGET_ACCOUNT_CAN_WRITE'
      }
    } elseif (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
              [Security.AccessControl.FileSystemRights]::FullControl) {
      throw 'ADMIN_SYSTEM_NOT_FULL'
    }
  }
}

function Assert-ExistingTask {
  $task = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
  $actions = @($task.Actions)
  $expectedArgs = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    $InstalledWorker + '" -Mode Recover'
  if ($actions.Count -ne 1 -or
      $actions[0].Execute -ine $PowerShellExe -or
      $actions[0].Arguments -cne $expectedArgs) {
    throw 'TASK_ACTION_DRIFT'
  }
  if ($task.Principal.UserId -notin @('SYSTEM', 'NT AUTHORITY\SYSTEM', 'S-1-5-18') -or
      $task.Principal.LogonType.ToString() -ne 'ServiceAccount' -or
      @($task.Triggers).Count -ne 2) {
    throw 'TASK_SCOPE_DRIFT'
  }
  if ($task.State -eq 'Disabled') { throw 'TASK_ALREADY_DISABLED' }
  return $task
}

function Assert-ExistingFiles {
  param([string]$UserSid)
  $sid = [IO.File]::ReadAllText((Join-Path $Root 'target-sid.txt')).Trim()
  if ($sid -cne $UserSid) { throw 'SID_DRIFT' }
  $state = ConvertFrom-Json -InputObject (
    [IO.File]::ReadAllText((Join-Path $Root 'state.json'))
  ) -ErrorAction Stop
  if ($state.version -ne 1 -or
      $state.host -cne $ExpectedHost -or
      $state.sid -cne $UserSid -or
      $state.taskName -cne $TaskName -or
      $state.phase -cne 'GUARD_ONLY') {
    throw 'STATE_DRIFT'
  }
  $allowed = @('watchdog.ps1', 'target-sid.txt', 'state.json', 'heartbeat.json')
  $entries = @([IO.Directory]::GetFileSystemEntries($Root))
  if (@($entries | Where-Object {
      [IO.Path]::GetFileName($_) -notin $allowed
    }).Count -gt 0) { throw 'UNEXPECTED_FILES' }
  foreach ($path in @($WorkerSource, $InstalledWorker)) {
    $file = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if ($file.PSIsContainer -or
        ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'UNSAFE_WORKER_FILE'
    }
  }
  if ((Get-FileHash -LiteralPath $InstalledWorker -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $OldWorkerSha256) { throw 'INSTALLED_WORKER_NOT_OLD_PINNED_VERSION' }
  if ((Get-FileHash -LiteralPath $WorkerSource -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $NewWorkerSha256) { throw 'NEW_WORKER_SOURCE_HASH_DRIFT' }
  if ([IO.File]::Exists($TemporaryWorker) -or [IO.File]::Exists($BackupWorker)) {
    throw 'REPAIR_LEFTOVERS_EXIST'
  }
}

$stage = 'READONLY_PREFLIGHT'
try {
  $user = Assert-HostAndUser
  Assert-ProtectedFolder -MemberSid $user.SID.Value
  $task = Assert-ExistingTask
  Assert-ExistingFiles -UserSid $user.SID.Value

  if ($Mode -eq 'Preflight') {
    Write-Output 'GATEB_WATCHDOG_REPAIR_PREFLIGHT_READY_NO_MUTATION'
    exit 0
  }
  if ($OwnerApproval -cne $RequiredApproval) {
    throw 'NEW_SCOPED_OWNER_APPROVAL_REQUIRED'
  }

  # Only one invocation of Apply, with no retries on any partial failure.
  $stage = 'DISABLE_ONLY_PINNED_TASK'
  Disable-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop | Out-Null

  $stage = 'WAIT_PINNED_TASK_NOT_RUNNING'
  $stopped = $false
  for ($i = 0; $i -lt 10; $i++) {
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
    if ($existing.State -eq 'Running') {
      Stop-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
    } else {
      $stopped = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $stopped) { throw 'TASK_NOT_STOPPED' }
  if ((Get-LocalUser -Name $UserName -ErrorAction Stop).Enabled) {
    throw 'TARGET_ENABLED_AFTER_STOP'
  }

  $stage = 'STAGE_NEW_WORKER_INSIDE_PROTECTED_DIRECTORY'
  [IO.File]::Copy($WorkerSource, $TemporaryWorker, $false)
  if ((Get-FileHash -LiteralPath $TemporaryWorker -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $NewWorkerSha256) { throw 'STAGED_WORKER_HASH_MISMATCH' }

  $stage = 'ATOMIC_WORKER_SWAP_WITH_BACKUP'
  [IO.File]::Replace($TemporaryWorker, $InstalledWorker, $BackupWorker)
  if ((Get-FileHash -LiteralPath $InstalledWorker -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $NewWorkerSha256) { throw 'REPLACED_WORKER_HASH_MISMATCH' }
  if ((Get-FileHash -LiteralPath $BackupWorker -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $OldWorkerSha256) { throw 'BACKUP_OLD_WORKER_MISMATCH' }

  # Backup stays protected until the successful first SYSTEM heartbeat.
  $stage = 'ENABLE_ONLY_EXISTING_TASK'
  Enable-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop | Out-Null
  if ((Get-LocalUser -Name $UserName -ErrorAction Stop).Enabled) {
    throw 'TARGET_USER_ENABLED'
  }

  $stage = 'START_ONLY_EXISTING_TASK_ONCE'
  Start-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop

  $stage = 'VERIFY_FIRST_INDEPENDENT_SYSTEM_HEARTBEAT'
  $proof = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    $heartbeatPath = Join-Path $Root 'heartbeat.json'
    if (-not [IO.File]::Exists($heartbeatPath)) { continue }
    try {
      $hb = ConvertFrom-Json -InputObject (
        [IO.File]::ReadAllText($heartbeatPath)
      ) -ErrorAction Stop
      $when = [DateTime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
      if ($hb.version -eq 1 -and
          [int]$hb.sequence -ge 1 -and
          $hb.status -ceq 'WATCHDOG_DISABLED_CONFIRMED' -and
          $hb.observedDisabled -eq $true -and
          $when -gt [DateTime]::UtcNow.AddSeconds(-25)) {
        $proof = $true
        break
      }
    } catch {
      # Do not print raw state/errors or issue a second task start.
    }
  }
  if (-not $proof) { throw 'SYSTEM_HEARTBEAT_NOT_ATTESTED' }

  $stage = 'REMOVE_ONLY_EXACT_TEMPORARY_BACKUP'
  if ((Get-FileHash -LiteralPath $BackupWorker -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $OldWorkerSha256) { throw 'BACKUP_CHANGED' }
  [IO.File]::Delete($BackupWorker)
  if ([IO.File]::Exists($BackupWorker) -or
      [IO.File]::Exists($TemporaryWorker) -or
      (Get-LocalUser -Name $UserName -ErrorAction Stop).Enabled) {
    throw 'REPAIR_RESIDUE_OR_ENABLED_ACCOUNT'
  }
  Write-Output 'GATEB_WATCHDOG_EXISTING_WORKER_REPAIRED_FIRST_HEARTBEAT_PASS'
  exit 0
} catch {
  Write-Output ('GATEB_WATCHDOG_REPAIR_FAILED_STAGE=' + $stage)
  Write-Output 'GATEB_WATCHDOG_REPAIR_STOP_NO_RETRY_MANUAL_RECONCILIATION'
  exit 3
}
