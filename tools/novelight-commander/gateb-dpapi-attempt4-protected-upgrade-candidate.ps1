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
$Ledger=Join-Path $Root 'gateb-dpapi-attempt4-protected-upgrade-once-consumed.marker'
$Approval='ONE_GATEB_DPAPI_ATTEMPT4_PROTECTED_UPGRADE_NEW_OWNER_APPROVAL'
$AdminSid='S-1-5-32-544'
$SystemSid='S-1-5-18'
$BaseOriginalSha='1b6d10aa5365fb9dc355a2a04ea3da0e97f07ca933fd35bd4d947b758893744c'
$WorkerSha='78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$Sid=''
$Stage='NOT_STARTED'
$SourceDir=Join-Path $Repo 'tools\novelight-commander'
$Specs=@(
 @{Name='gateb-dpapi-one-shot-coordinator.ps1';Source='gateb-dpapi-attempt4-one-shot-coordinator-candidate.ps1';Old=$ExpectedOldCoordinatorSha256;New=$ExpectedNewCoordinatorSha256},
 @{Name='gateb-dpapi-system-rescue.ps1';Source='gateb-dpapi-attempt4-system-rescue-candidate.ps1';Old=$ExpectedOldRescueSha256;New=$ExpectedNewRescueSha256},
 @{Name='gateb-dpapi-approval-contract.ps1';Source='gateb-dpapi-attempt4-approval-contract-candidate.ps1';Old=$ExpectedOldContractSha256;New=$ExpectedNewContractSha256}
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
function FileAcl([string]$file,[switch]$AllowRootInherited){
 Leaf $file
 $acl=[IO.File]::GetAccessControl($file)
 Must ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $AdminSid) 'FILE_OWNER_DRIFT'
 if($AllowRootInherited){
  # Only the three protected scripts may inherit from the already-pinned,
  # ACL-protected $Root; the two approval permits MUST remain explicit.
  Must ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($file)) -ceq $Root -and
   [IO.Path]::GetFileName($file) -in @('gateb-dpapi-one-shot-coordinator.ps1',
    'gateb-dpapi-system-rescue.ps1','gateb-dpapi-approval-contract.ps1')) 'INHERITED_SCRIPT_SCOPE_DRIFT'
 }else{
  Must $acl.AreAccessRulesProtected 'PERMIT_ACL_NOT_PROTECTED'
 }
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 Must ($rules.Count -eq 3) 'FILE_ACL_EXTRA'
 Must (@($rules|Where-Object {$_.IsInherited -ne (-not $acl.AreAccessRulesProtected)}).Count -eq 0) 'FILE_ACL_INHERITANCE_MISMATCH'
 foreach($id in @($AdminSid,$SystemSid,$Sid)){
  $match=@($rules|Where-Object{$_.IdentityReference.Value -ceq $id -and
   $_.AccessControlType -eq 'Allow'})
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
  Must ([datetime]::Parse([string]$hb.checkedUtc).ToUniversalTime() -gt [datetime]::UtcNow.AddSeconds(-150)) 'HEARTBEAT_STALE'
  if($name -eq 'heartbeat.json'){
   # The normal watchdog heartbeat intentionally has no SID field.
   Must ($hb.reasonCode -ceq 'GUARD_ONLY' -and $hb.observedDisabled -eq $true) 'WATCHDOG_NOT_IDLE'
  }else{
   # SYSTEM rescue heartbeat must still attest the exact target SID.
   Must ($hb.sid -ceq $Sid) 'RESCUE_HEARTBEAT_SID_DRIFT'
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
 Must ($Sid -ceq 'S-1-5-21-1516307207-2003879699-926988110-1005') 'TARGET_SID_DRIFT'
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
 # Attempt-3 DPAPI and the separate emergency restore have both spent ledgers.
 # Preserve them and their original/guarded evidence byte-for-byte.
 $historical3=@{
  'gateb-dpapi-attempt3-once-consumed.marker'='70056cc9690d12bbf87dbab363d3a1865ba89d444eaaf1d675c3fcd98c7c229e'
  'gateb-dpapi-attempt3-protected-upgrade-once-consumed.marker'='c466f9eb87c95172c5e4ebce836356107d456aba7883e9d62bb4f971dbd38488'
  'gateb-dpapi-attempt3-emergency-restore-once-consumed.marker'='102a9ce35fd30dcd615647cad10909922e9afed8b89c022361098182aba8738a'
  'gateb-dpapi-attempt3-arm-manifest.json'='3b2133232d04b238cffea4cc7ddd34939e66db09748279ac000d1bc4fe03060c'
  'state.json.dpapi-attempt3-original'='1b6d10aa5365fb9dc355a2a04ea3da0e97f07ca933fd35bd4d947b758893744c'
  'state.json.dpapi-attempt3-emergency-restore-backup'='31ac3cece05d0d7cea0f115000f54e3aa2c872a4656768a2120ea9eabda26146'
  'gateb-dpapi-attempt3-system-rescue-first-failure.json'='f919c239656a7a2d88cdb564f98604147ec4900117168424c21402c9b9a4670b'
 }
 foreach($name in $historical3.Keys){
  $file=Join-Path $Root $name
  Leaf $file
  Must ((Sha $file) -ceq $historical3[$name]) 'ATTEMPT3_CONSUMED_EVIDENCE_DRIFT'
 }
 $thirdManifest=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'gateb-dpapi-attempt3-arm-manifest.json'))) -ErrorAction Stop
 Must ($thirdManifest.version -eq 1 -and $thirdManifest.host -ceq $HostPin -and
  $thirdManifest.sid -ceq $Sid -and $thirdManifest.taskName -ceq $WatchdogTask -and
  $thirdManifest.originalSha256 -ceq $BaseOriginalSha -and
  $thirdManifest.guardedSha256 -ceq $historical3['state.json.dpapi-attempt3-emergency-restore-backup']) 'ATTEMPT3_MANIFEST_DRIFT'
 $previous3=@{
  'gateb-dpapi-one-shot-coordinator.ps1.attempt3-previous'='1dcbccbe09de3019dce3793f92934b09ccfb7503e58e08db7c623039895a3fb0'
  'gateb-dpapi-system-rescue.ps1.attempt3-previous'='6c0dbf432324c19cf89c70d50b816b3cfaa621d8ecf4b8e0d06bc37e624252dd'
  'gateb-dpapi-approval-contract.ps1.attempt3-previous'='cc078e2a7e428ae48c9d74d2573bc6e02642f6375ac7055b858a4b88c94a6501'
 }
 foreach($name in $previous3.Keys){
  $file=Join-Path $Root $name
  Leaf $file
  Must ((Sha $file) -ceq $previous3[$name]) 'ATTEMPT3_PROTECTED_BACKUP_DRIFT'
 }
 foreach($name in @('gateb-dpapi-owner-permit.json.attempt3-previous',
  'gateb-dpapi-sid-proof-arm.json.attempt3-previous')){Leaf (Join-Path $Root $name)}
 foreach($path in @(
  $Ledger,
  (Join-Path $Root 'gateb-dpapi-attempt4-once-consumed.marker'),
  (Join-Path $Root 'gateb-dpapi-attempt4-arm-manifest.json'),
  (Join-Path $Root 'state.json.dpapi-attempt4-original'),
  (Join-Path $Root 'state.json.dpapi-attempt4-arm-stage'),
  (Join-Path $Root 'state.json.dpapi-attempt4-arm-backup'),
  (Join-Path $Root 'state.json.dpapi-attempt4-rescue-stage'),
  (Join-Path $Root 'state.json.dpapi-attempt4-rescue-backup'),
  (Join-Path $Root 'gateb-dpapi-attempt4-system-rescue-first-failure.json'),
  (Join-Path $Root 'gateb-dpapi-attempt4-emergency-restore-once-consumed.marker'),
  (Join-Path $Root 'state.json.dpapi-attempt4-emergency-restore-stage'),
  (Join-Path $Root 'state.json.dpapi-attempt4-emergency-restore-backup'))){
  Must (-not [IO.File]::Exists($path)) 'ATTEMPT4_ALREADY_USED'
 }
 Must ((Sha (Join-Path $Root 'watchdog.ps1')) -ceq $WorkerSha) 'WATCHDOG_SHA_DRIFT'
 $script:Stage='PINNED_FILES_AND_PERMITS'
 $oldOwner=ConvertFrom-Json ([IO.File]::ReadAllText($OwnerPermit)) -ErrorAction Stop
 $oldProof=ConvertFrom-Json ([IO.File]::ReadAllText($ProofPermit)) -ErrorAction Stop
 Must ($oldOwner.version -eq 3 -and
  $oldOwner.approvalId -ceq 'GATEB_DPAPI_ATTEMPT3_OWNER_APPROVED' -and
  $oldOwner.attemptId -ceq 'GATEB_DPAPI_ATTEMPT3_20261108' -and
  $oldOwner.head -ceq 'ed029ee39e9eaa0e4a71365a365a021a78462587' -and
  $oldOwner.installerSha256 -ceq 'a16eba0af27f35d4111c6140fc3b7d16f1b7879eac75258ffec426eaf64939d8' -and
  $oldOwner.sid -ceq $Sid -and $oldOwner.task -ceq $RescueTask) 'HISTORIC_PERMIT_DRIFT'
 Must ($oldProof.version -eq 1 -and $oldProof.sid -ceq $Sid -and
  $oldProof.approvalId -ceq 'ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF') 'PROOF_PERMIT_DRIFT'
 $null=FileAcl $OwnerPermit
 $null=FileAcl $ProofPermit
 Must ($ExpectedOldCoordinatorSha256 -ceq '50c952505c2784e660b1e7f3b696a44d39443e18c53eb940b007be61e4ef438f' -and
  $ExpectedOldRescueSha256 -ceq 'db5882ce91e9336b9ad9d4b0f92f1ca18c51c44f60be655ad4e42bb3ef713222' -and
  $ExpectedOldContractSha256 -ceq '5c2fc69c0d2811ff6fc64aa8048c4fc8dc5be5434d45c10602f9e47e2d5e68ed') 'ATTEMPT3_INSTALLED_SOURCE_DRIFT'
 foreach($s in $Specs){
  Must ($s.Old -match '^[a-f0-9]{64}$' -and $s.New -match '^[a-f0-9]{64}$') 'SOURCE_HASH_PINS_REQUIRED'
  $dst=Join-Path $Root $s.Name
  $src=Join-Path $SourceDir $s.Source
  $null=FileAcl $dst -AllowRootInherited
  Leaf $src
  Must ((Sha $dst) -ceq $s.Old -and (Sha $src) -ceq $s.New) 'SOURCE_OR_INSTALLED_SHA_DRIFT'
  Must (-not [IO.File]::Exists(($dst+'.attempt4-stage')) -and
   -not [IO.File]::Exists(($dst+'.attempt4-previous'))) 'PREVIOUS_UPGRADE_STAGE'
 }
 foreach($p in @($OwnerPermit,$ProofPermit)){
  Must (-not [IO.File]::Exists(($p+'.attempt4-stage')) -and
   -not [IO.File]::Exists(($p+'.attempt4-previous'))) 'PREVIOUS_PERMIT_STAGE'
 }
 Write-Output 'GATEB_ATTEMPT4_PREFLIGHT_PASS'
}
function AtomicUpdate([string]$Destination,[string]$Content,[switch]$AllowRootInherited) {
 $stage=$Destination+'.attempt4-stage'
 $backup=$Destination+'.attempt4-previous'
 Must (-not [IO.File]::Exists($stage) -and -not [IO.File]::Exists($backup)) 'PREEXISTING_STAGE_OR_BACKUP'
 $oldSha=Sha $Destination
 $acl=FileAcl $Destination -AllowRootInherited:$AllowRootInherited
 $bytes=[Text.Encoding]::UTF8.GetBytes($Content)
 $stream=[IO.File]::Open($stage,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 [IO.File]::SetAccessControl($stage,$acl)
 [IO.File]::Replace($stage,$Destination,$backup)
 Must ((Sha $backup) -ceq $oldSha) 'BACKUP_SHA_CHANGED'
 $null=FileAcl $Destination -AllowRootInherited:$AllowRootInherited
}
function RunUpgrade {
 Prepare
 $script:Stage='CONSUME_NEW_UPGRADE_LEDGER'
 $stream=[IO.File]::Open($Ledger,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::ASCII.GetBytes('ATTEMPT4_UPGRADE_SPENT');
  $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 $script:Stage='REPLACE_THREE_PROTECTED_SCRIPTS'
 foreach($s in $Specs){
  $dst=Join-Path $Root $s.Name
  $src=Join-Path $SourceDir $s.Source
  AtomicUpdate $dst ([IO.File]::ReadAllText($src)) -AllowRootInherited
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
 $ownerV4=[ordered]@{
  version=4;approvalId='GATEB_DPAPI_ATTEMPT4_OWNER_APPROVED'
  attemptId='GATEB_DPAPI_ATTEMPT4_20261108'
  host=$HostPin;account=$Target;sid=$Sid;task=$RescueTask;head=$ExpectedHead
  maxApply=1;maxEnabledSeconds=240;maxGuardSeconds=300;deadlineUtc=$deadline
  installerSha256=$ExpectedInstallerSha256;files=$files
 }
 $proof=ConvertFrom-Json ([IO.File]::ReadAllText($ProofPermit)) -ErrorAction Stop
 $proof.deadlineUtc=$deadline
 AtomicUpdate $OwnerPermit ($ownerV4|ConvertTo-Json -Depth 6 -Compress)
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
 Write-Output 'GATEB_ATTEMPT4_PROTECTED_UPGRADE_READY_NO_DPAPI_APPLY'
}
if($Mode -eq 'Plan'){
 Write-Output 'GATEB_ATTEMPT4_SOURCE_ONLY_NO_WINDOWS_CHANGES'
 exit 0
}
if($Mode -eq 'Preflight'){
 try{
  Prepare
  Write-Output 'GATEB_ATTEMPT4_PREFLIGHT_READONLY_PASS'
  exit 0
 }catch{
  $code=[string]$_.Exception.Message
  if($code -notmatch '^[A-Z][A-Z_0-9]{2,100}$'){$code='UNCLASSIFIED_PREFLIGHT_FAILURE'}
  Write-Output ('GATEB_ATTEMPT4_PREFLIGHT_READONLY_NO_GO_CODE='+$code)
  exit 3
 }
}
if($OwnerApproval -cne $Approval){
 Write-Output 'GATEB_ATTEMPT4_NEW_OWNER_APPROVAL_REQUIRED'
 exit 4
}
try{
 RunUpgrade
 exit 0
}catch{
 $code=[string]$_.Exception.Message
 if($code -notmatch '^[A-Z][A-Z_0-9]{2,100}$'){$code='UNCLASSIFIED_PREPARE_OR_INSTALL_FAILURE'}
 Write-Output ('GATEB_ATTEMPT4_UPGRADE_NO_GO_STAGE='+$Stage)
 Write-Output ('GATEB_ATTEMPT4_UPGRADE_NO_GO_CODE='+$code)
 Write-Output 'GATEB_ATTEMPT4_NO_RETRY_NO_AUTOMATIC_ROLLBACK'
 exit 3
}
