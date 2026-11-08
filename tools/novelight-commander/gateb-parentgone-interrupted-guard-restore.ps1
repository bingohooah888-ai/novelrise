# NOVELIGHT Gate B — future manual recovery ONLY after an interrupted synthetic test.
# This script is an offline code candidate, NOT authorization to touch installed OS state.
# Default Inspect performs no mutations. Restore needs a separately approved one-shot owner command.
[CmdletBinding()]
param(
  [ValidateSet('Inspect', 'Restore')][string]$Mode = 'Inspect',
  [string]$OwnerApproval = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedHost = 'DESKTOP-8Q4GFC8'
$Target = 'NOVELIGHT-GateB'
$TaskName = 'NOVELIGHT-GateB-Independent-Recovery'
$Root = 'C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$StatePath = Join-Path $Root 'state.json'
$Original = Join-Path $Root 'state.json.parentgone-original'
$RestoreStage = Join-Path $Root 'state.json.parentgone-restore-stage'
$GuardedBackup = Join-Path $Root 'state.json.parentgone-guarded-backup'
$Ledger = Join-Path $Root 'parentgone-once-consumed.marker'
$InstalledWorker = Join-Path $Root 'watchdog.ps1'
$WorkerSha256 = '78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$Approval = 'RESTORE_ONE_GATEB_PARENTGONE_GUARD_STATE_AFTER_INTERRUPTED_TRIAL'
$FakePid = [int]::MaxValue
$StageName = 'INSPECT'
$Started = $false

function Is-SafeFile([string]$Path) {
  $f = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  return (-not $f.PSIsContainer -and
    ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)
}
function Assert-FixedState($State,[string]$Sid,[string]$ExpectedPhase) {
  $required = @('version','host','sid','taskName','phase',
    'deadlineUtc','parentPid','parentStartUtc')
  $keys = @($State.PSObject.Properties.Name)
  if ($keys.Count -ne $required.Count -or
      @($keys | Where-Object { $_ -notin $required }).Count -ne 0 -or
      $State.version -ne 1 -or
      $State.host -cne $ExpectedHost -or
      $State.sid -cne $Sid -or
      $State.taskName -cne $TaskName -or
      $State.phase -cne $ExpectedPhase -or
      [string]$State.deadlineUtc -notmatch 'Z$') {
    throw 'STATE_NOT_PINNED'
  }
  if ($ExpectedPhase -ceq 'GUARD_ONLY') {
    if ([int]$State.parentPid -ne 0 -or
        [string]$State.parentStartUtc -cne '') { throw 'BASELINE_NOT_GUARD' }
  } else {
    if ([int]$State.parentPid -ne $FakePid -or
        [string]$State.parentStartUtc -cne '1900-01-01T00:00:00Z') {
      throw 'NOT_SYNTHETIC_PARENT'
    }
  }
}
try {
  $StageName = 'IDENTITY'
  $admin = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
  )
  if ($env:COMPUTERNAME -cne $ExpectedHost -or
      -not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'HOST_OR_ADMIN_MISMATCH'
  }
  $user = Get-LocalUser -Name $Target -ErrorAction Stop
  if ($user.Enabled -or -not $user.SID) { throw 'USER_NOT_DISABLED' }
  $sid = $user.SID.Value
  $members = @(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop)
  if (@($members | Where-Object { $_.SID.Value -ceq $sid }).Count -ne 0) {
    throw 'USER_IS_ADMIN'
  }
  if (@(Get-CimInstance Win32_UserProfile -Filter ("SID='" + $sid + "'") -ErrorAction Stop).Count -ne 0) {
    throw 'PROFILE_EXISTS'
  }
  $rootItem = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if (-not $rootItem.PSIsContainer -or
      ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'ROOT_PATH_UNTRUSTED'
  }
  $acl = [IO.Directory]::GetAccessControl($Root)
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne 'S-1-5-32-544') {
    throw 'ACL_OWNER_DRIFT'
  }
  $entries = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if ($entries.Count -ne 3) { throw 'ACL_COUNT_CHANGED' }
  foreach ($entrySid in @('S-1-5-32-544','S-1-5-18',$sid)) {
    $rule = @($entries | Where-Object {
      $_.IdentityReference.Value -ceq $entrySid -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if ($rule.Count -ne 1) { throw 'ACL_IDENTITY_DRIFT' }
    if ($entrySid -ceq $sid) {
      $flags = [Security.AccessControl.FileSystemRights]
      if (($rule[0].FileSystemRights -band $flags::Write) -ne 0 -or
          ($rule[0].FileSystemRights -band $flags::Delete) -ne 0 -or
          ($rule[0].FileSystemRights -band $flags::ChangePermissions) -ne 0 -or
          ($rule[0].FileSystemRights -band $flags::TakeOwnership) -ne 0) {
        throw 'TARGET_ACL_WRITABLE'
      }
    } elseif (($rule[0].FileSystemRights -band
      [Security.AccessControl.FileSystemRights]::FullControl) -ne
      [Security.AccessControl.FileSystemRights]::FullControl) {
      throw 'ADMIN_SYSTEM_ACL_DRIFT'
    }
  }
  if (-not (Is-SafeFile $InstalledWorker) -or
      (Get-FileHash -LiteralPath $InstalledWorker -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $WorkerSha256) { throw 'WORKER_CHANGED' }
  if ([IO.File]::ReadAllText((Join-Path $Root 'target-sid.txt')).Trim() -cne $sid) {
    throw 'SID_DRIFT'
  }
  $task = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
  if ($task.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or
      $task.Principal.LogonType.ToString() -cne 'ServiceAccount' -or
      $task.State -notin @('Ready','Running')) {
    throw 'SYSTEM_WATCHDOG_NOT_ACTIVE'
  }
  $taskActions = @($task.Actions)
  $taskExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $taskArgs = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    $InstalledWorker + '" -Mode Recover'
  if ($taskActions.Count -ne 1 -or $taskActions[0].Execute -ine $taskExe -or
      $taskActions[0].Arguments -cne $taskArgs) {
    throw 'WATCHDOG_ACTION_DRIFT'
  }

  $StageName = 'TRIAL_MATERIAL'
  $knownFiles = @('watchdog.ps1','heartbeat.json','target-sid.txt','state.json',
    'state.json.parentgone-original','state.json.parentgone-guarded-backup',
    'state.json.parentgone-arm-stage','state.json.parentgone-restore-stage',
    'parentgone-once-consumed.marker')
  $present = @([IO.Directory]::GetFileSystemEntries($Root) | ForEach-Object {
    [IO.Path]::GetFileName($_)
  })
  if (@($present | Where-Object { $_ -notin $knownFiles }).Count -ne 0) {
    throw 'UNEXPECTED_WATCHDOG_FILES'
  }
  foreach ($path in @($StatePath,$Original,$Ledger)) {
    if (-not (Is-SafeFile $path)) { throw 'TRIAL_FILE_UNTRUSTED' }
  }
  if ([IO.File]::ReadAllText($Ledger).Trim() -cne 'GATEB_PARENTGONE_CONSUMED') {
    throw 'ONE_SHOT_LEDGER_MISMATCH'
  }
  $originalState = [IO.File]::ReadAllText($Original) | ConvertFrom-Json -ErrorAction Stop
  Assert-FixedState $originalState $sid 'GUARD_ONLY'
  $currentState = [IO.File]::ReadAllText($StatePath) | ConvertFrom-Json -ErrorAction Stop
  $originalSha = (Get-FileHash -LiteralPath $Original -Algorithm SHA256).Hash.ToLowerInvariant()
  $currentSha = (Get-FileHash -LiteralPath $StatePath -Algorithm SHA256).Hash.ToLowerInvariant()

  $modeState = 'UNVERIFIED'
  if ($currentSha -ceq $originalSha) {
    Assert-FixedState $currentState $sid 'GUARD_ONLY'
    $modeState = 'ALREADY_GUARD_ONLY'
  } else {
    Assert-FixedState $currentState $sid 'GUARDED_TEST'
    if ([IO.File]::Exists($RestoreStage) -or [IO.File]::Exists($GuardedBackup)) {
      throw 'UNKNOWN_RESTORATION_RESIDUE'
    }
    $modeState = 'SYNTHETIC_GUARDED_STATE'
  }
  if ($Mode -eq 'Inspect') {
    Write-Output ('GATEB_PARENTGONE_RESTORE_INSPECT=' + $modeState)
    Write-Output 'GATEB_PARENTGONE_RESTORE_NO_MUTATION'
    exit 0
  }
  if ($OwnerApproval -cne $Approval) { throw 'NEW_RESTORE_APPROVAL_REQUIRED' }
  if ($modeState -ceq 'ALREADY_GUARD_ONLY') {
    Write-Output 'GATEB_PARENTGONE_GUARD_ALREADY_RESTORED_NO_MUTATION'
    exit 0
  }
  $StageName = 'ATOMIC_RESTORE_ONE_STATE'
  $Started = $true
  [IO.File]::Copy($Original,$RestoreStage,$false)
  [IO.File]::Replace($RestoreStage,$StatePath,$GuardedBackup)
  if ((Get-FileHash -LiteralPath $StatePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $originalSha -or (Get-LocalUser -Name $Target -ErrorAction Stop).Enabled) {
    throw 'RESTORE_NOT_VERIFIED'
  }
  Write-Output 'GATEB_PARENTGONE_ONE_STATE_GUARD_RESTORED'
  Write-Output 'GATEB_PARENTGONE_BACKUPS_RETAINED_MANUAL_CENSUS_REQUIRED'
  exit 0
} catch {
  Write-Output ('GATEB_PARENTGONE_RESTORE_STOP_STAGE=' + $StageName)
  if ($Started) {
    Write-Output 'GATEB_PARENTGONE_RESTORE_ATTEMPT_CONSUMED_NO_RETRY'
  } else {
    Write-Output 'GATEB_PARENTGONE_RESTORE_NOT_STARTED'
  }
  Write-Output 'GATEB_PARENTGONE_RESTORE_NO_GO'
  exit 3
}
