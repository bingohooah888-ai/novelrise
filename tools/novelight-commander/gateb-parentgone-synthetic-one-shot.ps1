# NOVELIGHT Gate B: FUTURE one-shot, disabled-account synthetic parent-gone test.
# NO AUTHORIZATION TO EXECUTE APPLY FROM THIS PR. Default Preflight is read-only.
[CmdletBinding()]
param(
  [ValidateSet('Preflight', 'Apply')][string]$Mode = 'Preflight',
  [string]$OwnerApproval = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ExpectedHost = 'DESKTOP-8Q4GFC8'
$TargetUser = 'NOVELIGHT-GateB'
$TaskName = 'NOVELIGHT-GateB-Independent-Recovery'
$Root = 'C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Vault = 'C:\ProgramData\NOVELIGHT\GateB'
$StatePath = Join-Path $Root 'state.json'
$HbPath = Join-Path $Root 'heartbeat.json'
$WorkerPath = Join-Path $Root 'watchdog.ps1'
$WorkerSha256 = '78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$TaskExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$AdminSid = 'S-1-5-32-544'
$SystemSid = 'S-1-5-18'
$FakePid = [int]::MaxValue
$RequiredApproval = 'ONE_DISABLED_GATEB_SYNTHETIC_PARENT_GONE_STATE_TRIAL'
$ArmStage = Join-Path $Root 'state.json.parentgone-arm-stage'
$OriginalBackup = Join-Path $Root 'state.json.parentgone-original'
$RestoreStage = Join-Path $Root 'state.json.parentgone-restore-stage'
$GuardedBackup = Join-Path $Root 'state.json.parentgone-guarded-backup'
$Ledger = Join-Path $Root 'parentgone-once-consumed.marker'
$Step = 'INITIAL'
$Consumed = $false
$ArmAttempted = $false
$Restored = $false
$Failed = $false
$UserSid = ''
$OriginalHash = ''
$ArmedHash = ''
$BaselineSequence = 0
$BaselineUtc = [DateTime]::MinValue
$ParentWitness = $null
$NloBaseline = @{}
$NloTaskNames = @('NOVELIGHT Commander Control Rollover', 'NOVELIGHT Commander Tunnel', 'NOVELIGHT Commander Watchdog')

function Assert-DisabledAccount {
  $user = Get-LocalUser -Name $TargetUser -ErrorAction Stop
  if (-not $user.SID -or $user.Enabled) { throw 'TARGET_MUST_BE_DISABLED' }
  if ($UserSid -ne '' -and $user.SID.Value -cne $UserSid) {
    throw 'TARGET_SID_DRIFT'
  }
  $admins = @(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop)
  if (@($admins | Where-Object { $_.SID.Value -ceq $user.SID.Value }).Count -ne 0) {
    throw 'TARGET_IS_ADMIN'
  }
  $profiles = @(Get-CimInstance Win32_UserProfile -Filter (
    "SID='" + $user.SID.Value + "'"
  ) -ErrorAction Stop)
  if ($profiles.Count -ne 0) { throw 'TARGET_PROFILE_RESIDUE' }
  return $user
}

function Assert-NoTargetProcess {
  # Read-only owner-SID census. Unknown process ownership is a NO-GO.
  # This may fail on protected Windows processes; never infer a zero count.
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  foreach ($process in $processes) {
    try {
      $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop
      if ($owner.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace([string]$owner.Sid)) { throw 'PROCESS_OWNER_NOT_VERIFIED' }
      if ([string]$owner.Sid -ceq $UserSid) {
        throw 'GATEB_USER_PROCESS_REMAINS'
      }
    } catch {
      # The process may have exited between census and owner lookup;
      # without an independent zero-census it must still fail closed.
      throw 'PROCESS_OWNER_CENSUS_UNVERIFIED'
    }
  }
}

function Assert-TrustedRoot([string]$memberSid) {
  $item = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'UNSAFE_ROOT'
  }
  $acl = [IO.Directory]::GetAccessControl($Root)
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid) {
    throw 'UNSAFE_ROOT_ACL'
  }
  $rules = @($acl.GetAccessRules($true, $true,
    [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 3) { throw 'ACL_COUNT_CHANGED' }
  foreach ($entrySid in @($AdminSid, $SystemSid, $memberSid)) {
    $matches = @($rules | Where-Object {
      $_.IdentityReference.Value -ceq $entrySid -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if ($matches.Count -ne 1) { throw 'ACL_IDENTITY_CHANGED' }
    $rights = $matches[0].FileSystemRights
    if ($entrySid -ceq $memberSid) {
      $flags = [Security.AccessControl.FileSystemRights]
      if (($rights -band $flags::ReadAndExecute) -ne $flags::ReadAndExecute -or
          ($rights -band $flags::Write) -ne 0 -or
          ($rights -band $flags::Delete) -ne 0 -or
          ($rights -band $flags::ChangePermissions) -ne 0 -or
          ($rights -band $flags::TakeOwnership) -ne 0) {
        throw 'TARGET_CAN_MODIFY_WATCHDOG'
      }
    } elseif (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
              [Security.AccessControl.FileSystemRights]::FullControl) {
      throw 'ADMIN_OR_SYSTEM_NOT_FULL'
    }
  }
}

function Assert-NloDefinitions([bool]$TakeBaseline) {
  $tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object {
    $_.TaskName -in $NloTaskNames
  })
  if ($tasks.Count -ne 3) { throw 'NLO_TASK_COUNT_CHANGED' }
  $names = @($tasks | Select-Object -ExpandProperty TaskName | Sort-Object)
  if (@(Compare-Object ($NloTaskNames | Sort-Object) $names).Count -ne 0) {
    throw 'NLO_TASK_IDENTITY_CHANGED'
  }
  foreach ($t in $tasks) {
    $definition = Export-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction Stop
    if ($TakeBaseline) {
      $script:NloBaseline[$t.TaskName] = $definition
    } elseif (-not $NloBaseline.ContainsKey($t.TaskName) -or
              $NloBaseline[$t.TaskName] -cne $definition) {
      throw 'NLO_TASK_DEFINITION_CHANGED'
    }
  }
}

function Assert-TrustedTask {
  $task = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
  $action = @($task.Actions)
  $expectedArgs = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    $WorkerPath + '" -Mode Recover'
  if ($task.State -ne 'Ready' -or
      $task.Principal.UserId -notin @('SYSTEM', 'NT AUTHORITY\SYSTEM', 'S-1-5-18') -or
      $task.Principal.LogonType.ToString() -cne 'ServiceAccount' -or
      $action.Count -ne 1 -or
      $action[0].Execute -ine $TaskExe -or
      $action[0].Arguments -cne $expectedArgs) {
    throw 'TASK_SCOPE_DRIFT'
  }
  $triggers = @($task.Triggers)
  $once = @($triggers | Where-Object { $_.CimClass.CimClassName -match 'TimeTrigger' })
  $boot = @($triggers | Where-Object { $_.CimClass.CimClassName -match 'BootTrigger' })
  if ($triggers.Count -ne 2 -or $once.Count -ne 1 -or $boot.Count -ne 1) {
    throw 'TASK_TRIGGER_DRIFT'
  }
  $interval = [Xml.XmlConvert]::ToTimeSpan([string]$once[0].Repetition.Interval)
  $duration = [Xml.XmlConvert]::ToTimeSpan([string]$once[0].Repetition.Duration)
  $start = [DateTime]::Parse([string]$once[0].StartBoundary)
  if ($interval.TotalSeconds -ne 60 -or $duration.TotalDays -ne 7 -or
      $start.Add($duration) -le (Get-Date).AddMinutes(30)) {
    throw 'WATCHDOG_REPETITION_EXPIRING'
  }
  $last = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
  if ($last.LastTaskResult -ne 0) { throw 'WATCHDOG_TASK_LAST_RUN_FAILED' }
}

function Read-Heartbeat {
  $hb = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($HbPath)) -ErrorAction Stop
  $stamp = [DateTime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
  if ($hb.version -ne 1 -or [int]$hb.sequence -lt 2 -or
      $hb.status -cne 'WATCHDOG_DISABLED_CONFIRMED' -or
      $hb.observedDisabled -ne $true -or
      $hb.accountWasEnabledBefore -ne $false -or
      $hb.disableAttempted -ne $false -or
      $hb.disableOutcome -cne 'ALREADY_DISABLED' -or
      $stamp -lt [DateTime]::UtcNow.AddSeconds(-150) -or
      $stamp -gt [DateTime]::UtcNow.AddSeconds(5)) {
    throw 'BAD_HEARTBEAT'
  }
  return $hb
}

function Wait-Reason([string]$reason, [int]$afterSequence,
    [datetime]$afterUtc) {
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Seconds 2
    $null = Assert-DisabledAccount
    try {
      $hb = Read-Heartbeat
      $stamp = [DateTime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
      if ([int]$hb.sequence -gt $afterSequence -and
          $stamp -gt $afterUtc -and $hb.reasonCode -ceq $reason) {
        return $hb
      }
    } catch {
      # Transient read/error is not proof. Never retry the Apply.
    }
  }
  return $null
}

function Assert-Baseline {
  if ($env:COMPUTERNAME -cne $ExpectedHost) { throw 'HOST_MISMATCH' }
  $principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'ADMIN_REQUIRED'
  }
  if ((Get-Service Schedule -ErrorAction Stop).Status -ne 'Running') {
    throw 'SCHEDULER_NOT_RUNNING'
  }
  $user = Assert-DisabledAccount
  $script:UserSid = $user.SID.Value
  Assert-NoTargetProcess
  Assert-TrustedRoot -memberSid $UserSid
  Assert-NloDefinitions -TakeBaseline $true
  Assert-TrustedTask
  $ownedFiles = @('watchdog.ps1','target-sid.txt','state.json','heartbeat.json')
  $entries = @([IO.Directory]::GetFileSystemEntries($Root) | ForEach-Object {
    [IO.Path]::GetFileName($_)
  })
  if (@($entries | Where-Object { $_ -notin $ownedFiles }).Count -ne 0) {
    throw 'UNKNOWN_PROTECTED_FILES_OR_SPENT_LEDGER'
  }
  foreach ($path in @($StatePath,$HbPath,$WorkerPath)) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if ($item.PSIsContainer -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'UNSAFE_PROTECTED_FILE'
    }
  }
  if ((Get-FileHash -LiteralPath $WorkerPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $WorkerSha256) { throw 'WORKER_HASH_MISMATCH' }
  if ([IO.File]::ReadAllText((Join-Path $Root 'target-sid.txt')).Trim() -cne
      $UserSid) { throw 'SID_FILE_DRIFT' }
  $state = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($StatePath)) -ErrorAction Stop
  $expectedKeys = @('version','host','sid','taskName','phase',
    'deadlineUtc','parentPid','parentStartUtc')
  $keys = @($state.PSObject.Properties.Name)
  if ($keys.Count -ne $expectedKeys.Count -or
      @($keys | Where-Object { $_ -notin $expectedKeys }).Count -ne 0 -or
      $state.version -ne 1 -or $state.host -cne $ExpectedHost -or
      $state.sid -cne $UserSid -or $state.taskName -cne $TaskName -or
      $state.phase -cne 'GUARD_ONLY' -or [int]$state.parentPid -ne 0 -or
      [string]$state.parentStartUtc -cne '' -or
      $state.deadlineUtc -notmatch 'Z$') {
    throw 'GUARD_STATE_MISMATCH'
  }
  if (-not [IO.Directory]::Exists($Vault) -or
      @([IO.Directory]::GetFileSystemEntries($Vault)).Count -ne 0) {
    throw 'GATEB_VAULT_NOT_EMPTY'
  }
  if ($null -ne (Get-Process -Id $FakePid -ErrorAction SilentlyContinue)) {
    throw 'SYNTHETIC_PID_ALREADY_OCCUPIED'
  }
  $hb = Read-Heartbeat
  if ($hb.reasonCode -cne 'GUARD_ONLY') { throw 'GUARD_HEARTBEAT_NOT_VERIFIED' }
  $script:BaselineSequence = [int]$hb.sequence
  $script:BaselineUtc = [DateTime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
  $script:OriginalHash = (Get-FileHash -LiteralPath $StatePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

try {
  $Step = 'READONLY_PREFLIGHT'
  Assert-Baseline
  if ($Mode -eq 'Preflight') {
    Write-Output 'GATEB_PARENTGONE_PREFLIGHT_READY_NO_MUTATION'
    exit 0
  }
  if ($OwnerApproval -cne $RequiredApproval) { throw 'ONE_SHOT_OWNER_APPROVAL_REQUIRED' }

  # An intentionally retained, non-secret ledger prevents replay of this fixed test.
  $Step = 'CONSUME_ONE_SHOT_LEDGER'
  $Consumed = $true
  $stream = [IO.File]::Open($Ledger,'CreateNew','Write','None')
  try {
    $marker = [Text.Encoding]::ASCII.GetBytes('GATEB_PARENTGONE_CONSUMED')
    $stream.Write($marker,0,$marker.Length)
  } finally { $stream.Dispose() }

  $Step = 'STAGE_SYNTHETIC_MISSING_PARENT'
  if ((Get-FileHash -LiteralPath $StatePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $OriginalHash) { throw 'STATE_CHANGED_BEFORE_ARM' }
  $armTime = [DateTime]::UtcNow
  $obj = [ordered]@{
    version = 1
    host = $ExpectedHost
    sid = $UserSid
    taskName = $TaskName
    phase = 'GUARDED_TEST'
    deadlineUtc = $armTime.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ssZ')
    parentPid = $FakePid
    parentStartUtc = '1900-01-01T00:00:00Z'
  }
  $json = ConvertTo-Json -InputObject $obj -Compress
  [IO.File]::WriteAllText($ArmStage,$json,(New-Object Text.UTF8Encoding($false)))
  $ArmedHash = (Get-FileHash -LiteralPath $ArmStage -Algorithm SHA256).Hash.ToLowerInvariant()
  $null = Assert-DisabledAccount

  # Atomic state mutation; backup is protected under the existing root ACL.
  $Step = 'ARM_ONLY_STATE_WITH_ATOMIC_BACKUP'
  $ArmAttempted = $true
  [IO.File]::Replace($ArmStage,$StatePath,$OriginalBackup)
  if ((Get-FileHash -LiteralPath $OriginalBackup -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $OriginalHash -or
      (Get-FileHash -LiteralPath $StatePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      $ArmedHash) { throw 'ARMED_STATE_HASH_DRIFT' }

  $Step = 'OBSERVE_INDEPENDENT_PARENT_GONE_HEARTBEAT'
  $ParentWitness = Wait-Reason -reason 'PARENT_GONE' -afterSequence $BaselineSequence -afterUtc $armTime
  if ($null -eq $ParentWitness) { throw 'PARENT_GONE_WITNESS_MISSING' }
  $null = Assert-DisabledAccount
} catch {
  $Failed = $true
} finally {
  if ($ArmAttempted) {
    # Exactly one Guard-only restoration attempt; never clobber unknown state.
    try {
      $Step = 'ATOMIC_GUARD_ONLY_RESTORE'
      $current = (Get-FileHash -LiteralPath $StatePath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($current -cne $OriginalHash) {
        if ($current -cne $ArmedHash -or
            -not [IO.File]::Exists($OriginalBackup) -or
            (Get-FileHash -LiteralPath $OriginalBackup -Algorithm SHA256).Hash.ToLowerInvariant() -cne
            $OriginalHash) { throw 'UNKNOWN_STATE_MUST_NOT_OVERWRITE' }
        [IO.File]::Copy($OriginalBackup,$RestoreStage,$false)
        [IO.File]::Replace($RestoreStage,$StatePath,$GuardedBackup)
      }
      if ((Get-FileHash -LiteralPath $StatePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
          $OriginalHash) { throw 'ORIGINAL_GUARD_NOT_RESTORED' }
      $null = Assert-DisabledAccount
      Assert-NoTargetProcess
      $Restored = $true
    } catch {
      $Failed = $true
      $Restored = $false
    }
  }
}

if ($Mode -eq 'Apply' -and $Restored) {
  try {
    $Step = 'OBSERVE_POSTRESTORE_GUARD_HEARTBEAT'
    $seq = $BaselineSequence
    $time = $BaselineUtc
    if ($null -ne $ParentWitness) {
      $seq = [int]$ParentWitness.sequence
      $time = [DateTime]::Parse([string]$ParentWitness.checkedUtc).ToUniversalTime()
    }
    $guard = Wait-Reason -reason 'GUARD_ONLY' -afterSequence $seq -afterUtc $time
    if ($null -eq $guard) { throw 'GUARD_WITNESS_MISSING' }
    $null = Assert-DisabledAccount
    Assert-NoTargetProcess
    Assert-NloDefinitions -TakeBaseline $false
    if (@([IO.Directory]::GetFileSystemEntries($Vault)).Count -ne 0) {
      throw 'VAULT_RESIDUE'
    }
    if ($Failed) { throw 'PARENT_WITNESS_NOT_PROVEN' }
    $Step = 'REMOVE_ONLY_OWNED_BACKUPS'
    if (-not [IO.File]::Exists($OriginalBackup) -or
        -not [IO.File]::Exists($GuardedBackup) -or
        (Get-FileHash -LiteralPath $OriginalBackup -Algorithm SHA256).Hash.ToLowerInvariant() -cne
        $OriginalHash -or
        (Get-FileHash -LiteralPath $GuardedBackup -Algorithm SHA256).Hash.ToLowerInvariant() -cne
        $ArmedHash) {
      throw 'BACKUP_HASH_UNVERIFIED'
    }
    [IO.File]::Delete($OriginalBackup)
    [IO.File]::Delete($GuardedBackup)
    if ([IO.File]::Exists($ArmStage) -or
        [IO.File]::Exists($RestoreStage) -or
        [IO.File]::Exists($OriginalBackup) -or
        [IO.File]::Exists($GuardedBackup)) { throw 'TEMPORARY_FILE_RESIDUE' }
    Write-Output 'GATEB_PARENTGONE_SYNTHETIC_REASON_AND_GUARD_RESTORE_PASS'
    Write-Output 'GATEB_PARENTGONE_USER_DISABLED_LEDGER_RETAINED'
    exit 0
  } catch {
    $Failed = $true
  }
}
Write-Output ('GATEB_PARENTGONE_STOP_STAGE=' + $Step)
if ($Consumed) {
  Write-Output 'GATEB_PARENTGONE_APPLY_CONSUMED_NO_RETRY'
} else {
  Write-Output 'GATEB_PARENTGONE_APPLY_NOT_STARTED'
}
Write-Output 'GATEB_PARENTGONE_NO_GO_MANUAL_RECONCILIATION'
exit 3
