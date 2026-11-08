# Offline-only SOURCE for a future separate SYSTEM recovery task.
# Recover always exits 4; no tasks or protected files are changed by this CLI.
[CmdletBinding()]
param([ValidateSet('Inspect','Recover')][string]$Mode='Inspect')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostPin='DESKTOP-8Q4GFC8'
$Account='NOVELIGHT-GateB'
$TaskName='NOVELIGHT-GateB-Independent-Recovery'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$State=Join-Path $Root 'state.json'
$Original=Join-Path $Root 'state.json.dpapi-original'
$Manifest=Join-Path $Root 'gateb-dpapi-arm-manifest.json'
$Marker=Join-Path $Root 'gateb-dpapi-one-shot-consumed.marker'
$Worker=Join-Path $Root 'watchdog.ps1'
$KnownWorkerHash='78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$SystemSid='S-1-5-18'
$AdminSid='S-1-5-32-544'
$Sid=''
$Stage='NO_AUTHORITY'

function Assert-PinnedLeaf([string]$Path) {
  $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'UNSAFE_LEAF'
  }
}
function Assert-PinnedRoot {
  $item=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'UNTRUSTED_ROOT'
  }
  $acl=[IO.Directory]::GetAccessControl($Root)
  if(-not $acl.AreAccessRulesProtected -or
     $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){throw 'ROOT_ACL_DRIFT'}
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if($rules.Count -ne 3){throw 'ROOT_RULE_DRIFT'}
  foreach($id in @($AdminSid,$SystemSid,$Sid)){
    $matches=@($rules|Where-Object {$_.IdentityReference.Value -ceq $id -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited})
    if($matches.Count -ne 1){throw 'ROOT_IDENTITY_DRIFT'}
    $flag=[Security.AccessControl.FileSystemRights]
    if($id -ceq $Sid -and (($matches[0].FileSystemRights -band $flag::Write) -ne 0 -or
      ($matches[0].FileSystemRights -band $flag::Delete) -ne 0 -or
      ($matches[0].FileSystemRights -band $flag::ChangePermissions) -ne 0)){throw 'TARGET_CAN_EDIT_GUARD'}
  }
  Assert-PinnedLeaf $Worker
  if((Get-FileHash $Worker -Algorithm SHA256).Hash.ToLowerInvariant() -cne $KnownWorkerHash){
    throw 'WORKER_HASH_CHANGED'
  }
}
function Get-RescueScope {
  $script:Stage='SYSTEM_SCOPE'
  if($env:COMPUTERNAME -cne $HostPin -or
    [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $SystemSid){
    throw 'SYSTEM_HOST_REQUIRED'
  }
  $u=Get-LocalUser -Name $Account -ErrorAction Stop
  if(-not $u.SID){throw 'TARGET_SID_MISSING'}
  $script:Sid=$u.SID.Value
  Assert-PinnedRoot
  foreach($file in @($State,$Original,$Manifest,$Marker)){Assert-PinnedLeaf $file}
  $m=ConvertFrom-Json ([IO.File]::ReadAllText($Manifest)) -ErrorAction Stop
  $names=@($m.PSObject.Properties.Name)
  $allowed=@('version','host','sid','taskName','originalSha256','guardedSha256','parentPid','parentStartUtc','deadlineUtc')
  if($names.Count -ne 9 -or @($names|Where-Object {$_ -notin $allowed}).Count -ne 0 -or
    $m.version -ne 1 -or $m.host -cne $HostPin -or $m.sid -cne $Sid -or
    $m.taskName -cne $TaskName -or [int]$m.parentPid -le 4 -or
    [string]$m.parentStartUtc -notmatch 'Z$' -or [string]$m.deadlineUtc -notmatch 'Z$' -or
    [string]$m.originalSha256 -notmatch '^[0-9a-f]{64}$' -or
    [string]$m.guardedSha256 -notmatch '^[0-9a-f]{64}$'){throw 'ARM_MANIFEST_INVALID'}
  $currentSha=(Get-FileHash -LiteralPath $State -Algorithm SHA256).Hash.ToLowerInvariant()
  $savedSha=(Get-FileHash -LiteralPath $Original -Algorithm SHA256).Hash.ToLowerInvariant()
  if($currentSha -cne $m.guardedSha256 -or $savedSha -cne $m.originalSha256){
    throw 'UNKNOWN_STATE_NO_OVERWRITE'
  }
  $guard=ConvertFrom-Json ([IO.File]::ReadAllText($State)) -ErrorAction Stop
  $saved=ConvertFrom-Json ([IO.File]::ReadAllText($Original)) -ErrorAction Stop
  if($guard.phase -cne 'GUARDED_TEST' -or $guard.sid -cne $Sid -or
    [int]$guard.parentPid -ne [int]$m.parentPid -or
    $guard.parentStartUtc -cne $m.parentStartUtc -or
    $guard.deadlineUtc -cne $m.deadlineUtc -or
    $saved.phase -cne 'GUARD_ONLY' -or $saved.sid -cne $Sid -or
    [int]$saved.parentPid -ne 0){throw 'STATE_MANIFEST_MISMATCH'}
  return $m
}
function Confirm-ScopeExpiredOrParentDead([object]$Manifest) {
  $deadline=[datetime]::Parse([string]$Manifest.deadlineUtc).ToUniversalTime()
  if([datetime]::UtcNow -ge $deadline){return $true}
  try {
    $parent=Get-Process -Id ([int]$Manifest.parentPid) -ErrorAction Stop
    if($parent.StartTime.ToUniversalTime().ToString('o') -cne
      [string]$Manifest.parentStartUtc){return $true}
    return $false
  }catch{return $true}
}
function Assert-NoLiveTargetResources {
  $u=Get-LocalUser -Name $Account -ErrorAction Stop
  if($u.SID.Value -cne $Sid -or $u.Enabled){throw 'TARGET_NOT_DISABLED'}
  foreach($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
    if([int]$p.ProcessId -in @(0,4)){continue}
    $owner=$null
    try{$owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop}catch{$owner=$null}
    if($null -ne $owner -and $owner.ReturnValue -eq 0 -and
      -not [string]::IsNullOrWhiteSpace([string]$owner.Sid)){
      if([string]$owner.Sid -ceq $Sid){throw 'CHILD_PROCESS_REMAINS'}
      continue
    }
    if(@(Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$p.ProcessId) -ErrorAction Stop).Count -ne 0){
      throw 'OWNER_UNKNOWN_NO_CLEANUP'
    }
  }
  $account=@(Get-CimInstance Win32_UserAccount -Filter ("SID='"+$Sid+"'") -ErrorAction Stop)
  if($account.Count -ne 1){throw 'SESSION_CENSUS_UNVERIFIED'}
  $sessions=@(Get-CimAssociatedInstance -InputObject $account[0] -Association Win32_LoggedOnUser -ResultClassName Win32_LogonSession -ErrorAction Stop)
  if($sessions.Count -ne 0){throw 'LOGON_SESSION_RESIDUE'}
}
function Invoke-IndependentSystemGuardRestore {
  # Not called in the currently exposed script. Future SYSTEM task must be
  # independently scheduled BEFORE any user enable / guarded parent launch.
  $manifest=Get-RescueScope
  if(-not (Confirm-ScopeExpiredOrParentDead $manifest)){throw 'PARENT_ALIVE_NO_RESTORE'}
  $u=Get-LocalUser -Name $Account -ErrorAction Stop
  if($u.SID.Value -cne $Sid){throw 'SID_CHANGED'}
  if($u.Enabled){Disable-LocalUser -SID $u.SID -ErrorAction Stop}
  Assert-NoLiveTargetResources
  $temp=Join-Path $Root 'state.json.dpapi-rescue-stage'
  if([IO.File]::Exists($temp)){throw 'RESCUE_STAGE_ALREADY_EXISTS'}
  [IO.File]::Copy($Original,$temp,$false)
  [IO.File]::Replace($temp,$State,(Join-Path $Root 'state.json.dpapi-rescue-backup'))
  if((Get-FileHash -LiteralPath $State -Algorithm SHA256).Hash.ToLowerInvariant() -cne
    $manifest.originalSha256){throw 'GUARD_RESTORE_NOT_CONFIRMED'}
  # The separate regular SYSTEM Watchdog heartbeat still must independently
  # attest GUARD_ONLY and disabled account. No profile or proof is deleted.
}
function Write-RescueHeartbeat([string]$Status) {
  $hb=Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'
  $sequence=1
  if([IO.File]::Exists($hb)){
    try {
      $prior=ConvertFrom-Json ([IO.File]::ReadAllText($hb)) -ErrorAction Stop
      if($prior.version -eq 1 -and $prior.host -ceq $HostPin -and
        $prior.sid -ceq $Sid -and [int]$prior.sequence -ge 1){
        $sequence=[int]$prior.sequence+1
      }
    }catch{throw 'RESCUE_HEARTBEAT_UNTRUSTED'}
  }
  $data=[ordered]@{version=1;host=$HostPin;sid=$Sid;task=$TaskName;
    sequence=$sequence;status=$Status;checkedUtc=[datetime]::UtcNow.ToString('o')}
  $temp=Join-Path $Root ('gateb-rescue-heartbeat-stage-'+[guid]::NewGuid().ToString('N'))
  $stream=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $bytes=[Text.Encoding]::UTF8.GetBytes(($data|ConvertTo-Json -Compress))
    $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)
  }finally{$stream.Dispose()}
  if([IO.File]::Exists($hb)){
    [IO.File]::Replace($temp,$hb,$null)
  }else{
    [IO.File]::Move($temp,$hb)
  }
}
function Invoke-AuthorizedSystemRecovery {
  $script:Stage='AUTHORIZED_SYSTEM'
  if($env:COMPUTERNAME -cne $HostPin -or
    [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $SystemSid){
    throw 'SYSTEM_ONLY'
  }
  $installed=Join-Path $Root 'gateb-dpapi-system-rescue.ps1'
  if([IO.Path]::GetFullPath($PSCommandPath) -cne $installed){
    throw 'NOT_PROTECTED_INSTALL'
  }
  $targetUser=Get-LocalUser -Name $Account -ErrorAction Stop
  if(-not $targetUser.SID){throw 'TARGET_SID_NOT_FOUND'}
  $script:Sid=$targetUser.SID.Value
  $module=Join-Path $Root 'gateb-dpapi-approval-contract.ps1'
  Assert-PinnedLeaf $module
  . $module
  $permitPath=Join-Path $Root 'gateb-dpapi-owner-permit.json'
  $json=ConvertFrom-Json ([IO.File]::ReadAllText($permitPath)) -ErrorAction Stop
  $null=Assert-GateBDpapiOwnerPermit -PermitPath $permitPath -ScriptDirectory $Root -ExpectedHead ([string]$json.head) -TargetSid $Sid -ExpectedTask 'NOVELIGHT-GateB-DPAPI-Independent-Rescue'
  $script:Stage='STATE'
  Assert-PinnedRoot
  Assert-PinnedLeaf $State
  $state=ConvertFrom-Json ([IO.File]::ReadAllText($State)) -ErrorAction Stop
  if($state.version -ne 1 -or $state.host -cne $HostPin -or
    $state.sid -cne $Sid -or $state.taskName -cne $TaskName){
    throw 'STATE_SCOPE_DRIFT'
  }
  if($state.phase -ceq 'GUARD_ONLY'){
    if($targetUser.Enabled){throw 'IDLE_TARGET_ENABLED'}
    Write-RescueHeartbeat 'IDLE_DISABLED'
    return 'IDLE'
  }
  if($state.phase -cne 'GUARDED_TEST'){throw 'UNKNOWN_PHASE'}
  $scope=Get-RescueScope
  if(-not (Confirm-ScopeExpiredOrParentDead $scope)){
    Write-RescueHeartbeat 'ARMED_PARENT_ALIVE'
    return 'ARMED'
  }
  # This branch runs independently of the originating parent.
  $script:Stage='RESTORE'
  Invoke-IndependentSystemGuardRestore
  Write-RescueHeartbeat 'RESTORED_GUARD_ONLY'
  return 'RESTORED'
}
if($Mode -eq 'Inspect'){
  Write-Output 'GATEB_DPAPI_SYSTEM_RESCUE_OFFLINE_ONLY'
  exit 2
}
try {
  $out=Invoke-AuthorizedSystemRecovery
  Write-Output ('GATEB_DPAPI_SYSTEM_RESCUE_'+$out)
  exit 0
} catch {
  # Keep the separately installed Watchdog as the independent disable guard.
  Write-Output ('GATEB_DPAPI_SYSTEM_RESCUE_NO_GO_'+$Stage)
  exit 3
}
