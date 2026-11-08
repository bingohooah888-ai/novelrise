# NOVELIGHT Gate B: OFFLINE-only future one-shot coordinator.
# Apply MUST remain blocked until a different OWNER-approved signed/scoped entrypoint
# establishes HEAD/hash/permit/one-shot authorization, protected SYSTEM rescue,
# and real Credential / profile attestation. Do not execute source-only functions.
[CmdletBinding()]
param([ValidateSet('Plan','Apply')][string]$Mode='Plan')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostPin='DESKTOP-8Q4GFC8'
$AccountName='NOVELIGHT-GateB'
$TaskName='NOVELIGHT-GateB-Independent-Recovery'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Vault='C:\ProgramData\NOVELIGHT\GateB'
$State=Join-Path $Root 'state.json'
$Heartbeat=Join-Path $Root 'heartbeat.json'
$Marker=Join-Path $Root 'gateb-dpapi-attempt3-once-consumed.marker'
$Original=Join-Path $Root 'state.json.dpapi-attempt3-original'
$Manifest=Join-Path $Root 'gateb-dpapi-attempt3-arm-manifest.json'
$PriorMarker=Join-Path $Root 'gateb-dpapi-one-shot-consumed.marker'
$PriorOriginal=Join-Path $Root 'state.json.dpapi-original'
$PriorArmBackup=Join-Path $Root 'state.json.dpapi-arm-backup'
$PriorRestoreMarker=Join-Path $Root 'gateb-dpapi-missing-manifest-restore-once-consumed.marker'
$PriorGuardedBackup=Join-Path $Root 'state.json.dpapi-missing-manifest-guarded-backup'
$PriorOriginalSha='1b6d10aa5365fb9dc355a2a04ea3da0e97f07ca933fd35bd4d947b758893744c'
$PriorGuardedSha='15cef1cb625648d6430c9fc14e872ce4cb401b9688feeb3216b97e65031ebda3'
$Worker=Join-Path $Root 'watchdog.ps1'
$Proof=Join-Path $Root 'gateb-dpapi-sid-proof.ps1'
$PowerShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$KnownWorkerHash='78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
$AdminSid='S-1-5-32-544'
$SystemSid='S-1-5-18'
$MaxGuardSeconds=300
$MaxEnabledSeconds=240
$Sid=''
$CurrentStage='NO_AUTHORITY'
$KnownBefore=@{}
$EnabledByCoordinator=$false
$Result='NO_GO'

