# Gate B guarded DPAPI interrupted restore candidate. Offline ONLY, Restore blocked.
# The source may be integrated only after a separate OWNER approval and exact SHA pin.
[CmdletBinding()]
param([ValidateSet('Inspect','Restore')][string]$Mode='Inspect')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostPin='DESKTOP-8Q4GFC8'
$Target='NOVELIGHT-GateB'
$Task='NOVELIGHT-GateB-Independent-Recovery'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$State=Join-Path $Root 'state.json'
$Backup=Join-Path $Root 'state.json.dpapi-guard-original'
$ArmLedger=Join-Path $Root 'gateb-dpapi-once-consumed.marker'
$Worker=Join-Path $Root 'watchdog.ps1'
$WorkerSha='78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$AdminSid='S-1-5-32-544'
$Stage='DENIED'
$TargetSid=''

function Assert-SafeLeaf([string]$Path) {
  $obj=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($obj.PSIsContainer -or ($obj.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'UNSAFE_FILE'
  }
}
function Assert-PinnedState([object]$s,[string]$expected) {
  $keys=@($s.PSObject.Properties.Name)
  $allowed=@('version','host','sid','taskName','phase','deadlineUtc','parentPid','parentStartUtc')
  if($keys.Count -ne 8 -or @($keys|Where-Object {$_ -notin $allowed}).Count -ne 0 -or
    $s.version -ne 1 -or $s.host -cne $HostPin -or $s.sid -cne $TargetSid -or
    $s.taskName -cne $Task -or $s.phase -cne $expected -or
    [string]$s.deadlineUtc -notmatch 'Z$'){throw 'UNPINNED_STATE'}
  if($expected -ceq 'GUARD_ONLY'){
    if([int]$s.parentPid -ne 0 -or [string]$s.parentStartUtc -cne ''){
      throw 'GUARD_PARENT_NOT_ZERO'
    }
  }elseif([int]$s.parentPid -le 0 -or
    [string]$s.parentStartUtc -notmatch 'Z$'){throw 'GUARDED_PARENT_UNPINNED'}
}
function Assert-RootAndIdentity {
  $script:Stage='HOST_ADMIN_ACCOUNT'
  $principal=[Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
  if($env:COMPUTERNAME -cne $HostPin -or
    -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'HOST_ADMIN_REQUIRED'
  }
  $u=Get-LocalUser -Name $Target -ErrorAction Stop
  if(-not $u.SID -or $u.Enabled){throw 'ACCOUNT_NOT_DISABLED'}
  $script:TargetSid=$u.SID.Value
  if(@(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop |
    Where-Object {$_.SID.Value -ceq $TargetSid}).Count -ne 0){throw 'TARGET_ADMIN'}
  $script:Stage='PROTECTED_ROOT'
  $dir=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if(-not $dir.PSIsContainer -or
    ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'BAD_ROOT'}
  $acl=[IO.Directory]::GetAccessControl($Root)
  if(-not $acl.AreAccessRulesProtected -or
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){
    throw 'BAD_ACL'
  }
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if($rules.Count -ne 3){throw 'BAD_ACL_RULES'}
  foreach($sid in @($AdminSid,'S-1-5-18',$TargetSid)){
    if(@($rules|Where-Object {$_.IdentityReference.Value -ceq $sid -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited}).Count -ne 1){
      throw 'BAD_ACL_IDENTITY'
    }
  }
  Assert-SafeLeaf $Worker
  if((Get-FileHash $Worker -Algorithm SHA256).Hash.ToLowerInvariant() -cne $WorkerSha){
    throw 'WORKER_SHA_DRIFT'
  }
}
# Future-only, never called by currently exposed modes. Must be paired with
# a trusted marker containing a unique approval/head/SHA, single-use ledger,
# pre/post hashes and crash-safe independent supervisor. No blind overwrite.
function Invoke-AtomicGuardRestore {
  param([string]$OriginalSha256,[string]$ActiveGuardSha256)
  Assert-SafeLeaf $State
  Assert-SafeLeaf $Backup
  Assert-SafeLeaf $ArmLedger
  $current=(Get-FileHash -LiteralPath $State -Algorithm SHA256).Hash.ToLowerInvariant()
  $saved=(Get-FileHash -LiteralPath $Backup -Algorithm SHA256).Hash.ToLowerInvariant()
  if($current -cne $ActiveGuardSha256 -or $saved -cne $OriginalSha256){
    throw 'UNKNOWN_STATE_NO_OVERWRITE'
  }
  $guard=ConvertFrom-Json ([IO.File]::ReadAllText($State)) -ErrorAction Stop
  $original=ConvertFrom-Json ([IO.File]::ReadAllText($Backup)) -ErrorAction Stop
  Assert-PinnedState $guard 'GUARDED_TEST'
  Assert-PinnedState $original 'GUARD_ONLY'
  $parentMatches=$false
  try {
    $parent=Get-Process -Id ([int]$guard.parentPid) -ErrorAction Stop
    $parentMatches=$parent.StartTime.ToUniversalTime().ToString('o') -ceq
      [string]$guard.parentStartUtc
  }catch{$parentMatches=$false}
  $deadline=[datetime]::Parse([string]$guard.deadlineUtc).ToUniversalTime()
  if($parentMatches -and $deadline -gt [datetime]::UtcNow){
    throw 'ACTIVE_PARENT_NOT_SAFE_TO_RESTORE'
  }
  $tmp=Join-Path $Root 'state.json.dpapi-restore-stage'
  if([IO.File]::Exists($tmp)){throw 'RESTORE_TEMP_ALREADY_PRESENT'}
  [IO.File]::Copy($Backup,$tmp,$false)
  [IO.File]::Replace($tmp,$State,(Join-Path $Root 'state.json.dpapi-guarded-backup'))
  if((Get-FileHash $State -Algorithm SHA256).Hash.ToLowerInvariant() -cne
    $OriginalSha256){throw 'RESTORE_NOT_CONFIRMED'}
  # Audited backup and spent marker retained; cleanup is separately authorized.
}
if($Mode -eq 'Restore'){
  Write-Output 'GATEB_DPAPI_GUARD_RESTORE_UNAPPROVED_BLOCKED'
  exit 4
}
try{
  Assert-RootAndIdentity
  $script:Stage='READONLY_STATE'
  Assert-SafeLeaf $State
  $s=ConvertFrom-Json ([IO.File]::ReadAllText($State)) -ErrorAction Stop
  if($s.phase -ceq 'GUARD_ONLY'){
    Assert-PinnedState $s 'GUARD_ONLY'
    Write-Output 'GATEB_DPAPI_GUARD_ALREADY_GUARD_ONLY_READONLY'
  }elseif($s.phase -ceq 'GUARDED_TEST'){
    Assert-PinnedState $s 'GUARDED_TEST'
    Write-Output 'GATEB_DPAPI_GUARD_INTERRUPTED_RESTORE_REQUIRED'
  }else{throw 'BAD_PHASE'}
  exit 0
}catch{
  Write-Output ('GATEB_DPAPI_GUARD_RESTORE_NO_GO_'+$Stage)
  exit 3
}
