# Gate B attempt 2: protected in-place coordinator/rescue/contract upgrade.
# Source-only: PLAN is inert; UPGRADE needs NEW explicit SHA-pinned Owner approval.
# Never run without separate approval; no account, password or task changes.
[CmdletBinding()]param(
 [ValidateSet('Plan','Upgrade')][string]$Mode='Plan',
 [string]$OwnerApproval='',
 [string]$ExpectedHead=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostPin='DESKTOP-8Q4GFC8'
$Repo='C:\Users\bingo\Documents\novelrise-ai-020705-gateb-dpapi-20261106'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Target='NOVELIGHT-GateB'
$Watchdog='NOVELIGHT-GateB-Independent-Recovery'
$RescueTask='NOVELIGHT-GateB-DPAPI-Independent-Rescue'
$OwnerPermit=Join-Path $Root 'gateb-dpapi-owner-permit.json'
$ProofPermit=Join-Path $Root 'gateb-dpapi-sid-proof-arm.json'
$Ledger=Join-Path $Root 'gateb-dpapi-attempt2-protected-upgrade-once-consumed.marker'
$Approval='ONE_GATEB_DPAPI_ATTEMPT2_PROTECTED_UPGRADE_20261108'
$AdminSid='S-1-5-32-544'
$Sid=''
$Stage='NOT_STARTED'
$OldOriginalSha='1b6d10aa5365fb9dc355a2a04ea3da0e97f07ca933fd35bd4d947b758893744c'
$OldGuardSha='15cef1cb625648d6430c9fc14e872ce4cb401b9688feeb3216b97e65031ebda3'
$Specs=@(
 @{Name='gateb-dpapi-one-shot-coordinator.ps1';Source='gateb-dpapi-one-shot-coordinator-candidate.ps1';Old='3559015c291f5e37b61e7b98e184f79c167432e2fd2a8422f03ff64e17181674'},
 @{Name='gateb-dpapi-system-rescue.ps1';Source='gateb-dpapi-system-rescue-candidate.ps1';Old='c8d06b16e9594a8e46460dc5afc34cf2a8f51d2e5aba6025b49713553c0a16fc'},
 @{Name='gateb-dpapi-approval-contract.ps1';Source='gateb-dpapi-approval-contract.ps1';Old='2c7dac7da51a29be070e5f0ba9b47927ea1ecbb9f5f924cea17290daf464caf6'}
)
function Must([bool]$ok,[string]$why){if(-not $ok){throw $why}}
function Sha([string]$file){return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Leaf([string]$file){
 $i=Get-Item -LiteralPath $file -Force -ErrorAction Stop
 Must (-not $i.PSIsContainer -and ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'FILE_NOT_TRUSTED'
}
function PinnedAcl([string]$file,[bool]$RequireProtected=$false){
 $acl=[IO.File]::GetAccessControl($file)
 Must ((-not $RequireProtected -or $acl.AreAccessRulesProtected) -and
  $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $AdminSid) 'FILE_ACL_OWNER_DRIFT'
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 Must ($rules.Count -eq 3) 'FILE_ACL_COUNT_DRIFT'
 $flags=[Security.AccessControl.FileSystemRights]
 foreach($id in @($AdminSid,'S-1-5-18',$Sid)){
  $matched=@($rules|Where-Object {$_.IdentityReference.Value -ceq $id -and
    $_.AccessControlType -eq 'Allow' -and
    (-not $RequireProtected -or -not $_.IsInherited)})
  Must ($matched.Count -eq 1) 'FILE_ACL_ID_DRIFT'
  $rights=$matched[0].FileSystemRights
  if($id -ceq $Sid){
   Must (($rights -band $flags::Read) -eq $flags::Read -and
    ($rights -band $flags::Write) -eq 0 -and
    ($rights -band $flags::Delete) -eq 0 -and
    ($rights -band $flags::ChangePermissions) -eq 0 -and
    ($rights -band $flags::TakeOwnership) -eq 0) 'TARGET_CAN_WRITE_PROTECTED_FILE'
  }else{
   Must (($rights -band $flags::FullControl) -eq $flags::FullControl) 'SYSTEM_ADMIN_NOT_FULL'
  }
 }
 return $acl
}
function AtomicUpdate([string]$destination,[string]$content,[string]$sourceLabel){
 $stage=$destination+'.attempt2-stage'
 $backup=$destination+'.attempt2-previous'
 Must (-not [IO.File]::Exists($stage) -and -not [IO.File]::Exists($backup)) 'PREEXISTING_UPGRADE_STAGE'
 $before=Sha $destination
 $acl=PinnedAcl $destination
 $data=[Text.Encoding]::UTF8.GetBytes($content)
 $s=[IO.File]::Open($stage,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$s.Write($data,0,$data.Length);$s.Flush($true)}finally{$s.Dispose()}
 [IO.File]::SetAccessControl($stage,$acl)
 [IO.File]::Replace($stage,$destination,$backup)
 Must ((Sha $backup) -ceq $before) 'PREVIOUS_FILE_BACKUP_NOT_PRESERVED'
 $null=PinnedAcl $destination ($sourceLabel -in @('OWNER_PERMIT','PROOF_PERMIT'))
 Write-Output ('GATEB_ATTEMPT2_UPGRADE_'+$sourceLabel+'_REPLACED_ONCE')
}
function Assert-ZeroResidual {
 $target=0;$unknown=0
 foreach($proc in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
  $id=[int]$proc.ProcessId
  if($id -in @(0,4)){continue}
  $o=$null
  try{$o=Invoke-CimMethod -InputObject $proc -MethodName GetOwnerSid -ErrorAction Stop}catch{$o=$null}
  if($null -ne $o -and $o.ReturnValue -eq 0 -and
    -not [string]::IsNullOrWhiteSpace([string]$o.Sid)){
   if([string]$o.Sid -ceq $Sid){$target++}
  }elseif(@(Get-CimInstance Win32_Process -Filter ('ProcessId='+$id) -ErrorAction Stop).Count -gt 0){$unknown++}
 }
 Must ($target -eq 0 -and $unknown -eq 0) 'TARGET_PROCESS_OR_UNKNOWN_OWNER'
 $accounts=@(Get-CimInstance Win32_UserAccount -Filter ("SID='"+$Sid+"'") -ErrorAction Stop)
 Must ($accounts.Count -eq 1) 'TARGET_ACCOUNT_CIM_UNVERIFIED'
 $sessions=@(Get-CimAssociatedInstance -InputObject $accounts[0] -Association Win32_LoggedOnUser -ResultClassName Win32_LogonSession -ErrorAction Stop)
 $profiles=@(Get-CimInstance Win32_UserProfile -Filter ("SID='"+$Sid+"'") -ErrorAction Stop)
 Must ($sessions.Count -eq 0 -and $profiles.Count -eq 0) 'TARGET_LOGON_OR_PROFILE_REMAINS'
 Must (@([IO.Directory]::GetFileSystemEntries('C:\ProgramData\NOVELIGHT\GateB')).Count -eq 0) 'VAULT_NOT_EMPTY'
}
function Prepare {
 $script:Stage='HOST_USER_AND_GIT'
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 Must ($env:COMPUTERNAME -ceq $HostPin -and
  $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'OWNER_ADMIN_REQUIRED'
 Must ($ExpectedHead -match '^[a-f0-9]{40}$' -and
  (git -C $Repo rev-parse HEAD).Trim() -ceq $ExpectedHead -and $LASTEXITCODE -eq 0) 'HEAD_DRIFT'
 $dirty=@(git -C $Repo status --porcelain)
 Must ($LASTEXITCODE -eq 0 -and $dirty.Count -eq 0) 'GIT_NOT_CLEAN'
 $u=Get-LocalUser -Name $Target -ErrorAction Stop
 Must ($null -ne $u.SID -and -not $u.Enabled) 'TARGET_NOT_DISABLED'
 $script:Sid=$u.SID.Value
 Must (@(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop|Where-Object{
   $_.SID.Value -ceq $Sid}).Count -eq 0) 'TARGET_ADMIN'
 Must ((Get-Service Schedule -ErrorAction Stop).Status -eq 'Running') 'SCHEDULER_STOPPED'
 Assert-ZeroResidual
 $rootDir=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
 $rootAcl=[IO.Directory]::GetAccessControl($Root)
 Must ($rootDir.PSIsContainer -and
  ($rootDir.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and
  $rootAcl.AreAccessRulesProtected -and
  $rootAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $AdminSid) 'ROOT_NOT_TRUSTED'
 $script:Stage='HISTORIC_EVIDENCE_AND_OLD_SCRIPTS'
 foreach($name in @('gateb-dpapi-one-shot-consumed.marker',
  'gateb-dpapi-missing-manifest-restore-once-consumed.marker')){
  Leaf (Join-Path $Root $name)
 }
 foreach($name in @('state.json','state.json.dpapi-original','state.json.dpapi-arm-backup')){
  Leaf (Join-Path $Root $name)
  Must ((Sha (Join-Path $Root $name)) -ceq $OldOriginalSha) 'OLD_ORIGINAL_SHA_CHANGED'
 }
 Must ((Sha (Join-Path $Root 'state.json.dpapi-missing-manifest-guarded-backup')) -ceq
  $OldGuardSha) 'OLD_GUARDED_SHA_CHANGED'
 Must (-not [IO.File]::Exists((Join-Path $Root 'gateb-dpapi-attempt2-once-consumed.marker')) -and
  -not [IO.File]::Exists((Join-Path $Root 'gateb-dpapi-attempt2-arm-manifest.json')) -and
  -not [IO.File]::Exists((Join-Path $Root 'state.json.dpapi-attempt2-original'))) 'ATTEMPT2_ALREADY_USED'
 Must (-not [IO.File]::Exists($Ledger)) 'UPGRADE_MARKER_ALREADY_USED'
 $state=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'state.json'))) -ErrorAction Stop
 Must ($state.phase -ceq 'GUARD_ONLY' -and $state.sid -ceq $Sid -and
  $state.host -ceq $HostPin -and [int]$state.parentPid -eq 0) 'GUARD_ONLY_NOT_ATTESTED'
 $worker=Join-Path $Root 'watchdog.ps1'
 Must ((Sha $worker) -ceq '78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c') 'WATCHDOG_SHA_CHANGED'
 foreach($task in @($Watchdog,$RescueTask)){
  $t=Get-ScheduledTask -TaskName $task -TaskPath '\' -ErrorAction Stop
  Must ($t.State -in @('Ready','Running') -and
   $t.Principal.UserId -in @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18')) 'SYSTEM_TASK_NOT_READY'
  $info=Get-ScheduledTaskInfo -TaskName $task -TaskPath '\' -ErrorAction Stop
  Must ($info.LastTaskResult -eq 0) 'SYSTEM_TASK_NOT_HEALTHY'
 }
 $heartbeat=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'heartbeat.json'))) -ErrorAction Stop
 $rescueHb=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'))) -ErrorAction Stop
 Must ($heartbeat.reasonCode -ceq 'GUARD_ONLY' -and
  $heartbeat.observedDisabled -eq $true -and
  $rescueHb.status -ceq 'IDLE_DISABLED' -and $rescueHb.sid -ceq $Sid -and
  [datetime]::Parse([string]$heartbeat.checkedUtc).ToUniversalTime() -gt [datetime]::UtcNow.AddSeconds(-150) -and
  [datetime]::Parse([string]$rescueHb.checkedUtc).ToUniversalTime() -gt [datetime]::UtcNow.AddSeconds(-150)) 'SYSTEM_HEARTBEATS_STALE'
 $script:Stage='FILES_AND_PERMITS'
 Leaf $OwnerPermit;Leaf $ProofPermit
 $null=PinnedAcl $OwnerPermit $true
 $null=PinnedAcl $ProofPermit $true
 $oldOwner=ConvertFrom-Json ([IO.File]::ReadAllText($OwnerPermit)) -ErrorAction Stop
 $oldProof=ConvertFrom-Json ([IO.File]::ReadAllText($ProofPermit)) -ErrorAction Stop
 Must ($oldOwner.version -eq 1 -and
  $oldOwner.approvalId -ceq 'GATEB_DPAPI_ONE_SHOT_OWNER_APPROVED' -and
  $oldOwner.host -ceq $HostPin -and $oldOwner.sid -ceq $Sid -and
  $oldProof.version -eq 1 -and $oldProof.sid -ceq $Sid -and
  $oldProof.approvalId -ceq 'ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF' -and
  $oldOwner.head -ceq '9dc9a6c6a8da57f4eba171b97c1dd376fb6d14e7' -and
  $oldOwner.task -ceq $RescueTask -and
  $oldOwner.maxApply -eq 1 -and $oldOwner.maxGuardSeconds -eq 300 -and
  $oldOwner.maxEnabledSeconds -eq 240 -and
  $oldProof.host -ceq $HostPin -and $oldProof.account -ceq $Target -and
  $oldProof.scriptSha256 -ceq 'bc9fd7919d62e06f09d159a79396b0546dcf95b4b1a2b229064a945568e85d5c' -and
  [string]$oldOwner.deadlineUtc -ceq [string]$oldProof.deadlineUtc) 'OLD_PERMITS_NOT_PINNED'
 $sourceFolder=Join-Path $Repo 'tools\novelight-commander'
 foreach($sp in $Specs){
  $file=Join-Path $Root $sp.Name
  Leaf $file
  $null=PinnedAcl $file
  Must ((Sha $file) -ceq $sp.Old) 'INSTALLED_OLD_FILE_SHA_DRIFT'
  Leaf (Join-Path $sourceFolder $sp.Source)
  $stage=$file+'.attempt2-stage'
  $backup=$file+'.attempt2-previous'
  Must (-not [IO.File]::Exists($stage) -and -not [IO.File]::Exists($backup)) 'PREVIOUS_UPGRADE_PARTIAL'
 }
 foreach($permit in @($OwnerPermit,$ProofPermit)){
  Must (-not [IO.File]::Exists($permit+'.attempt2-stage') -and
    -not [IO.File]::Exists($permit+'.attempt2-previous')) 'PREVIOUS_PERMIT_UPGRADE_PARTIAL'
 }
 $proofPath=Join-Path $Root 'gateb-dpapi-sid-proof.ps1'
 Must ((Sha $proofPath) -ceq 'bc9fd7919d62e06f09d159a79396b0546dcf95b4b1a2b229064a945568e85d5c') 'PROOF_SHA_CHANGED'
 $script:Stage='PREFLIGHT_PASS'
 Write-Output 'GATEB_ATTEMPT2_UPGRADE_PREFLIGHT_PASS'
}
function RunUpgrade {
 Prepare
 $script:Stage='CONSUME_NEW_UPGRADE_ONCE'
 $stream=[IO.File]::Open($Ledger,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::ASCII.GetBytes('ATTEMPT2_UPGRADE_CONSUMED');
     $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 $script:Stage='UPDATE_THREE_SCRIPTS'
 $folder=Join-Path $Repo 'tools\novelight-commander'
 foreach($sp in $Specs){
  $file=Join-Path $Root $sp.Name
  $src=Join-Path $folder $sp.Source
  AtomicUpdate $file ([IO.File]::ReadAllText($src)) $sp.Name
  Must ((Sha $file) -ceq (Sha $src)) 'INSTALLED_NEW_SHA_MISMATCH'
 }
 $script:Stage='RENEW_SCOPED_OWNER_AND_PROOF'
 $currentOwner=ConvertFrom-Json ([IO.File]::ReadAllText($OwnerPermit)) -ErrorAction Stop
 $currentProof=ConvertFrom-Json ([IO.File]::ReadAllText($ProofPermit)) -ErrorAction Stop
 $files=[ordered]@{
  'gateb-dpapi-sid-proof.ps1'=Sha (Join-Path $Root 'gateb-dpapi-sid-proof.ps1')
  'gateb-dpapi-one-shot-coordinator.ps1'=Sha (Join-Path $Root 'gateb-dpapi-one-shot-coordinator.ps1')
  'gateb-dpapi-system-rescue.ps1'=Sha (Join-Path $Root 'gateb-dpapi-system-rescue.ps1')
  'gateb-dpapi-approval-contract.ps1'=Sha (Join-Path $Root 'gateb-dpapi-approval-contract.ps1')
 }
 $deadline=[datetime]::UtcNow.AddMinutes(18).ToString('yyyy-MM-ddTHH:mm:ssZ')
 $ownerV2=[ordered]@{
  version=2;approvalId='GATEB_DPAPI_ATTEMPT2_OWNER_APPROVED'
  attemptId='GATEB_DPAPI_ATTEMPT2_20261108'
  host=$HostPin;account=$Target;sid=$Sid;task=$RescueTask;head=$ExpectedHead
  maxApply=1;maxEnabledSeconds=240;maxGuardSeconds=300;deadlineUtc=$deadline
  installerSha256=(Sha $PSCommandPath);files=$files
 }
 $currentProof.deadlineUtc=$deadline
 AtomicUpdate $OwnerPermit ($ownerV2|ConvertTo-Json -Depth 6 -Compress) 'OWNER_PERMIT'
 AtomicUpdate $ProofPermit ($currentProof|ConvertTo-Json -Depth 6 -Compress) 'PROOF_PERMIT'
 . (Join-Path $Root 'gateb-dpapi-approval-contract.ps1')
 $null=Assert-GateBDpapiOwnerPermit -PermitPath $OwnerPermit -ScriptDirectory $Root -ExpectedHead $ExpectedHead -TargetSid $Sid -ExpectedTask $RescueTask -RequireUnexpired
 $script:Stage='PASSIVE_RESCUE_HEARTBEAT_ATTEST'
 $until=[datetime]::UtcNow.AddSeconds(135)
 $ok=$false
 while([datetime]::UtcNow -lt $until){
  Start-Sleep -Seconds 3
  $t=Get-ScheduledTaskInfo -TaskName $RescueTask -TaskPath '\' -ErrorAction Stop
  try {
   $h=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'))) -ErrorAction Stop
   $age=([datetime]::UtcNow-[datetime]::Parse([string]$h.checkedUtc).ToUniversalTime()).TotalSeconds
   if($t.LastTaskResult -eq 0 -and $h.status -ceq 'IDLE_DISABLED' -and
     $h.sid -ceq $Sid -and $age -ge 0 -and $age -le 130 -and
     -not (Get-LocalUser -Name $Target -ErrorAction Stop).Enabled){
    $ok=$true;break
   }
  }catch{}
 }
 Must $ok 'NEW_RESCUE_HEARTBEAT_NOT_ATTESTED'
 Write-Output 'GATEB_ATTEMPT2_PROTECTED_SCRIPTS_AND_PERMITS_READY_NO_DPAPI_APPLY'
}
if($Mode -eq 'Plan'){
 Write-Output 'GATEB_ATTEMPT2_PROTECTED_UPGRADE_PLAN_ONLY'
 exit 0
}
if($OwnerApproval -cne $Approval){
 Write-Output 'GATEB_ATTEMPT2_NEW_OWNER_APPROVAL_REQUIRED'
 exit 4
}
try {
 RunUpgrade
 exit 0
}catch{
 $reason=[string]$_.Exception.Message
 if($reason -notmatch '^[A-Z][A-Z_0-9]{2,100}$'){$reason='UNCLASSIFIED_PROTECTED_ERROR'}
 Write-Output ('GATEB_ATTEMPT2_UPGRADE_NO_GO_STAGE='+$Stage)
 Write-Output ('GATEB_ATTEMPT2_UPGRADE_NO_GO_CODE='+$reason)
 Write-Output 'GATEB_ATTEMPT2_UPGRADE_NO_RETRY_OR_ROLLBACK'
 exit 3
}
