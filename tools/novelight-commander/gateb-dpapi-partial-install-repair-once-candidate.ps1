# Owner-approved partial-install REPAIR candidate, never auto-run.
# PLAN reads source only. REPAIR is guarded by new SHA-pinned owner consent.
# No task change, password change, account enable, DPAPI execution or marker deletion.
[CmdletBinding()]
param([ValidateSet('Plan','Repair')][string]$Mode='Plan',
  [string]$ExpectedHead='',[string]$OwnerApproval='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostPin='DESKTOP-8Q4GFC8'
$Repo='C:\Users\bingo\Documents\novelrise-ai-020705-gateb-dpapi-20261106'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Account='NOVELIGHT-GateB'
$OldTask='NOVELIGHT-GateB-Independent-Recovery'
$RescueTask='NOVELIGHT-GateB-DPAPI-Independent-Rescue'
$OldHead='5ffda47c3d2f82ce6a323640551471b1cc31a13d'
$Approval='ONE_GATEB_DPAPI_PARTIAL_PROTECTED_REPAIR_20261108'
$AdminSid='S-1-5-32-544'
$SystemSid='S-1-5-18'
$WorkerHash='78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$Marker=Join-Path $Root 'gateb-dpapi-protected-repair-once-consumed.marker'
$OwnerPermit=Join-Path $Root 'gateb-dpapi-owner-permit.json'
$ProofPermit=Join-Path $Root 'gateb-dpapi-sid-proof-arm.json'
$RescueHb=Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'
$Stage='NOT_STARTED'
$Sid=''
$OldSequence=0
$Specs=@(
 [pscustomobject]@{Src='gateb-dpapi-one-shot-coordinator-candidate.ps1';Dst='gateb-dpapi-one-shot-coordinator.ps1';Old='f63af13bd7c9a3b1bfa42a8e528a1c1320341084e1c784d9b726420f82dc7dd3';New='3559015c291f5e37b61e7b98e184f79c167432e2fd2a8422f03ff64e17181674'},
 [pscustomobject]@{Src='gateb-dpapi-system-rescue-candidate.ps1';Dst='gateb-dpapi-system-rescue.ps1';Old='271b17c556fb37e8d11140cce3d84d79e0ef6781728e5d6f8450ac603f759ecd';New='c8d06b16e9594a8e46460dc5afc34cf2a8f51d2e5aba6025b49713553c0a16fc'}
)
function Leaf([string]$f) {
 $item=Get-Item -LiteralPath $f -Force -ErrorAction Stop
 if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'LEAF_UNTRUSTED'}
}
function Sha([string]$f){return (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
function Pinned([string]$f,[string]$want){Leaf $f;if((Sha $f) -cne $want){throw 'FILE_SHA_DRIFT'}}
function RootAcl {
 $dir=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
 $a=[IO.Directory]::GetAccessControl($Root)
 if(-not $dir.PSIsContainer -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or -not $a.AreAccessRulesProtected -or $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){throw 'ROOT_UNTRUSTED'}
 $rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if($rules.Count -ne 3){throw 'ROOT_EXTRA_RULES'}
 foreach($id in @($AdminSid,$SystemSid,$Sid)){
  $x=@($rules|Where-Object{$_.IdentityReference.Value -ceq $id -and $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited})
  if($x.Count -ne 1){throw 'ROOT_SID_DRIFT'}
  $flag=[Security.AccessControl.FileSystemRights];$rights=$x[0].FileSystemRights
  if($id -ceq $Sid){
   if(($rights -band $flag::Write) -ne 0 -or ($rights -band $flag::Delete) -ne 0 -or ($rights -band $flag::ChangePermissions) -ne 0 -or ($rights -band $flag::TakeOwnership) -ne 0){throw 'TARGET_ROOT_WRITE'}
  }elseif(($rights -band $flag::FullControl) -ne $flag::FullControl){throw 'ROOT_ADMIN_SYSTEM_DRIFT'}
 }
}
function CheckPermitAcl([string]$f,[bool]$protected) {
 $a=[IO.File]::GetAccessControl($f)
 if($a.AreAccessRulesProtected -ne $protected -or $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){throw 'PERMIT_ACL_PROTECTION_DRIFT'}
 $rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if($rules.Count -ne 3){throw 'PERMIT_EXTRA_RULES'}
 foreach($id in @($AdminSid,$SystemSid,$Sid)){
  $x=@($rules|Where-Object{$_.IdentityReference.Value -ceq $id -and $_.AccessControlType -eq 'Allow'})
  if($x.Count -ne 1 -or ($protected -and $x[0].IsInherited)){throw 'PERMIT_ACL_IDENTITY_DRIFT'}
  $flag=[Security.AccessControl.FileSystemRights];$rights=$x[0].FileSystemRights
  if($id -ceq $Sid) {
   if(($rights -band $flag::Read) -ne $flag::Read -or ($rights -band $flag::Write) -ne 0 -or ($rights -band $flag::Delete) -ne 0 -or ($rights -band $flag::ChangePermissions) -ne 0 -or ($rights -band $flag::TakeOwnership) -ne 0){throw 'TARGET_PERMIT_WRITE'}
  }elseif(($rights -band $flag::FullControl) -ne $flag::FullControl){throw 'PERMIT_ADMIN_SYSTEM_DRIFT'}
 }
}
function NewPermitAcl {
 $a=New-Object Security.AccessControl.FileSecurity
 $a.SetAccessRuleProtection($true,$false)
 $a.SetOwner([Security.Principal.SecurityIdentifier]::new($AdminSid))
 foreach($pair in @(
  @{sid=$AdminSid;rights=[Security.AccessControl.FileSystemRights]::FullControl},
  @{sid=$SystemSid;rights=[Security.AccessControl.FileSystemRights]::FullControl},
  @{sid=$Sid;rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute}
 )) {
  $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new([string]$pair.sid),$pair.rights,[Security.AccessControl.AccessControlType]::Allow)
  $a.AddAccessRule($rule)
 }
 return $a
}
function CheckTask([string]$name,[string]$worker) {
 $t=Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction Stop
 $args='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$worker+'" -Mode Recover'
 if($t.State -notin @('Running','Ready') -or $t.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or $t.Principal.LogonType.ToString() -cne 'ServiceAccount' -or @($t.Actions).Count -ne 1 -or $t.Actions[0].Execute -ine 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -or $t.Actions[0].Arguments -cne $args){throw 'TASK_SCOPE_DRIFT'}
 $triggers=@($t.Triggers)
 if($name -ceq $RescueTask){
  $daily=@($triggers|Where-Object{$_.CimClass.CimClassName -ceq 'MSFT_TaskDailyTrigger'})
  $boot=@($triggers|Where-Object{$_.CimClass.CimClassName -ceq 'MSFT_TaskBootTrigger'})
  if($triggers.Count -ne 2 -or $daily.Count -ne 1 -or $boot.Count -ne 1 -or [string]$daily[0].Repetition.Interval -cne 'PT1M' -or [string]$daily[0].Repetition.Duration -cne 'P1D'){throw 'RESCUE_TRIGGER_DRIFT'}
 }else{
  $time=@($triggers|Where-Object{$_.CimClass.CimClassName -ceq 'MSFT_TaskTimeTrigger'})
  if($time.Count -ne 1 -or ([datetime]::Parse([string]$time[0].StartBoundary)).Add([Xml.XmlConvert]::ToTimeSpan([string]$time[0].Repetition.Duration)) -le (Get-Date).AddMinutes(30)){throw 'OLD_WATCHDOG_EXPIRING'}
 }
}
function Preflight {
 $script:Stage='PREFLIGHT'
 $me=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if($env:COMPUTERNAME -cne $HostPin -or -not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_HOST_REQUIRED'}
 if($ExpectedHead -notmatch '^[0-9a-f]{40}$' -or $ExpectedHead -ceq $OldHead){throw 'NEW_HEAD_REQUIRED'}
 if((git -C $Repo rev-parse HEAD).Trim() -cne $ExpectedHead -or $LASTEXITCODE -ne 0){throw 'HEAD_CHANGED'}
 if(@(git -C $Repo status --porcelain).Count -ne 0 -or $LASTEXITCODE -ne 0){throw 'WORKTREE_DIRTY'}
 $u=Get-LocalUser -Name $Account -ErrorAction Stop
 if(-not $u.SID -or $u.Enabled){throw 'TARGET_NOT_DISABLED'}
 $script:Sid=$u.SID.Value
 if(@(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop|Where-Object{$_.SID.Value -ceq $Sid}).Count -ne 0){throw 'TARGET_ADMIN'}
 if((Get-Service Schedule -ErrorAction Stop).Status -ne 'Running'){throw 'SCHEDULER_STOPPED'}
 RootAcl
 Pinned (Join-Path $Root 'watchdog.ps1') $WorkerHash
 CheckTask $OldTask (Join-Path $Root 'watchdog.ps1')
 CheckTask $RescueTask (Join-Path $Root 'gateb-dpapi-system-rescue.ps1')
 $s=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'state.json'))) -ErrorAction Stop
 if($s.version -ne 1 -or $s.host -cne $HostPin -or $s.sid -cne $Sid -or $s.taskName -cne $OldTask -or $s.phase -cne 'GUARD_ONLY' -or [int]$s.parentPid -ne 0){throw 'GUARD_ONLY_UNVERIFIED'}
 foreach($name in @('gateb-dpapi-install-once.marker','gateb-dpapi-rescue-registration-repair-once-consumed.marker')){Leaf (Join-Path $Root $name)}
 foreach($name in @($Marker,'gateb-dpapi-one-shot-consumed.marker','gateb-dpapi-apply-wrapper-once-consumed.marker','gateb-dpapi-permit-renewal-once-consumed.marker','gateb-dpapi-arm-manifest.json','state.json.dpapi-original')){
  $f=if($name -ceq $Marker){$Marker}else{Join-Path $Root $name}
  if([IO.File]::Exists($f)){throw 'ALREADY_CONSUMED_OR_PARTIAL'}
 }
 foreach($spec in $Specs){
  Pinned (Join-Path $Root $spec.Dst) $spec.Old
  Pinned (Join-Path (Join-Path $Repo 'tools\novelight-commander') $spec.Src) $spec.New
  foreach($suffix in @('stage','previous')){
   if([IO.File]::Exists((Join-Path $Root ($spec.Dst+'.repair-'+$suffix)))){throw 'REPAIR_STAGES_PRESENT'}
  }
 }
 Pinned (Join-Path $Root 'gateb-dpapi-sid-proof.ps1') 'bc9fd7919d62e06f09d159a79396b0546dcf95b4b1a2b229064a945568e85d5c'
 Pinned (Join-Path $Root 'gateb-dpapi-approval-contract.ps1') '2c7dac7da51a29be070e5f0ba9b47927ea1ecbb9f5f924cea17290daf464caf6'
 Leaf $OwnerPermit;Leaf $ProofPermit
 CheckPermitAcl $OwnerPermit $true
 CheckPermitAcl $ProofPermit $false
 $owner=ConvertFrom-Json ([IO.File]::ReadAllText($OwnerPermit)) -ErrorAction Stop
 $proof=ConvertFrom-Json ([IO.File]::ReadAllText($ProofPermit)) -ErrorAction Stop
 if($owner.version -ne 1 -or $owner.approvalId -cne 'GATEB_DPAPI_ONE_SHOT_OWNER_APPROVED' -or $owner.host -cne $HostPin -or $owner.account -cne $Account -or $owner.sid -cne $Sid -or $owner.head -cne $OldHead -or $owner.task -cne $RescueTask -or $owner.maxApply -ne 1 -or $owner.maxGuardSeconds -ne 300 -or $owner.maxEnabledSeconds -ne 240){throw 'OWNER_SCOPE_DRIFT'}
 foreach($sp in $Specs){if([string]$owner.files.($sp.Dst) -cne $sp.Old){throw 'OLD_OWNER_HASH_DRIFT'}}
 if([string]$owner.files.'gateb-dpapi-sid-proof.ps1' -cne 'bc9fd7919d62e06f09d159a79396b0546dcf95b4b1a2b229064a945568e85d5c' -or [string]$owner.files.'gateb-dpapi-approval-contract.ps1' -cne '2c7dac7da51a29be070e5f0ba9b47927ea1ecbb9f5f924cea17290daf464caf6'){throw 'OTHER_HASH_DRIFT'}
 if($proof.version -ne 1 -or $proof.host -cne $HostPin -or $proof.account -cne $Account -or $proof.sid -cne $Sid -or $proof.approvalId -cne 'ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF' -or $proof.scriptSha256 -cne [string]$owner.files.'gateb-dpapi-sid-proof.ps1' -or [string]$proof.deadlineUtc -cne [string]$owner.deadlineUtc){throw 'PROOF_SCOPE_DRIFT'}
 if([datetime]::Parse([string]$owner.deadlineUtc).ToUniversalTime() -gt [datetime]::UtcNow){throw 'OLD_PERMIT_NOT_EXPIRED'}
 foreach($n in @('gateb-dpapi-owner-permit.json','gateb-dpapi-sid-proof-arm.json')){
  foreach($suffix in @('stage','previous')){if([IO.File]::Exists((Join-Path $Root ($n+'.repair-'+$suffix)))){throw 'PERMIT_BACKUP_EXISTS'}}
 }
 $h=ConvertFrom-Json ([IO.File]::ReadAllText($RescueHb)) -ErrorAction Stop
 if($h.version -ne 1 -or $h.host -cne $HostPin -or $h.sid -cne $Sid -or $h.task -cne $OldTask -or $h.status -cne 'IDLE_DISABLED' -or [int]$h.sequence -lt 1){throw 'OLD_RESCUE_HEARTBEAT_UNTRUSTED'}
 $script:PreviousSequence=[int]$h.sequence
 $oldhb=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'heartbeat.json'))) -ErrorAction Stop
 if($oldhb.reasonCode -cne 'GUARD_ONLY' -or $oldhb.observedDisabled -ne $true -or [datetime]::Parse([string]$oldhb.checkedUtc).ToUniversalTime() -lt [datetime]::UtcNow.AddSeconds(-150)){throw 'OLD_WATCHDOG_UNHEALTHY'}
 $script:Owner=$owner;$script:Proof=$proof
 Write-Output 'GATEB_DPAPI_PROTECTED_REPAIR_PREFLIGHT_PASS'
}
function NewAcl {
 $a=New-Object Security.AccessControl.FileSecurity
 $a.SetAccessRuleProtection($true,$false)
 $a.SetOwner([Security.Principal.SecurityIdentifier]::new($AdminSid))
 foreach($pair in @(
  @{id=$AdminSid;right=[Security.AccessControl.FileSystemRights]::FullControl},
  @{id=$SystemSid;right=[Security.AccessControl.FileSystemRights]::FullControl},
  @{id=$Sid;right=[Security.AccessControl.FileSystemRights]::ReadAndExecute}
 )){$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new([string]$pair.id),$pair.right,[Security.AccessControl.AccessControlType]::Allow);$a.AddAccessRule($rule)}
 return $a
}
function ReplacePinned([string]$stage,[string]$target,[string]$backup) {
 if([IO.File]::Exists($backup)){throw 'BACKUP_ALREADY_EXISTS'}
 Leaf $stage;Leaf $target
 [IO.File]::Replace($stage,$target,$backup)
}
function StageJson([string]$stage,[object]$obj,[Security.AccessControl.FileSecurity]$acl) {
 $data=[Text.Encoding]::UTF8.GetBytes(($obj|ConvertTo-Json -Depth 6 -Compress))
 $f=[IO.File]::Open($stage,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$f.Write($data,0,$data.Length);$f.Flush($true)}finally{$f.Dispose()}
 [IO.File]::SetAccessControl($stage,$acl)
}
function RunRepair {
 Preflight
 $script:Stage='CONSUME_ONCE'
 $m=[IO.File]::Open($Marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$b=[Text.Encoding]::ASCII.GetBytes('GATEB_DPAPI_PROTECTED_REPAIR_CONSUMED');$m.Write($b,0,$b.Length);$m.Flush($true)}finally{$m.Dispose()}
 $script:Stage='REPLACE_TWO_SCRIPTS'
 foreach($sp in $Specs) {
  $src=Join-Path (Join-Path $Repo 'tools\novelight-commander') $sp.Src
  $dest=Join-Path $Root $sp.Dst
  $stage=$dest+'.repair-stage';$backup=$dest+'.repair-previous'
  [IO.File]::Copy($src,$stage,$false)
  Pinned $stage $sp.New
  ReplacePinned $stage $dest $backup
  Pinned $dest $sp.New;Pinned $backup $sp.Old
 }
 $script:Stage='UPDATE_OWNER_AND_PROOF_PERMIT'
 $deadline=[datetime]::UtcNow.AddMinutes(18).ToString('yyyy-MM-ddTHH:mm:ssZ')
 $Owner.head=$ExpectedHead;$Owner.deadlineUtc=$deadline
 foreach($sp in $Specs){$Owner.files.($sp.Dst)=$sp.New}
 $Proof.deadlineUtc=$deadline
 $acl=NewAcl
 StageJson ($OwnerPermit+'.repair-stage') $Owner $acl
 StageJson ($ProofPermit+'.repair-stage') $Proof $acl
 ReplacePinned ($OwnerPermit+'.repair-stage') $OwnerPermit ($OwnerPermit+'.repair-previous')
 ReplacePinned ($ProofPermit+'.repair-stage') $ProofPermit ($ProofPermit+'.repair-previous')
 # File.Replace preserves the destination inheritance flag on Windows.
 # Re-read proof target, explicitly protect the EXISTING three safe ACEs,
 # then re-read and verify. This does not grant additional permissions.
 $proofAcl=[IO.File]::GetAccessControl($ProofPermit)
 $proofAcl.SetAccessRuleProtection($true,$true)
 [IO.File]::SetAccessControl($ProofPermit,$proofAcl)
 CheckPermitAcl $OwnerPermit $true;CheckPermitAcl $ProofPermit $true
 $script:Stage='VERIFY_NEW_HASH_AND_PERMITS'
 . (Join-Path $Root 'gateb-dpapi-approval-contract.ps1')
 $approval=Assert-GateBDpapiOwnerPermit -PermitPath $OwnerPermit -ScriptDirectory $Root -ExpectedHead $ExpectedHead -TargetSid $Sid -ExpectedTask $RescueTask -RequireUnexpired
 $proofNow=ConvertFrom-Json ([IO.File]::ReadAllText($ProofPermit)) -ErrorAction Stop
 if([string]$approval.deadlineUtc -cne $deadline -or [string]$proofNow.deadlineUtc -cne $deadline){throw 'PERMIT_DEADLINE_NOT_ATTESTED'}
 $script:Stage='WAIT_FRESH_SYSTEM_RESCUE'
 $until=[datetime]::UtcNow.AddSeconds(115)
 while([datetime]::UtcNow -lt $until){
  Start-Sleep -Seconds 2
  try {
   $u=Get-LocalUser -Name $Account -ErrorAction Stop
   if($u.Enabled -or $u.SID.Value -cne $Sid){throw 'TARGET_CHANGED'}
   $h=ConvertFrom-Json ([IO.File]::ReadAllText($RescueHb)) -ErrorAction Stop
   $time=[datetime]::Parse([string]$h.checkedUtc).ToUniversalTime()
   if($h.version -eq 1 -and $h.host -ceq $HostPin -and $h.sid -ceq $Sid -and $h.task -ceq $OldTask -and $h.status -ceq 'IDLE_DISABLED' -and [int]$h.sequence -gt $PreviousSequence -and $time -ge [datetime]::UtcNow.AddSeconds(-135) -and (Get-ScheduledTaskInfo -TaskName $RescueTask -TaskPath '\').LastTaskResult -eq 0) {
    Write-Output 'GATEB_DPAPI_RESCUE_FRESH_HEARTBEAT_PASS'
    return
   }
  }catch{}
 }
 throw 'RESCUE_HEARTBEAT_NOT_RESTORED'
}
if($Mode -eq 'Plan'){Write-Output 'GATEB_DPAPI_PROTECTED_REPAIR_OFFLINE_PLAN_ONLY';exit 2}
if($OwnerApproval -cne $Approval){Write-Output 'GATEB_DPAPI_PROTECTED_REPAIR_NEW_APPROVAL_REQUIRED';exit 4}
try {
 RunRepair
 Write-Output 'GATEB_DPAPI_PROTECTED_REPAIR_COMPLETE_NO_DPAPI_APPLY'
 exit 0
}catch {
 Write-Output ('GATEB_DPAPI_PROTECTED_REPAIR_NO_GO_STAGE_'+$Stage)
 Write-Output 'GATEB_DPAPI_PROTECTED_REPAIR_NO_AUTORETRY'
 exit 3
}
