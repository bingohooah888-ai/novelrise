# NOVELIGHT Gate B protected launcher: offline candidate ONLY.
# Does not make account/task/guard/DPAPI modifications; Apply is always BLOCKED.
[CmdletBinding()]
param([ValidateSet('Plan','ReadOnlyPreflight','Apply')][string]$Mode='Plan')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostPin='DESKTOP-8Q4GFC8'
$Target='NOVELIGHT-GateB'
$Task='NOVELIGHT-GateB-Independent-Recovery'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Vault='C:\ProgramData\NOVELIGHT\GateB'
$Worker=Join-Path $Root 'watchdog.ps1'
$State=Join-Path $Root 'state.json'
$Heartbeat=Join-Path $Root 'heartbeat.json'
$Probe=Join-Path $Root 'gateb-dpapi-sid-proof.ps1'
$WorkerHash='78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$TaskExe='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$AdminSid='S-1-5-32-544'
$Sid=''
$Stage='NO_LIVE_AUTHORITY'

function Assert-TargetProcessesZero {
  foreach($proc in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
    if([int]$proc.ProcessId -in @(0,4)){continue}
    $owner=$null
    try{$owner=Invoke-CimMethod -InputObject $proc -MethodName GetOwnerSid -ErrorAction Stop}catch{$owner=$null}
    if($null -ne $owner -and $owner.ReturnValue -eq 0 -and
      -not [string]::IsNullOrWhiteSpace([string]$owner.Sid)) {
      if([string]$owner.Sid -ceq $Sid){throw 'TARGET_PROCESS_REMAINS'}
      continue
    }
    if(@(Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$proc.ProcessId) -ErrorAction Stop).Count -ne 0){
      throw 'PROCESS_OWNER_UNVERIFIED'
    }
  }
}
function Assert-TargetSessionsZero {
  # Session association is in addition to the SID-owner process census.
  # Unknown WMI result / permissions always fails, never infer zero.
  $account=@(Get-CimInstance Win32_UserAccount -Filter (
    "SID='"+$Sid+"'") -ErrorAction Stop)
  if($account.Count -ne 1){throw 'TARGET_ACCOUNT_ASSOCIATION_UNVERIFIED'}
  $sessions=@(Get-CimAssociatedInstance -InputObject $account[0] -Association Win32_LoggedOnUser -ResultClassName Win32_LogonSession -ErrorAction Stop)
  if($sessions.Count -ne 0){throw 'TARGET_LOGON_SESSION_REMAINS'}
}
function Assert-ProtectedAcl {
  $rootItem=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if(-not $rootItem.PSIsContainer -or
    ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'ROOT_UNSAFE'}
  $acl=[IO.Directory]::GetAccessControl($Root)
  if(-not $acl.AreAccessRulesProtected -or
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){throw 'ACL_OWNER_UNTRUSTED'}
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if($rules.Count -ne 3){throw 'ACL_COUNT_CHANGED'}
  foreach($id in @($AdminSid,'S-1-5-18',$Sid)){
    $match=@($rules|Where-Object {$_.IdentityReference.Value -ceq $id -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited})
    if($match.Count -ne 1){throw 'ACL_IDENTITY_CHANGED'}
    $rights=$match[0].FileSystemRights
    $flag=[Security.AccessControl.FileSystemRights]
    if($id -ceq $Sid){
      if(($rights -band $flag::Write) -ne 0 -or
        ($rights -band $flag::Delete) -ne 0 -or
        ($rights -band $flag::ChangePermissions) -ne 0){throw 'TARGET_CAN_MODIFY_GUARD'}
    }elseif(($rights -band $flag::FullControl) -ne $flag::FullControl){throw 'ADMIN_SYSTEM_NOT_FULL'}
  }
}
function Assert-GuardWatchdog {
  $s=ConvertFrom-Json ([IO.File]::ReadAllText($State)) -ErrorAction Stop
  if($s.version -ne 1 -or $s.host -cne $HostPin -or $s.sid -cne $Sid -or
    $s.taskName -cne $Task -or $s.phase -cne 'GUARD_ONLY' -or
    [int]$s.parentPid -ne 0 -or [string]$s.parentStartUtc -cne ''){throw 'GUARD_ONLY_NOT_VERIFIED'}
  $t=Get-ScheduledTask -TaskName $Task -TaskPath '\' -ErrorAction Stop
  $argsExpected='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$Worker+'" -Mode Recover'
  if($t.State -notin @('Ready','Running') -or
    $t.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or
    @($t.Actions).Count -ne 1 -or $t.Actions[0].Execute -ine $TaskExe -or
    $t.Actions[0].Arguments -cne $argsExpected){throw 'WATCHDOG_CHANGED'}
  $time=@($t.Triggers|Where-Object {$_.CimClass.CimClassName -match 'TimeTrigger'})
  $boot=@($t.Triggers|Where-Object {$_.CimClass.CimClassName -match 'BootTrigger'})
  if(@($t.Triggers).Count -ne 2 -or $time.Count -ne 1 -or $boot.Count -ne 1){throw 'WATCHDOG_TRIGGER_DRIFT'}
  $interval=[Xml.XmlConvert]::ToTimeSpan([string]$time[0].Repetition.Interval)
  $duration=[Xml.XmlConvert]::ToTimeSpan([string]$time[0].Repetition.Duration)
  $start=[datetime]::Parse([string]$time[0].StartBoundary)
  if($interval.TotalSeconds -ne 60 -or $duration.TotalDays -ne 7 -or
    $start.Add($duration) -le (Get-Date).AddMinutes(30)){throw 'WATCHDOG_EXPIRING'}
  if((Get-FileHash $Worker -Algorithm SHA256).Hash.ToLowerInvariant() -cne $WorkerHash){throw 'WORKER_DRIFT'}
  $hb=ConvertFrom-Json ([IO.File]::ReadAllText($Heartbeat)) -ErrorAction Stop
  $stamp=[datetime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
  if($hb.version -ne 1 -or $hb.reasonCode -cne 'GUARD_ONLY' -or
    $hb.observedDisabled -ne $true -or [int]$hb.sequence -lt 2 -or
    $stamp -lt [datetime]::UtcNow.AddSeconds(-150) -or
    $stamp -gt [datetime]::UtcNow.AddSeconds(5)){throw 'HEARTBEAT_NOT_FRESH'}
}
function Assert-Baseline {
  $script:Stage='IDENTITY'
  $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if($env:COMPUTERNAME -cne $HostPin -or
    -not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  if((Get-Service Schedule -ErrorAction Stop).Status -ne 'Running'){throw 'SCHEDULER_STOPPED'}
  $u=Get-LocalUser -Name $Target -ErrorAction Stop
  if(-not $u.SID -or $u.Enabled){throw 'ACCOUNT_NOT_DISABLED'}
  $script:Sid=$u.SID.Value
  if(@(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop|
    Where-Object {$_.SID.Value -ceq $Sid}).Count -ne 0){throw 'TARGET_IS_ADMIN'}
  $script:Stage='GUARD_WATCHDOG'
  Assert-ProtectedAcl
  Assert-GuardWatchdog
  $script:Stage='RESIDUE'
  Assert-TargetProcessesZero
  Assert-TargetSessionsZero
  if(@(Get-CimInstance Win32_UserProfile -Filter ("SID='"+$Sid+"'") -ErrorAction Stop).Count -ne 0){
    throw 'TARGET_PROFILE_PRESENT'
  }
  if(@([IO.Directory]::GetFileSystemEntries($Vault)).Count -ne 0){throw 'VAULT_NOT_EMPTY'}
}
# Source-only implementation for a future approved launcher that receives
# PSCredential in trusted process memory, NEVER from argv/env/files/ChatGPT.
# Does not accept S4U: CurrentUser DPAPI needs real credential-backed profile.
# This function is never called in any advertised execution mode.
function Start-PinnedTargetSidProbe {
  param(
    [System.Management.Automation.PSCredential]$Credential,
    [ValidateSet('TargetCreate','TargetVerify')][string]$ProbeMode
  )
  if($null -eq $Credential -or
    $Credential.UserName -cne ($HostPin+'\'+$Target)){throw 'TARGET_CREDENTIAL_UNAVAILABLE'}
  if(-not (Test-Path $Probe -PathType Leaf)){throw 'PINNED_PROBE_NOT_INSTALLED'}
  # The future controller MUST verify exact approved SHA, protected permit,
  # guarded parent, one-shot ledger and process profile BEFORE calling.
  $arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$Probe+'" -Mode '+$ProbeMode+' -OwnerApproval ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF'
  $p=Start-Process -FilePath $TaskExe -ArgumentList $arguments -Credential $Credential -LoadUserProfile -PassThru -ErrorAction Stop
  try {
    $child=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$p.Id) -ErrorAction Stop
    if(@($child).Count -ne 1){throw 'CHILD_EXITED_BEFORE_IDENTITY_PROOF'}
    $owner=Invoke-CimMethod -InputObject $child -MethodName GetOwnerSid -ErrorAction Stop
    if($owner.ReturnValue -ne 0 -or [string]$owner.Sid -cne $Sid){throw 'CHILD_SID_MISMATCH'}
    return [pscustomobject]@{pid=[int]$p.Id;startUtc=$p.StartTime.ToUniversalTime().ToString('o')}
  } finally {$p.Dispose()}
}
if($Mode -eq 'Plan'){
  Write-Output 'GATEB_DPAPI_GUARDED_LAUNCHER_OFFLINE_ONLY'
  exit 2
}
if($Mode -eq 'Apply'){
  Write-Output 'GATEB_DPAPI_GUARDED_LAUNCHER_LIVE_BLOCKED'
  exit 4
}
try{
  Assert-Baseline
  Write-Output 'GATEB_DPAPI_GUARDED_READONLY_PREFLIGHT_PASS'
  exit 0
}catch{
  Write-Output ('GATEB_DPAPI_GUARDED_PREFLIGHT_NO_GO_'+$Stage)
  exit 3
}