function Assert-Leaf([string]$Path) {
  $f=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($f.PSIsContainer -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'UNSAFE_PATH'}
}
function Assert-PinnedLocalUser([bool]$Disabled) {
  $u=Get-LocalUser -Name $AccountName -ErrorAction Stop
  if(-not $u.SID -or $u.SID.Value -cne $Sid){throw 'TARGET_SID_CHANGED'}
  if($Disabled -and $u.Enabled){throw 'ACCOUNT_NOT_DISABLED'}
  $admins=@(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop)
  if(@($admins|Where-Object {$_.SID.Value -ceq $Sid}).Count -ne 0){throw 'TARGET_ADMIN'}
}
function Assert-ProcessAndSessionZero {
  # A protected system process can deny GetOwnerSid without belonging to the
  # target. Bind the proof to the TARGET SID, not all unrelated OS processes.
  for($pass=0;$pass -lt 2;$pass++){
    Assert-PinnedLocalUser $true
    $acc=@(Get-CimInstance Win32_UserAccount -Filter ("SID='"+$Sid+"'") -ErrorAction Stop)
    if($acc.Count -ne 1){throw 'ACCOUNT_CENSUS_UNVERIFIED'}
    $sessions=@(Get-CimAssociatedInstance -InputObject $acc[0] -Association Win32_LoggedOnUser -ResultClassName Win32_LogonSession -ErrorAction Stop)
    if($sessions.Count -ne 0){throw 'LOGON_SESSION_REMAINS'}
    $profiles=@(Get-CimInstance Win32_UserProfile -Filter ("SID='"+$Sid+"'") -ErrorAction Stop)
    if($profiles.Count -gt 1 -or
      ($profiles.Count -eq 1 -and $profiles[0].Loaded)){throw 'TARGET_PROFILE_LOADED_OR_UNVERIFIED'}
    if($pass -eq 1){continue}
    $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
    foreach($p in $processes){
      if([int]$p.ProcessId -in @(0,4)){continue}
      $owner=$null
      try{$owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop}catch{$owner=$null}
      if($null -ne $owner -and $owner.ReturnValue -eq 0 -and
        -not [string]::IsNullOrWhiteSpace([string]$owner.Sid) -and
        [string]$owner.Sid -ceq $Sid){throw 'TARGET_CHILD_REMAINS'}
    }
  }
}
function Read-PinnedGuard([string]$Phase) {
  Assert-Leaf $State
  $s=ConvertFrom-Json ([IO.File]::ReadAllText($State)) -ErrorAction Stop
  $fields=@($s.PSObject.Properties.Name)
  $wanted=@('version','host','sid','taskName','phase','deadlineUtc','parentPid','parentStartUtc')
  if($fields.Count -ne 8 -or @($fields|Where-Object {$_ -notin $wanted}).Count -ne 0 -or
     $s.version -ne 1 -or $s.host -cne $HostPin -or $s.sid -cne $Sid -or
     $s.taskName -cne $TaskName -or $s.phase -cne $Phase){throw 'UNPINNED_STATE'}
  return $s
}
function Assert-ExistingSystemWatchdog {
  $item=Get-Item $Root -Force -ErrorAction Stop
  if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'GUARD_DIR_INVALID'
  }
  $acl=[IO.Directory]::GetAccessControl($Root)
  if(-not $acl.AreAccessRulesProtected -or
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){throw 'GUARD_ACL_DRIFT'}
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if($rules.Count -ne 3){throw 'GUARD_ACL_COUNT_DRIFT'}
  foreach($id in @($AdminSid,$SystemSid,$Sid)){
    $rs=@($rules|Where-Object {$_.IdentityReference.Value -ceq $id -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited})
    if($rs.Count -ne 1){throw 'GUARD_ACL_SID_DRIFT'}
    $flag=[Security.AccessControl.FileSystemRights]
    if($id -ceq $Sid -and (($rs[0].FileSystemRights -band $flag::Write) -ne 0 -or
      ($rs[0].FileSystemRights -band $flag::Delete) -ne 0 -or
      ($rs[0].FileSystemRights -band $flag::ChangePermissions) -ne 0)){throw 'GUARD_TARGET_WRITE'}
  }
  if((Get-FileHash $Worker -Algorithm SHA256).Hash.ToLowerInvariant() -cne $KnownWorkerHash){
    throw 'WORKER_HASH_MISMATCH'
  }
  $t=Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
  $argsExpected='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$Worker+'" -Mode Recover'
  if($t.State -notin @('Ready','Running') -or $t.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or
     @($t.Actions).Count -ne 1 -or $t.Actions[0].Execute -ine $PowerShell -or
     $t.Actions[0].Arguments -cne $argsExpected){throw 'WATCHDOG_DRIFT'}
  $timed=@($t.Triggers|Where-Object {$_.CimClass.CimClassName -match 'TimeTrigger'})
  $boot=@($t.Triggers|Where-Object {$_.CimClass.CimClassName -match 'BootTrigger'})
  if(@($t.Triggers).Count -ne 2 -or $timed.Count -ne 1 -or $boot.Count -ne 1){throw 'WATCHDOG_TRIGGER_DRIFT'}
  $start=[datetime]::Parse([string]$timed[0].StartBoundary)
  $duration=[Xml.XmlConvert]::ToTimeSpan([string]$timed[0].Repetition.Duration)
  $interval=[Xml.XmlConvert]::ToTimeSpan([string]$timed[0].Repetition.Interval)
  if($duration.TotalDays -ne 7 -or $interval.TotalSeconds -ne 60 -or
     $start.Add($duration) -le (Get-Date).AddMinutes(30)){throw 'WATCHDOG_EXPIRES_SOON'}
  if((Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath '\').LastTaskResult -ne 0){throw 'WATCHDOG_LAST_RUN_FAILED'}
}
function Read-FreshHeartbeat {
  Assert-Leaf $Heartbeat
  $h=ConvertFrom-Json ([IO.File]::ReadAllText($Heartbeat)) -ErrorAction Stop
  $at=[datetime]::Parse([string]$h.checkedUtc).ToUniversalTime()
  if($h.version -ne 1 -or [int]$h.sequence -lt 2 -or
    $at -lt [datetime]::UtcNow.AddSeconds(-150) -or
    $at -gt [datetime]::UtcNow.AddSeconds(5)){throw 'WATCHDOG_HEARTBEAT_STALE'}
  return $h
}
function Assert-PriorTrialEvidenceIntact {
  # Attempt 1 was consumed and recovered by a separate approved GUARD_ONLY
  # restore. Keep those bytes immutable; only attempt-2 files may be created.
  foreach($path in @($PriorMarker,$PriorOriginal,$PriorArmBackup,
                    $PriorRestoreMarker,$PriorGuardedBackup)){
    Assert-Leaf $path
  }
  if((Get-FileHash -LiteralPath $PriorOriginal -Algorithm SHA256).Hash.ToLowerInvariant() -cne $PriorOriginalSha -or
     (Get-FileHash -LiteralPath $PriorArmBackup -Algorithm SHA256).Hash.ToLowerInvariant() -cne $PriorOriginalSha -or
     (Get-FileHash -LiteralPath $State -Algorithm SHA256).Hash.ToLowerInvariant() -cne $PriorOriginalSha -or
     (Get-FileHash -LiteralPath $PriorGuardedBackup -Algorithm SHA256).Hash.ToLowerInvariant() -cne $PriorGuardedSha){
    throw 'PRIOR_CONSUMED_TRIAL_EVIDENCE_CHANGED'
  }
  # Both previous one-shot ledgers are consumed; never alter their evidence.
  $spent2=Join-Path $Root 'gateb-dpapi-attempt2-once-consumed.marker'
  $original2=Join-Path $Root 'state.json.dpapi-attempt2-original'
  $manifest2=Join-Path $Root 'gateb-dpapi-attempt2-arm-manifest.json'
  foreach($path in @($spent2,$original2,$manifest2)){Assert-Leaf $path}
  $m2=ConvertFrom-Json ([IO.File]::ReadAllText($manifest2)) -ErrorAction Stop
  if($m2.version -ne 1 -or $m2.host -cne $HostPin -or
    $m2.sid -cne $Sid -or $m2.taskName -cne $TaskName -or
    [string]$m2.originalSha256 -cne $PriorOriginalSha -or
    [string]$m2.guardedSha256 -notmatch '^[0-9a-f]{64}$' -or
    (Get-FileHash -LiteralPath $original2 -Algorithm SHA256).Hash.ToLowerInvariant() -cne $m2.originalSha256){
    throw 'ATTEMPT2_SPENT_EVIDENCE_DRIFT'
  }
  $rescue2=Join-Path $Root 'state.json.dpapi-attempt2-rescue-backup'
  if([IO.File]::Exists($rescue2)){
    Assert-Leaf $rescue2
    if((Get-FileHash -LiteralPath $rescue2 -Algorithm SHA256).Hash.ToLowerInvariant() -cne
      [string]$m2.guardedSha256){throw 'ATTEMPT2_RESCUE_BACKUP_DRIFT'}
  }
  foreach($newPath in @($Marker,$Original,$Manifest,
    (Join-Path $Root 'state.json.dpapi-attempt3-arm-stage'),
    (Join-Path $Root 'state.json.dpapi-attempt3-arm-backup'),
    (Join-Path $Root 'state.json.dpapi-attempt3-restore-stage'),
    (Join-Path $Root 'state.json.dpapi-attempt3-restore-backup'),
    (Join-Path $Root 'state.json.dpapi-attempt3-rescue-stage'),
    (Join-Path $Root 'state.json.dpapi-attempt3-rescue-backup'))){
    if([IO.File]::Exists($newPath)){throw 'ATTEMPT3_ALREADY_CONSUMED_OR_PARTIAL'}
  }
}
function Assert-Preflight {
  $script:CurrentStage='PREFLIGHT'
  $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if($env:COMPUTERNAME -cne $HostPin -or
    -not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_HOST_REQUIRED'}
  if((Get-Service Schedule).Status -ne 'Running'){throw 'SCHEDULER_STOPPED'}
  $u=Get-LocalUser -Name $AccountName -ErrorAction Stop
  if(-not $u.SID){throw 'TARGET_SID_MISSING'}
  $script:Sid=$u.SID.Value
  Assert-PinnedLocalUser $true
  Assert-ExistingSystemWatchdog
  $s=Read-PinnedGuard 'GUARD_ONLY'
  if([int]$s.parentPid -ne 0 -or [string]$s.parentStartUtc -cne ''){throw 'GUARD_PARENT_UNEXPECTED'}
  $h=Read-FreshHeartbeat
  if($h.reasonCode -cne 'GUARD_ONLY' -or $h.observedDisabled -ne $true){throw 'GUARD_HEARTBEAT_UNVERIFIED'}
  Assert-ProcessAndSessionZero
  if(@(Get-CimInstance Win32_UserProfile -Filter ("SID='"+$Sid+"'") -ErrorAction Stop).Count -ne 0){throw 'PROFILE_ALREADY_EXISTS'}
  if(@([IO.Directory]::GetFileSystemEntries($Vault)).Count -ne 0){throw 'VAULT_NOT_EMPTY'}
  Assert-PriorTrialEvidenceIntact
  return $h
}
function New-InMemoryTargetCredential {
  # Future-only: requires separately approved Windows password reset.
  # SecureString constructed without ever storing the full password as String.
  $alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?'
  if($alphabet.Length -ne 64){throw 'INVALID_PASSWORD_ALPHABET'}
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  $password=[Security.SecureString]::new()
  $one=[byte[]]::new(1)
  try {
    for($i=0;$i -lt 48;$i++) {
      $rng.GetBytes($one)
      $password.AppendChar($alphabet[[int]($one[0] -band 63)])
    }
    $password.MakeReadOnly()
    Set-LocalUser -SID ([Security.Principal.SecurityIdentifier]::new($Sid)) -Password $password -ErrorAction Stop
    return [Management.Automation.PSCredential]::new(($HostPin+'\'+$AccountName),$password)
  } finally {
    [array]::Clear($one,0,$one.Length)
    $rng.Dispose()
    # The PSCredential retains its SecureString in memory for this one trial.
    # No log, environment value, command-line or file receives the password.
  }
}
function Consume-OneShotLedger {
  $f=[IO.File]::Open($Marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $b=[Text.Encoding]::ASCII.GetBytes('GATEB_DPAPI_ONE_SHOT_SPENT')
    $f.Write($b,0,$b.Length)
    $f.Flush($true)
  } finally {$f.Dispose()}
}
function Arm-GuardAtomically([int]$ParentPid,[string]$ParentStartUtc) {
  $baseline=Read-PinnedGuard 'GUARD_ONLY'
  if([int]$baseline.parentPid -ne 0 -or $ParentPid -le 4){throw 'BAD_PARENT_PID'}
  if([string]$ParentStartUtc -notmatch 'Z$'){throw 'BAD_PARENT_START'}
  $active=Get-Process -Id $ParentPid -ErrorAction Stop
  if($active.StartTime.ToUniversalTime().ToString('o') -cne $ParentStartUtc){throw 'PARENT_CHANGED'}
  $deadline=[datetime]::UtcNow.AddSeconds($MaxGuardSeconds).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $new=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;phase='GUARDED_TEST';
    deadlineUtc=$deadline;parentPid=$ParentPid;parentStartUtc=$ParentStartUtc}
  if([IO.File]::Exists($Original) -or [IO.File]::Exists($Manifest)){
    throw 'ORIGINAL_OR_ARM_MANIFEST_ALREADY_PRESENT'
  }
  [IO.File]::Copy($State,$Original,$false)
  $originalSha=(Get-FileHash -LiteralPath $Original -Algorithm SHA256).Hash.ToLowerInvariant()
  $temp=Join-Path $Root 'state.json.dpapi-attempt3-arm-stage'
  if([IO.File]::Exists($temp)){throw 'UNEXPECTED_ARM_STAGE'}
  $stream=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $b=[Text.Encoding]::UTF8.GetBytes(($new|ConvertTo-Json -Compress))
    $stream.Write($b,0,$b.Length)
    $stream.Flush($true)
  }finally{$stream.Dispose()}
  $armedSha=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant()
  # PowerShell variables are case-insensitive. NEVER name the manifest
  # payload '$manifest': that shadows the script-scoped $Manifest file path,
  # silently creating "System.Collections.Specialized.OrderedDictionary" in
  # the current directory instead of the protected recovery manifest.
  $armManifestData=[ordered]@{
    version=1;host=$HostPin;sid=$Sid;taskName=$TaskName
    originalSha256=$originalSha;guardedSha256=$armedSha
    parentPid=$ParentPid;parentStartUtc=$ParentStartUtc;deadlineUtc=$deadline
  }
  # Refuse to arm unless the independent SYSTEM rescue can read this exact
  # protected manifest, with the same hashes and parent/deadline scope.
  $manifestPath=Join-Path $Root 'gateb-dpapi-attempt3-arm-manifest.json'
  if($Manifest -cne $manifestPath){throw 'MANIFEST_PATH_SHADOWED'}
  $mf=[IO.File]::Open($manifestPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $data=[Text.Encoding]::UTF8.GetBytes(($armManifestData|ConvertTo-Json -Compress))
    $mf.Write($data,0,$data.Length)
    $mf.Flush($true)
  } finally {$mf.Dispose()}
  Assert-Leaf $manifestPath
  $persisted=ConvertFrom-Json ([IO.File]::ReadAllText($manifestPath)) -ErrorAction Stop
  if($persisted.version -ne 1 -or $persisted.host -cne $HostPin -or
     $persisted.sid -cne $Sid -or $persisted.taskName -cne $TaskName -or
     $persisted.originalSha256 -cne $originalSha -or
     $persisted.guardedSha256 -cne $armedSha -or
     [int]$persisted.parentPid -ne $ParentPid -or
     $persisted.parentStartUtc -cne $ParentStartUtc -or
     $persisted.deadlineUtc -cne $deadline){
    throw 'PERSISTED_ARM_MANIFEST_NOT_ATTESTED'
  }
  # Guard state cannot become GUARDED_TEST unless the rescue manifest has
  # been persisted and read back from its pinned path.
  [IO.File]::Replace($temp,$State,(Join-Path $Root 'state.json.dpapi-attempt3-arm-backup'))
  $armed=Read-PinnedGuard 'GUARDED_TEST'
  if([int]$armed.parentPid -ne $ParentPid){throw 'ARM_NOT_OBSERVED'}
  return $armed
}
function Wait-IndependentArmedHeartbeat([int]$PriorSequence) {
  $deadline=[datetime]::UtcNow.AddSeconds(82)
  while([datetime]::UtcNow -lt $deadline){
    Start-Sleep -Seconds 2
    try {
      $h=Read-FreshHeartbeat
      if([int]$h.sequence -gt $PriorSequence -and
        $h.reasonCode -ceq 'PARENT_ALIVE' -and
        $h.observedDisabled -eq $true){return $h}
    }catch{}
  }
  throw 'INDEPENDENT_ARMED_WATCHDOG_NOT_ATTESTED'
}
function Stop-ExactTargetChild([int]$ChildPid,[string]$StartUtc) {
  # Future ONE-shot scoped cleanup, not blanket process termination.
  $p=Get-Process -Id $ChildPid -ErrorAction SilentlyContinue
  if($null -eq $p){return}
  if($p.StartTime.ToUniversalTime().ToString('o') -cne $StartUtc){
    throw 'CHILD_PID_REUSED_DO_NOT_STOP'
  }
  $obj=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ChildPid) -ErrorAction Stop
  if(@($obj).Count -ne 1){throw 'CHILD_CENSUS_UNVERIFIED'}
  $owner=Invoke-CimMethod -InputObject $obj -MethodName GetOwnerSid -ErrorAction Stop
  if($owner.ReturnValue -ne 0 -or [string]$owner.Sid -cne $Sid){
    throw 'CHILD_SID_CHANGED_DO_NOT_STOP'
  }
  Stop-Process -Id $ChildPid -Force -ErrorAction Stop
  Wait-Process -Id $ChildPid -Timeout 15 -ErrorAction SilentlyContinue
  $still=Get-Process -Id $ChildPid -ErrorAction SilentlyContinue
  if($null -ne $still -and
    $still.StartTime.ToUniversalTime().ToString('o') -ceq $StartUtc){
    throw 'CHILD_STOP_UNVERIFIED'
  }
}
function Invoke-TargetProbe([Management.Automation.PSCredential]$Cred,[string]$Phase,[string]$MarkerFile) {
  # The protected probe itself validates target SID, permit SHA and guard parent.
  # Do not use S4U; load the real target user profile for CurrentUser DPAPI.
  if($Phase -notin @('TargetCreate','TargetVerify')){throw 'BAD_PHASE'}
  if([IO.File]::Exists($MarkerFile)){throw 'OUTPUT_ALREADY_PRESENT'}
  $args='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$Proof+
    '" -Mode '+$Phase+' -OwnerApproval ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF'
  $p=Start-Process -FilePath $PowerShell -ArgumentList $args -Credential $Cred -LoadUserProfile -PassThru -ErrorAction Stop
  $startUtc=$p.StartTime.ToUniversalTime().ToString('o')
  try {
    try { Wait-Process -Id $p.Id -Timeout 55 -ErrorAction Stop }
    catch {
      # A hung child may retain a valid logon token even if account disables.
      # Only this verified child PID+birth+SID may be terminated.
      Stop-ExactTargetChild ([int]$p.Id) $startUtc
      throw 'TARGET_CHILD_TIMEOUT_NO_GO'
    }
    $p.Refresh()
    if(-not $p.HasExited -or $p.ExitCode -ne 0){throw 'TARGET_PROBE_FAILED'}
    $wanted=if($Phase -ceq 'TargetCreate'){'GATEB_DPAPI_TARGET_CURRENTUSER_CREATE_PASS'}else{'GATEB_DPAPI_TARGET_SECOND_PROCESS_PASS'}
    Assert-Leaf $MarkerFile
    if(([IO.File]::ReadAllText($MarkerFile)).Trim() -cne $wanted){throw 'PROBE_EVIDENCE_UNTRUSTED'}
  }finally{$p.Dispose()}
}
function Invoke-CrossSidProbe {
  Assert-PinnedLocalUser $true
  $out=@(& $PowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Proof -Mode AdminCrossSid -OwnerApproval ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF)
  if($LASTEXITCODE -ne 0 -or @($out).Count -ne 1 -or
    [string]$out[0] -cne 'GATEB_DPAPI_DIFFERENT_SID_DENIED_PASS'){throw 'CROSS_SID_PROOF_FAILED'}
}
function Disable-TargetOnce {
  $u=Get-LocalUser -Name $AccountName -ErrorAction Stop
  if($u.SID.Value -cne $Sid){throw 'SID_MISMATCH'}
  if($u.Enabled){Disable-LocalUser -SID $u.SID -ErrorAction Stop}
  Assert-PinnedLocalUser $true
}
function Restore-GuardAtomicallyAfterProof {
  # Only from a future separately approved supervisor; cannot make recovery
  # conditional on the parent process finally executing after a crash.
  Assert-PinnedLocalUser $true
  Assert-ProcessAndSessionZero
  $guard=Read-PinnedGuard 'GUARDED_TEST'
  Assert-Leaf $Manifest
  if(-not [IO.File]::Exists($Original)){throw 'NO_ORIGINAL_GUARD'}
  Assert-Leaf $Original
  $manifest=ConvertFrom-Json ([IO.File]::ReadAllText($Manifest)) -ErrorAction Stop
  if($manifest.version -ne 1 -or $manifest.host -cne $HostPin -or
    $manifest.sid -cne $Sid -or $manifest.taskName -cne $TaskName -or
    $manifest.parentStartUtc -cne $guard.parentStartUtc -or
    [int]$manifest.parentPid -ne [int]$guard.parentPid -or
    $manifest.deadlineUtc -cne $guard.deadlineUtc){throw 'UNTRUSTED_ARM_MANIFEST'}
  $currentHash=(Get-FileHash $State -Algorithm SHA256).Hash.ToLowerInvariant()
  $originalHash=(Get-FileHash $Original -Algorithm SHA256).Hash.ToLowerInvariant()
  if($currentHash -cne $manifest.guardedSha256 -or
    $originalHash -cne $manifest.originalSha256){throw 'UNKNOWN_GUARD_STATE_NO_OVERWRITE'}
  $previous=ConvertFrom-Json ([IO.File]::ReadAllText($Original)) -ErrorAction Stop
  if($previous.phase -cne 'GUARD_ONLY' -or
     $previous.sid -cne $Sid -or $previous.host -cne $HostPin -or
     [int]$previous.parentPid -ne 0){throw 'ORIGINAL_NOT_PINNED'}
  $temp=Join-Path $Root 'state.json.dpapi-attempt3-restore-stage'
  if([IO.File]::Exists($temp)){throw 'RESTORE_STAGE_EXISTS'}
  [IO.File]::Copy($Original,$temp,$false)
  [IO.File]::Replace($temp,$State,(Join-Path $Root 'state.json.dpapi-attempt3-restore-backup'))
  $null=Read-PinnedGuard 'GUARD_ONLY'
}
function Assert-ProtectedRescueIsReady {
  $rescueTask='NOVELIGHT-GateB-DPAPI-Independent-Rescue'
  $rescue=Join-Path $Root 'gateb-dpapi-system-rescue.ps1'
  $expectedArgs='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+
    $rescue+'" -Mode Recover'
  $t=Get-ScheduledTask -TaskName $rescueTask -TaskPath '\' -ErrorAction Stop
  if($t.State -notin @('Ready','Running') -or
    $t.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or
    $t.Principal.LogonType.ToString() -cne 'ServiceAccount' -or
    @($t.Actions).Count -ne 1 -or
    $t.Actions[0].Execute -ine $PowerShell -or
    $t.Actions[0].Arguments -cne $expectedArgs){throw 'RESCUE_TASK_NOT_PINNED'}
  $triggers=@($t.Triggers)
  if(@($triggers|Where-Object {$_.CimClass.CimClassName -match 'BootTrigger'}).Count -ne 1 -or
    @($triggers|Where-Object {$_.CimClass.CimClassName -ceq 'MSFT_TaskDailyTrigger'}).Count -ne 1){
    throw 'RESCUE_TASK_TRIGGER_DRIFT'
  }
  if((Get-ScheduledTaskInfo -TaskName $rescueTask -TaskPath '\').LastTaskResult -ne 0){
    throw 'SYSTEM_RESCUE_LAST_RUN_FAILED'
  }
  $hbPath=Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'
  Assert-Leaf $hbPath
  $hb=ConvertFrom-Json ([IO.File]::ReadAllText($hbPath)) -ErrorAction Stop
  $when=[datetime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
  if($hb.version -ne 1 -or $hb.host -cne $HostPin -or
    $hb.sid -cne $Sid -or $hb.task -cne $TaskName -or
    [int]$hb.sequence -lt 1 -or
    $hb.status -cne 'IDLE_DISABLED' -or
    $when -lt [datetime]::UtcNow.AddSeconds(-150) -or
    $when -gt [datetime]::UtcNow.AddSeconds(5)){
    throw 'SYSTEM_RESCUE_NOT_ATTESTED'
  }
  return $hb
}
function Wait-RescueArmedHeartbeat([int]$PreviousSequence) {
  $deadline=[datetime]::UtcNow.AddSeconds(82)
  $hbPath=Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'
  while([datetime]::UtcNow -lt $deadline){
    Start-Sleep -Seconds 2
    try {
      $hb=ConvertFrom-Json ([IO.File]::ReadAllText($hbPath)) -ErrorAction Stop
      $at=[datetime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
      if($hb.version -eq 1 -and $hb.host -ceq $HostPin -and
        $hb.sid -ceq $Sid -and $hb.task -ceq $TaskName -and
        [int]$hb.sequence -gt $PreviousSequence -and
        $hb.status -ceq 'ARMED_PARENT_ALIVE' -and
        $at -ge [datetime]::UtcNow.AddSeconds(-150)){
        return $hb
      }
    }catch{}
  }
  throw 'INDEPENDENT_SYSTEM_RESCUE_HEARTBEAT_MISSING'
}
function Wait-GuardOnlyRestoredHeartbeats([int]$OldSeq,[int]$RescueSeq) {
  $deadline=[datetime]::UtcNow.AddSeconds(85)
  $path=Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'
  while([datetime]::UtcNow -lt $deadline){
    Start-Sleep -Seconds 2
    try {
      $existing=Read-FreshHeartbeat
      $other=ConvertFrom-Json ([IO.File]::ReadAllText($path)) -ErrorAction Stop
      $when=[datetime]::Parse([string]$other.checkedUtc).ToUniversalTime()
      if([int]$existing.sequence -gt $OldSeq -and
        $existing.reasonCode -ceq 'GUARD_ONLY' -and
        $existing.observedDisabled -eq $true -and
        $other.version -eq 1 -and $other.sid -ceq $Sid -and
        [int]$other.sequence -gt $RescueSeq -and
        $other.status -ceq 'IDLE_DISABLED' -and
        $when -ge [datetime]::UtcNow.AddSeconds(-150)){
        Assert-PinnedLocalUser $true
        return $true
      }
    }catch{}
  }
  throw 'INDEPENDENT_GUARD_ONLY_RESTORE_HEARTBEATS_MISSING'
}
# This implementation is connected exclusively through the approved protected
# Apply entrypoint after hash-pinned, admin-owned permit and rescue attestation.
# It must not be invoked directly from a local development worktree.
function Invoke-ApprovedOneShotTrial {
  param([bool]$IndependentRescueReady,[bool]$FutureSignedOwnerPermitReady)
  if(-not $IndependentRescueReady -or -not $FutureSignedOwnerPermitReady){
    throw 'INDEPENDENT_RESCUE_AND_NEW_OWNER_PERMIT_REQUIRED'
  }
  $before=Assert-Preflight
  $rescueBefore=Assert-ProtectedRescueIsReady
  $cred=$null
  $disableFailed=$false
  try {
    # Never spend a marker, reset password, arm GUARD or enable user without
    # the trusted controller. No currently exported entrypoint invokes this.
    $script:CurrentStage='CONSUME_ATTEMPT3_LEDGER'
    Consume-OneShotLedger
    $script:CurrentStage='CREDENTIAL_RESET'
    $cred=New-InMemoryTargetCredential
    $self=Get-Process -Id $PID -ErrorAction Stop
    $script:CurrentStage='ARM_GUARDED_TEST'
    $guard=Arm-GuardAtomically $PID ($self.StartTime.ToUniversalTime().ToString('o'))
    $script:CurrentStage='WAIT_SYSTEM_WATCHDOG_ARMED'
    $oldWatchdogArmed=Wait-IndependentArmedHeartbeat ([int]$before.sequence)
    $script:CurrentStage='WAIT_INDEPENDENT_SYSTEM_RESCUE_ARMED'
    $rescueArmed=Wait-RescueArmedHeartbeat ([int]$rescueBefore.sequence)
    # Must only enable after BOTH independently verified SYSTEM monitors.
    $script:CurrentStage='ENABLE_TARGET_ACCOUNT'
    Enable-LocalUser -Name $AccountName -ErrorAction Stop
    $script:EnabledByCoordinator=$true
    $startEnabled=[datetime]::UtcNow
    $script:CurrentStage='CURRENTUSER_DPAPI_TARGET_CREATE'
    Invoke-TargetProbe $cred 'TargetCreate' (Join-Path $Vault 'gateb-dpapi-target-create.receipt')
    $script:CurrentStage='CURRENTUSER_DPAPI_TARGET_VERIFY'
    Invoke-TargetProbe $cred 'TargetVerify' (Join-Path $Vault 'gateb-dpapi-target-verify.receipt')
    if([datetime]::UtcNow -gt $startEnabled.AddSeconds($MaxEnabledSeconds)){
      throw 'ACCOUNT_ENABLED_LEASE_EXPIRED'
    }
    $script:CurrentStage='DISABLE_TARGET_ACCOUNT'
    Disable-TargetOnce
    $script:CurrentStage='VERIFY_RESIDUE_ZERO'
    Assert-ProcessAndSessionZero
    $script:CurrentStage='CROSS_SID_DPAPI_DENIAL'
    Invoke-CrossSidProbe
    $script:CurrentStage='RESTORE_GUARD_ONLY'
    Restore-GuardAtomicallyAfterProof
    $script:CurrentStage='WAIT_BOTH_SYSTEM_RESTORED_HEARTBEATS'
    $null=Wait-GuardOnlyRestoredHeartbeats ([int]$oldWatchdogArmed.sequence) ([int]$rescueArmed.sequence)
    $script:Result='CANDIDATE_SEQUENCE_COMPLETED_WITH_BOTH_HEARTBEATS'
  } finally {
    # Best-effort emergency disable on this shell; parent kill bypasses finally.
    # Separate SYSTEM guard + rescue remain mandatory.
    if($script:EnabledByCoordinator) {
      try { Disable-TargetOnce } catch { $disableFailed=$true }
    }
    if($null -ne $cred){$cred.Password.Dispose()}
    if($disableFailed){throw 'EMERGENCY_DISABLE_NOT_CONFIRMED'}
  }
}
# Explicitly protected future Apply entrypoint. In the current offline
# development worktree, installation and owner permit DO NOT exist.
if($Mode -eq 'Plan'){
  Write-Output 'GATEB_DPAPI_ONE_SHOT_OFFLINE_CONTRACT_ONLY'
  exit 2
}
try {
  $installed=Join-Path $Root 'gateb-dpapi-one-shot-coordinator.ps1'
  if([IO.Path]::GetFullPath($PSCommandPath) -cne $installed){
    throw 'NOT_PROTECTED_INSTALL'
  }
  if($env:COMPUTERNAME -cne $HostPin){throw 'WRONG_HOST'}
  $principal=[Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'ADMIN_ONLY'
  }
  $target=Get-LocalUser -Name $AccountName -ErrorAction Stop
  if(-not $target.SID){throw 'TARGET_SID_NOT_FOUND'}
  $script:Sid=$target.SID.Value
  $permitPath=Join-Path $Root 'gateb-dpapi-owner-permit.json'
  $module=Join-Path $Root 'gateb-dpapi-approval-contract.ps1'
  Assert-Leaf $module
  . $module
  $raw=ConvertFrom-Json ([IO.File]::ReadAllText($permitPath)) -ErrorAction Stop
  $null=Assert-GateBDpapiOwnerPermit -PermitPath $permitPath -ScriptDirectory $Root -ExpectedHead ([string]$raw.head) -TargetSid $Sid -ExpectedTask 'NOVELIGHT-GateB-DPAPI-Independent-Rescue' -RequireUnexpired
  $script:CurrentStage='INITIAL_RESCUE_HEARTBEAT_ATTEST'
  $null=Assert-ProtectedRescueIsReady
  Invoke-ApprovedOneShotTrial -IndependentRescueReady $true -FutureSignedOwnerPermitReady $true
  if($script:Result -cne 'CANDIDATE_SEQUENCE_COMPLETED_WITH_BOTH_HEARTBEATS'){
    throw 'COMPLETION_EVIDENCE_MISSING'
  }
  Write-Output 'GATEB_DPAPI_ONE_SHOT_LOCAL_EVIDENCE_PASS_REQUIRES_OWNER_REVIEW'
  exit 0
} catch {
  # The interactive administrator can see stdout, unlike a scheduled SYSTEM
  # task. Emit only bounded diagnostic codes, NEVER raw exception details.
  $failureCode=[string]$_.Exception.Message
  if($failureCode -notmatch '^[A-Z][A-Z_0-9]{2,100}$'){
    $failureCode='UNCLASSIFIED_COORDINATOR_ERROR'
  }
  $failureStage=[string]$CurrentStage
  if($failureStage -notmatch '^[A-Z][A-Z_0-9]{2,70}$'){
    $failureStage='UNKNOWN_STAGE'
  }
  Write-Output ('GATEB_DPAPI_ONE_SHOT_NO_GO_STAGE='+$failureStage)
  Write-Output ('GATEB_DPAPI_ONE_SHOT_NO_GO_CODE='+$failureCode)
  # The independently installed SYSTEM guard/rescue must enforce recovery
  # after interrupted parents. Spent one-shot evidence is never cleared.
  Write-Output 'GATEB_DPAPI_ONE_SHOT_NO_GO_NO_RETRY'
  exit 3
}
