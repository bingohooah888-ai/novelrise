# OFFLINE CANDIDATE. Apply requires NEW, HEAD/SHA-256-bound OWNER consent.
# Prove an enabled NOVELIGHT-GateB account is disabled by EXISTING SYSTEM Watchdog.
[CmdletBinding()]
param(
  [ValidateSet('Preflight','Apply')][string]$Mode='Preflight',
  [string]$OwnerApproval=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostPin='DESKTOP-8Q4GFC8'
$Account='NOVELIGHT-GateB'
$TaskName='NOVELIGHT-GateB-Independent-Recovery'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Vault='C:\ProgramData\NOVELIGHT\GateB'
$Worker=Join-Path $Root 'watchdog.ps1'
$StatePath=Join-Path $Root 'state.json'
$HbPath=Join-Path $Root 'heartbeat.json'
$SidPath=Join-Path $Root 'target-sid.txt'
$PriorMarker=Join-Path $Root 'parentgone-once-consumed.marker'
$Marker=Join-Path $Root 'guardonly-live-redisable-once-consumed.marker'
$WorkerSha='78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$Approval='ONE_GATEB_GUARDONLY_LIVE_REDISABLE_20261108'
$AdminSid='S-1-5-32-544'
$SystemSid='S-1-5-18'
$NloNames=@('NOVELIGHT Commander Control Rollover','NOVELIGHT Commander Tunnel','NOVELIGHT Commander Watchdog')
$NloBaseline=@{}
$Sid=''
$Stage='INITIAL'
$WatchdogProof=$false
$FallbackAttempted=$false
$FallbackSucceeded=$false
function Assert-Leaf([string]$File) {
  $item=Get-Item -LiteralPath $File -Force -ErrorAction Stop
  if ($item.PSIsContainer -or
    ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'UNSAFE_FILE'
  }
}
function Assert-Disabled {
  $u=Get-LocalUser -Name $Account -ErrorAction Stop
  if (-not $u.SID -or $u.SID.Value -cne $Sid -or $u.Enabled) {
    throw 'ACCOUNT_NOT_PINNED_DISABLED'
  }
}
function Assert-ZeroResidue {
  if (@(Get-CimInstance Win32_UserProfile -Filter ("SID='" + $Sid + "'") -ErrorAction Stop).Count -ne 0) {
    throw 'TARGET_PROFILE_PRESENT'
  }
  foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
    if ([int]$p.ProcessId -in @(0,4)) { continue }
    $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop
    if ($owner.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace([string]$owner.Sid)) {
      throw 'OWNER_CENSUS_UNVERIFIED'
    }
    if ([string]$owner.Sid -ceq $Sid) { throw 'TARGET_PROCESS_PRESENT' }
  }
}
function Check-Nlo([bool]$TakeBaseline) {
  $tasks=@(Get-ScheduledTask -ErrorAction Stop | Where-Object {$_.TaskName -in $NloNames})
  if ($tasks.Count -ne 3) { throw 'NLO_COUNT_CHANGED' }
  foreach ($task in $tasks) {
    $xml=Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop
    if ($TakeBaseline) { $script:NloBaseline[$task.TaskName]=$xml }
    elseif (-not $NloBaseline.ContainsKey($task.TaskName) -or
      $NloBaseline[$task.TaskName] -cne $xml) { throw 'NLO_DEFINITION_DRIFT' }
  }
}
function Read-Hb {
  Assert-Leaf $HbPath
  return (ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($HbPath)) -ErrorAction Stop)
}
function Assert-Baseline {
  $script:Stage='HOST_ADMIN_ACCOUNT'
  $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if ($env:COMPUTERNAME -cne $HostPin -or
    -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'HOST_OR_ADMIN_REQUIRED'
  }
  if ((Get-Service Schedule -ErrorAction Stop).Status -ne 'Running') {throw 'SCHEDULER_STOPPED'}
  $u=Get-LocalUser -Name $Account -ErrorAction Stop
  if (-not $u.SID -or $u.Enabled) {throw 'ACCOUNT_NOT_DISABLED'}
  $script:Sid=$u.SID.Value
  $admins=@(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop)
  if (@($admins | Where-Object {$_.SID.Value -ceq $Sid}).Count -ne 0) {
    throw 'TARGET_IS_ADMIN'
  }
  Assert-ZeroResidue
  $script:Stage='PROTECTED_ROOT'
  $dir=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if (-not $dir.PSIsContainer -or
    ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw 'ROOT_UNSAFE'}
  $acl=[IO.Directory]::GetAccessControl($Root)
  if (-not $acl.AreAccessRulesProtected -or
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid) {
    throw 'ROOT_ACL_UNSAFE'
  }
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 3) {throw 'ACL_RULE_COUNT'}
  foreach ($id in @($AdminSid,$SystemSid,$Sid)) {
    $matches=@($rules | Where-Object {
      $_.IdentityReference.Value -ceq $id -and $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if ($matches.Count -ne 1) {throw 'ACL_IDENTITY_CHANGED'}
    $rights=$matches[0].FileSystemRights
    $flags=[Security.AccessControl.FileSystemRights]
    if ($id -ceq $Sid) {
      if (($rights -band $flags::ReadAndExecute) -ne $flags::ReadAndExecute -or
        ($rights -band $flags::Write) -ne 0 -or ($rights -band $flags::Delete) -ne 0 -or
        ($rights -band $flags::ChangePermissions) -ne 0 -or
        ($rights -band $flags::TakeOwnership) -ne 0) {throw 'TARGET_CAN_WRITE_ROOT'}
    } elseif (($rights -band $flags::FullControl) -ne $flags::FullControl) {
      throw 'SYSTEM_OR_ADMIN_NOT_FULL'
    }
  }
  $files=@([IO.Directory]::GetFileSystemEntries($Root) | ForEach-Object {[IO.Path]::GetFileName($_)})
  $allow=@('watchdog.ps1','target-sid.txt','state.json','heartbeat.json','parentgone-once-consumed.marker')
  if ($files.Count -ne $allow.Count -or @($files | Where-Object {$_ -notin $allow}).Count -ne 0) {
    throw 'ROOT_FILES_UNEXPECTED_OR_ALREADY_CONSUMED'
  }
  foreach ($file in @($Worker,$StatePath,$HbPath,$SidPath,$PriorMarker)) {Assert-Leaf $file}
  if ((Get-FileHash -LiteralPath $Worker -Algorithm SHA256).Hash.ToLowerInvariant() -cne $WorkerSha) {
    throw 'WORKER_SHA_CHANGED'
  }
  if ([IO.File]::ReadAllText($SidPath).Trim() -cne $Sid) {throw 'SID_CHANGED'}
  $s=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($StatePath)) -ErrorAction Stop
  $keys=@($s.PSObject.Properties.Name)
  $allowedKeys=@('version','host','sid','taskName','phase','deadlineUtc','parentPid','parentStartUtc')
  if ($keys.Count -ne 8 -or @($keys | Where-Object {$_ -notin $allowedKeys}).Count -ne 0 -or
    $s.version -ne 1 -or $s.host -cne $HostPin -or $s.sid -cne $Sid -or
    $s.taskName -cne $TaskName -or $s.phase -cne 'GUARD_ONLY' -or
    [int]$s.parentPid -ne 0 -or [string]$s.parentStartUtc -cne '' -or
    [string]$s.deadlineUtc -notmatch 'Z$') {throw 'STATE_NOT_GUARD_ONLY'}
  $v=Get-Item -LiteralPath $Vault -Force -ErrorAction Stop
  if (-not $v.PSIsContainer -or ($v.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    @(Get-ChildItem -LiteralPath $Vault -Force -ErrorAction Stop).Count -ne 0) {
    throw 'VAULT_NOT_EMPTY'
  }
  $script:Stage='SYSTEM_WATCHDOG_TASK'
  $t=Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
  $argsExpected='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$Worker+'" -Mode Recover'
  if ($t.State -notin @('Ready','Running') -or
    $t.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or
    $t.Principal.LogonType.ToString() -cne 'ServiceAccount' -or
    @($t.Actions).Count -ne 1 -or
    $t.Actions[0].Execute -ine 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -or
    $t.Actions[0].Arguments -cne $argsExpected) {throw 'TASK_SCOPE_CHANGED'}
  $tr=@($t.Triggers)
  $time=@($tr | Where-Object {$_.CimClass.CimClassName -match 'TimeTrigger'})
  $boot=@($tr | Where-Object {$_.CimClass.CimClassName -match 'BootTrigger'})
  if ($tr.Count -ne 2 -or $time.Count -ne 1 -or $boot.Count -ne 1) {
    throw 'TASK_TRIGGER_CHANGED'
  }
  $interval=[Xml.XmlConvert]::ToTimeSpan([string]$time[0].Repetition.Interval)
  $duration=[Xml.XmlConvert]::ToTimeSpan([string]$time[0].Repetition.Duration)
  $start=[datetime]::Parse([string]$time[0].StartBoundary)
  if ($interval.TotalSeconds -ne 60 -or $duration.TotalDays -ne 7 -or
    $start.Add($duration) -le (Get-Date).AddMinutes(30)) {
    throw 'WATCHDOG_DURATION_UNSAFE'
  }
  if ((Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath '\' -ErrorAction Stop).LastTaskResult -ne 0) {
    throw 'WATCHDOG_LAST_RUN_FAILED'
  }
  $script:Stage='HEARTBEAT_AND_NLO'
  $hb=Read-Hb
  $stamp=[datetime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
  if ($hb.version -ne 1 -or [int]$hb.sequence -lt 2 -or
    $hb.status -cne 'WATCHDOG_DISABLED_CONFIRMED' -or
    $hb.reasonCode -cne 'GUARD_ONLY' -or
    $hb.disableOutcome -cne 'ALREADY_DISABLED' -or
    $hb.accountWasEnabledBefore -ne $false -or $hb.disableAttempted -ne $false -or
    $hb.observedDisabled -ne $true -or
    $stamp -lt [datetime]::UtcNow.AddSeconds(-150) -or
    $stamp -gt [datetime]::UtcNow.AddSeconds(5)) {throw 'HEARTBEAT_NOT_TRUSTED'}
  Check-Nlo -TakeBaseline $true
  Assert-Disabled
  return $hb
}
if ($Mode -eq 'Preflight') {
  try {
    $null=Assert-Baseline
    Write-Output 'GATEB_GUARDONLY_LIVE_PREFLIGHT_PASS'
    exit 0
  } catch {
    Write-Output ('GATEB_GUARDONLY_LIVE_PREFLIGHT_NO_GO_'+$Stage)
    exit 2
  }
}
if ($OwnerApproval -cne $Approval) {
  Write-Output 'GATEB_GUARDONLY_LIVE_APPLY_NOT_APPROVED'
  exit 4
}
$result='NO_GO'
try {
  $baseline=Assert-Baseline
  $script:Stage='ONE_SHOT_MARKER'
  $f=[IO.File]::Open($Marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $bytes=[Text.Encoding]::UTF8.GetBytes('GATEB_LIVE_ENABLE_CONSUMED')
    $f.Write($bytes,0,$bytes.Length)
    $f.Flush($true)
  } finally {$f.Dispose()}
  $script:Stage='ENABLE_ONE_TARGET'
  Enable-LocalUser -Name $Account -ErrorAction Stop
  $enabledAt=[datetime]::UtcNow
  $script:Stage='WAIT_EXISTING_SYSTEM_WATCHDOG'
  # No task starting, parent kill, password handling or OS automatic retry.
  # Normal shell fallback by +110 sec. Shell death cannot guarantee that bound.
  while ([datetime]::UtcNow -lt $enabledAt.AddSeconds(105)) {
    Start-Sleep -Seconds 2
    try {
      $h=Read-Hb
      $at=[datetime]::Parse([string]$h.checkedUtc).ToUniversalTime()
      $u=Get-LocalUser -Name $Account -ErrorAction Stop
      if ($u.SID.Value -cne $Sid) {throw 'SID_DRIFT'}
      if ([int]$h.sequence -gt [int]$baseline.sequence -and
        $at -ge $enabledAt.AddSeconds(-2) -and
        $h.reasonCode -ceq 'GUARD_ONLY' -and
        $h.status -ceq 'WATCHDOG_DISABLED_CONFIRMED' -and
        $h.disableOutcome -ceq 'DISABLED_BY_WATCHDOG' -and
        $h.accountWasEnabledBefore -eq $true -and $h.disableAttempted -eq $true -and
        $h.observedDisabled -eq $true -and -not $u.Enabled) {
        $WatchdogProof=$true
        break
      }
    } catch {
      # A transient read or account race is not positive evidence.
    }
  }
  if (-not $WatchdogProof) {throw 'WATCHDOG_NOT_PROVEN'}
  $script:Stage='FINAL_RESIDUE_AND_NLO'
  Assert-Disabled
  Assert-ZeroResidue
  Check-Nlo -TakeBaseline $false
  $result='PASS'
} catch {$result='NO_GO'} finally {
  # One admin fallback only when target remains enabled. No retries.
  try {
    $u=Get-LocalUser -Name $Account -ErrorAction Stop
    if ($Sid -eq '' -or $u.SID.Value -cne $Sid) {throw 'SID_UNTRUSTED'}
    if ($u.Enabled) {
      $FallbackAttempted=$true
      Disable-LocalUser -Name $Account -ErrorAction Stop
      $FallbackSucceeded=$true
    }
    Assert-Disabled
  } catch {$result='NO_GO_ACCOUNT_UNCONFIRMED'}
}
if ($result -eq 'PASS' -and $WatchdogProof -and -not $FallbackAttempted) {
  Write-Output 'GATEB_LIVE_USER_DISABLED_BY_EXISTING_SYSTEM_WATCHDOG_PASS'
  Write-Output 'GATEB_NO_TARGET_PROCESS_OR_PROFILE_PASS'
  Write-Output 'GATEB_NLO_UNCHANGED_PASS'
  Write-Output 'GATEB_ONE_SHOT_CONSUMED'
  exit 0
}
if ($result -eq 'NO_GO_ACCOUNT_UNCONFIRMED') {
  Write-Output 'GATEB_ACCOUNT_STATUS_UNCONFIRMED_EMERGENCY_ADMIN_DISABLE_REQUIRED'
  exit 5
}
if ($FallbackAttempted -and $FallbackSucceeded) {
  Write-Output 'GATEB_LIVE_NO_GO_MANUAL_FALLBACK_DISABLED'
} else {
  Write-Output ('GATEB_LIVE_NO_GO_'+$Stage)
}
Write-Output 'GATEB_ONE_SHOT_MAY_BE_CONSUMED_DO_NOT_RETRY'
exit 3
