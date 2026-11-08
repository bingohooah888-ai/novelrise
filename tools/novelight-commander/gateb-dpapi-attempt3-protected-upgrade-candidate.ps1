# NOVELIGHT Gate B attempt-3 offline CANDIDATE only.
# Plan makes no change. Upgrade requires a NEW exact-HEAD owner approval and all
# historical/current file hashes. Never execute without explicit separate approval.
[CmdletBinding()]
param(
  [ValidateSet('Plan','Preflight','Upgrade')][string]$Mode='Plan',
  [string]$OwnerApproval='',
  [string]$ExpectedHead='',
  [string]$ExpectedInstallerSha256='',
  [string]$ExpectedOldCoordinatorSha256='',
  [string]$ExpectedOldRescueSha256='',
  [string]$ExpectedOldContractSha256='',
  [string]$ExpectedNewCoordinatorSha256='',
  [string]$ExpectedNewRescueSha256='',
  [string]$ExpectedNewContractSha256=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostPin='DESKTOP-8Q4GFC8'
$Repo='C:\Users\bingo\Documents\novelrise-ai-020705-gateb-dpapi-20261106'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Vault='C:\ProgramData\NOVELIGHT\GateB'
$Target='NOVELIGHT-GateB'
$WatchdogTask='NOVELIGHT-GateB-Independent-Recovery'
$RescueTask='NOVELIGHT-GateB-DPAPI-Independent-Rescue'
$OwnerPermit=Join-Path $Root 'gateb-dpapi-owner-permit.json'
$ProofPermit=Join-Path $Root 'gateb-dpapi-sid-proof-arm.json'
$Ledger=Join-Path $Root 'gateb-dpapi-attempt3-protected-upgrade-once-consumed.marker'
$Approval='ONE_GATEB_DPAPI_ATTEMPT3_PROTECTED_UPGRADE_NEW_OWNER_APPROVAL'
$AdminSid='S-1-5-32-544'
$SystemSid='S-1-5-18'
$BaseOriginalSha='1b6d10aa5365fb9dc355a2a04ea3da0e97f07ca933fd35bd4d947b758893744c'
$WorkerSha='78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$Sid=''
$Stage='NOT_STARTED'
$SourceDir=Join-Path $Repo 'tools\novelight-commander'
$Specs=@(
 @{Name='gateb-dpapi-one-shot-coordinator.ps1';Source='gateb-dpapi-attempt3-one-shot-coordinator-candidate.ps1';Old=$ExpectedOldCoordinatorSha256;New=$ExpectedNewCoordinatorSha256},
 @{Name='gateb-dpapi-system-rescue.ps1';Source='gateb-dpapi-attempt3-system-rescue-candidate.ps1';Old=$ExpectedOldRescueSha256;New=$ExpectedNewRescueSha256},
 @{Name='gateb-dpapi-approval-contract.ps1';Source='gateb-dpapi-attempt3-approval-contract-candidate.ps1';Old=$ExpectedOldContractSha256;New=$ExpectedNewContractSha256}
)
function Must([bool]$ok,[string]$why){if(-not $ok){throw $why}}
function Sha([string]$file){return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Leaf([string]$file){
 $f=Get-Item -LiteralPath $file -Force -ErrorAction Stop
 Must (-not $f.PSIsContainer -and ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'UNTRUSTED_FILE'
}
function Assert-ProtectedRoot {
 $item=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
 $acl=[IO.Directory]::GetAccessControl($Root)
 Must ($item.PSIsContainer -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and
  $acl.AreAccessRulesProtected -and $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $AdminSid) 'ROOT_ACL_DRIFT'
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 Must ($rules.Count -eq 3) 'ROOT_ACL_EXTRA'
 foreach($id in @($AdminSid,$SystemSid,$Sid)){
  $match=@($rules|Where-Object{$_.IdentityReference.Value -ceq $id -and
   $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited})
  Must ($match.Count -eq 1) 'ROOT_ACL_SID_DRIFT'
  if($id -ceq $Sid){
   $f=[Security.AccessControl.FileSystemRights]
   Must (($match[0].FileSystemRights -band $f::Write) -eq 0 -and
    ($match[0].FileSystemRights -band $f::Delete) -eq 0 -and
    ($match[0].FileSystemRights -band $f::ChangePermissions) -eq 0) 'TARGET_CAN_EDIT_GUARD'
  }
 }
}
function FileAcl([string]$file){
 Leaf $file
 $acl=[IO.File]::GetAccessControl($file)
 Must ($acl.AreAccessRulesProtected -and
  $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $AdminSid) 'FILE_OWNER_DRIFT'
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 Must ($rules.Count -eq 3) 'FILE_ACL_EXTRA'
 foreach($id in @($AdminSid,$SystemSid,$Sid)){
  $match=@($rules|Where-Object{$_.IdentityReference.Value -ceq $id -and
   $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited})
  Must ($match.Count -eq 1) 'FILE_ACL_SID_DRIFT'
  $f=[Security.AccessControl.FileSystemRights]
  if($id -ceq $Sid){
   Must (($match[0].FileSystemRights -band $f::Write) -eq 0 -and
    ($match[0].FileSystemRights -band $f::Delete) -eq 0 -and
    ($match[0].FileSystemRights -band $f::ChangePermissions) -eq 0) 'TARGET_CAN_EDIT_PERMIT'
  }else{
   Must (($match[0].FileSystemRights -band $f::FullControl) -eq $f::FullControl) 'ADMIN_SYSTEM_NOT_FULL'
  }
 }
 return $acl
}
function Assert-TargetAbsent {
 $user=Get-LocalUser -Name $Target -ErrorAction Stop
 Must ($user.SID.Value -ceq $Sid -and -not $user.Enabled) 'TARGET_NOT_DISABLED'
 $acc=@(Get-CimInstance Win32_UserAccount -Filter ("SID='"+$Sid+"'") -ErrorAction Stop)
 Must ($acc.Count -eq 1) 'CIM_ACCOUNT_UNKNOWN'
 $sessions=@(Get-CimAssociatedInstance -InputObject $acc[0] -Association Win32_LoggedOnUser -ResultClassName Win32_LogonSession -ErrorAction Stop)
 Must ($sessions.Count -eq 0) 'TARGET_SESSION_REMAINS'
 $profiles=@(Get-CimInstance Win32_UserProfile -Filter ("SID='"+$Sid+"'") -ErrorAction Stop)
 Must ($profiles.Count -eq 0) 'TARGET_PROFILE_REMAINS'
 foreach($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
  if([int]$p.ProcessId -in @(0,4)){continue}
  $o=$null
  try{$o=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop}catch{$o=$null}
  if($null -ne $o -and $o.ReturnValue -eq 0 -and [string]$o.Sid -ceq $Sid){throw 'TARGET_PROCESS_REMAINS'}
 }
 Must (@([IO.Directory]::GetFileSystemEntries($Vault)).Count -eq 0) 'VAULT_NOT_EMPTY'
}
function Assert-ExistingTasks {
 foreach($name in @($WatchdogTask,$RescueTask)){
  $task=Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction Stop
  Must ($task.State -in @('Ready','Running') -and
   $task.Principal.UserId -in @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18')) 'SYSTEM_TASK_NOT_PINNED'
  Must ((Get-ScheduledTaskInfo -TaskName $name -TaskPath '\').LastTaskResult -eq 0) 'SYSTEM_TASK_UNHEALTHY'
 }
 foreach($name in @('heartbeat.json','gateb-dpapi-system-rescue-heartbeat.json')){
  Leaf (Join-Path $Root $name)
  $hb=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root $name))) -ErrorAction Stop
  Must ($hb.sid -ceq $Sid -or $name -eq 'heartbeat.json') 'RESCUE_HEARTBEAT_SID_DRIFT'
  Must ([datetime]::Parse([string]$hb.checkedUtc).ToUniversalTime() -gt [datetime]::UtcNow.AddSeconds(-150)) 'HEARTBEAT_STALE'
  if($name -eq 'heartbeat.json'){
   Must ($hb.reasonCode -ceq 'GUARD_ONLY' -and $hb.observedDisabled -eq $true) 'WATCHDOG_NOT_IDLE'
  }else{
   Must ($hb.status -ceq 'IDLE_DISABLED') 'RESCUE_NOT_IDLE'
  }
 }
}
function Prepare {
 $script:Stage='HOST_AND_PINNED_SOURCE'
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 Must ($env:COMPUTERNAME -ceq $HostPin -and
  $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'ADMIN_HOST_REQUIRED'
 Must ($ExpectedHead -match '^[0-9a-f]{40}$' -and
  $ExpectedInstallerSha256 -match '^[0-9a-f]{64}$') 'OWNER_PINS_MISSING'
 Must ((git -C $Repo rev-parse HEAD).Trim() -ceq $ExpectedHead -and $LASTEXITCODE -eq 0) 'HEAD_DRIFT'
 Must (@(git -C $Repo status --porcelain).Count -eq 0 -and $LASTEXITCODE -eq 0) 'DIRTY_REPOSITORY'
 Must ((Sha $PSCommandPath) -ceq $ExpectedInstallerSha256) 'UPGRADER_SHA_DRIFT'
 $script:Sid=(Get-LocalUser -Name $Target -ErrorAction Stop).SID.Value
 Assert-ProtectedRoot
 Assert-TargetAbsent
 Assert-ExistingTasks
 $script:Stage='HISTORIC_LEDGER_AND_GUARD'
 foreach($path in @(
  'gateb-dpapi-one-shot-consumed.marker',
  'gateb-dpapi-missing-manifest-restore-once-consumed.marker',
  'gateb-dpapi-attempt2-once-consumed.marker',
  'gateb-dpapi-attempt2-arm-manifest.json',
  'state.json.dpapi-attempt2-original',
  'state.json.dpapi-original',
  'state.json.dpapi-arm-backup')){Leaf (Join-Path $Root $path)}
 Must ((Sha (Join-Path $Root 'state.json')) -ceq $BaseOriginalSha -and
  (Sha (Join-Path $Root 'state.json.dpapi-attempt2-original')) -ceq $BaseOriginalSha) 'RESTORED_GUARD_SHA_DRIFT'
 $state=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'state.json'))) -ErrorAction Stop
 Must ($state.phase -ceq 'GUARD_ONLY' -and $state.sid -ceq $Sid -and
  [int]$state.parentPid -eq 0) 'GUARD_NOT_RESTORED'
 $prior=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'gateb-dpapi-attempt2-arm-manifest.json'))) -ErrorAction Stop
 Must ($prior.originalSha256 -ceq $BaseOriginalSha -and $prior.sid -ceq $Sid) 'ATTEMPT2_MANIFEST_DRIFT'
 foreach($path in @(
  $Ledger,
  (Join-Path $Root 'gateb-dpapi-attempt3-once-consumed.marker'),
  (Join-Path $Root 'gateb-dpapi-attempt3-arm-manifest.json'),
  (Join-Path $Root 'state.json.dpapi-attempt3-original'))){
  Must (-not [IO.File]::Exists($path)) 'ATTEMPT3_ALREADY_USED'
 }
 Must ((Sha (Join-Path $Root 'watchdog.ps1')) -ceq $WorkerSha) 'WATCHDOG_SHA_DRIFT'
 $script:Stage='PINNED_FILES_AND_PERMITS'
 $oldOwner=ConvertFrom-Json ([IO.File]::ReadAllText($OwnerPermit)) -ErrorAction Stop
 $oldProof=ConvertFrom-Json ([IO.File]::ReadAllText($ProofPermit)) -ErrorAction Stop
 Must ($oldOwner.version -eq 2 -and
  $oldOwner.approvalId -ceq 'GATEB_DPAPI_ATTEMPT2_OWNER_APPROVED' -and
  $oldOwner.attemptId -ceq 'GATEB_DPAPI_ATTEMPT2_20261108' -and
  $oldOwner.sid -ceq $Sid -and $oldOwner.task -ceq $RescueTask) 'HISTORIC_PERMIT_DRIFT'
 Must ($oldProof.version -eq 1 -and $oldProof.sid -ceq $Sid -and
  $oldProof.approvalId -ceq 'ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF') 'PROOF_PERMIT_DRIFT'
 $null=FileAcl $OwnerPermit
 $null=FileAcl $ProofPermit
 foreach($s in $Specs){
  Must ($s.Old -match '^[a-f0-9]{64}$' -and $s.New -match '^[a-f0-9]{64}$') 'SOURCE_HASH_PINS_REQUIRED'
  $dst=Join-Path $Root $s.Name
  $src=Join-Path $SourceDir $s.Source
  $null=FileAcl $dst
  Leaf $src
  Must ((Sha $dst) -ceq $s.Old -and (Sha $src) -ceq $s.New) 'SOURCE_OR_INSTALLED_SHA_DRIFT'
  Must (-not [IO.File]::Exists(($dst+'.attempt3-stage')) -and
   -not [IO.File]::Exists(($dst+'.attempt3-previous'))) 'PREVIOUS_UPGRADE_STAGE'
 }
 foreach($p in @($OwnerPermit,$ProofPermit)){
  Must (-not [IO.File]::Exists(($p+'.attempt3-stage')) -and
   -not [IO.File]::Exists(($p+'.attempt3-previous'))) 'PREVIOUS_PERMIT_STAGE'
 }
 Write-Output 'GATEB_ATTEMPT3_PREFLIGHT_PASS'
}
function AtomicUpdate([string]$Destination,[string]$Content) {
 $stage=$Destination+'.attempt3-stage'
 $backup=$Destination+'.attempt3-previous'
 Must (-not [IO.File]::Exists($stage) -and -not [IO.File]::Exists($backup)) 'PREEXISTING_STAGE_OR_BACKUP'
 $oldSha=Sha $Destination
 $acl=FileAcl $Destination
 $bytes=[Text.Encoding]::UTF8.GetBytes($Content)
 $stream=[IO.File]::Open($stage,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 [IO.File]::SetAccessControl($stage,$acl)
 [IO.File]::Replace($stage,$Destination,$backup)
 Must ((Sha $backup) -ceq $oldSha) 'BACKUP_SHA_CHANGED'
 $null=FileAcl $Destination
}
function RunUpgrade {
 Prepare
 $script:Stage='CONSUME_NEW_UPGRADE_LEDGER'
 $stream=[IO.File]::Open($Ledger,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::ASCII.GetBytes('ATTEMPT3_UPGRADE_SPENT');
  $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 $script:Stage='REPLACE_THREE_PROTECTED_SCRIPTS'
 foreach($s in $Specs){
  $dst=Join-Path $Root $s.Name
  $src=Join-Path $SourceDir $s.Source
  AtomicUpdate $dst ([IO.File]::ReadAllText($src))
  Must ((Sha $dst) -ceq $s.New) 'NEW_INSTALLED_SHA_DRIFT'
 }
 $script:Stage='AUTHORIZE_NEW_EXACT_HEAD_SCOPE'
 $deadline=[datetime]::UtcNow.AddMinutes(18).ToString('yyyy-MM-ddTHH:mm:ssZ')
 $files=[ordered]@{
  'gateb-dpapi-sid-proof.ps1'=Sha (Join-Path $Root 'gateb-dpapi-sid-proof.ps1')
  'gateb-dpapi-one-shot-coordinator.ps1'=Sha (Join-Path $Root 'gateb-dpapi-one-shot-coordinator.ps1')
  'gateb-dpapi-system-rescue.ps1'=Sha (Join-Path $Root 'gateb-dpapi-system-rescue.ps1')
  'gateb-dpapi-approval-contract.ps1'=Sha (Join-Path $Root 'gateb-dpapi-approval-contract.ps1')
 }
 $ownerV3=[ordered]@{
  version=3;approvalId='GATEB_DPAPI_ATTEMPT3_OWNER_APPROVED'
  attemptId='GATEB_DPAPI_ATTEMPT3_20261108'
  host=$HostPin;account=$Target;sid=$Sid;task=$RescueTask;head=$ExpectedHead
  maxApply=1;maxEnabledSeconds=240;maxGuardSeconds=300;deadlineUtc=$deadline
  installerSha256=$ExpectedInstallerSha256;files=$files
 }
 $proof=ConvertFrom-Json ([IO.File]::ReadAllText($ProofPermit)) -ErrorAction Stop
 $proof.deadlineUtc=$deadline
 AtomicUpdate $OwnerPermit ($ownerV3|ConvertTo-Json -Depth 6 -Compress)
 AtomicUpdate $ProofPermit ($proof|ConvertTo-Json -Depth 6 -Compress)
 . (Join-Path $Root 'gateb-dpapi-approval-contract.ps1')
 $null=Assert-GateBDpapiOwnerPermit -PermitPath $OwnerPermit -ScriptDirectory $Root -ExpectedHead $ExpectedHead -TargetSid $Sid -ExpectedTask $RescueTask -RequireUnexpired
 $script:Stage='PASSIVE_SYSTEM_HEARTBEATS'
 $start=[datetime]::UtcNow
 $initial=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'))) -ErrorAction Stop
 $until=$start.AddSeconds(135)
 $ready=$false
 while([datetime]::UtcNow -lt $until){
  Start-Sleep -Seconds 3
  $t=Get-ScheduledTaskInfo -TaskName $RescueTask -TaskPath '\' -ErrorAction Stop
  try{
   $fresh=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'))) -ErrorAction Stop
   if($t.LastTaskResult -eq 0 -and [int]$fresh.sequence -gt [int]$initial.sequence -and
    $fresh.status -ceq 'IDLE_DISABLED' -and $fresh.sid -ceq $Sid){
    $ready=$true;break
   }
  }catch{}
 }
 Must $ready 'NEW_SYSTEM_RESCUE_HEARTBEAT_MISSING'
 Assert-TargetAbsent
 Write-Output 'GATEB_ATTEMPT3_PROTECTED_UPGRADE_READY_NO_DPAPI_APPLY'
}
if($Mode -eq 'Plan'){
 Write-Output 'GATEB_ATTEMPT3_SOURCE_ONLY_NO_WINDOWS_CHANGES'
 exit 0
}
if($Mode -eq 'Preflight'){
 try{
  Prepare
  Write-Output 'GATEB_ATTEMPT3_PREFLIGHT_READONLY_PASS'
  exit 0
 }catch{
  Write-Output 'GATEB_ATTEMPT3_PREFLIGHT_READONLY_NO_GO'
  exit 3
 }
}
if($OwnerApproval -cne $Approval){
 Write-Output 'GATEB_ATTEMPT3_NEW_OWNER_APPROVAL_REQUIRED'
 exit 4
}
try{
 RunUpgrade
 exit 0
}catch{
 $code=[string]$_.Exception.Message
 if($code -notmatch '^[A-Z][A-Z_0-9]{2,100}$'){$code='UNCLASSIFIED_PREPARE_OR_INSTALL_FAILURE'}
 Write-Output ('GATEB_ATTEMPT3_UPGRADE_NO_GO_STAGE='+$Stage)
 Write-Output ('GATEB_ATTEMPT3_UPGRADE_NO_GO_CODE='+$code)
 Write-Output 'GATEB_ATTEMPT3_NO_RETRY_NO_AUTOMATIC_ROLLBACK'
 exit 3
}
