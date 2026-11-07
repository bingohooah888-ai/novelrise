# OFFLINE CANDIDATE. No live operation without a NEW, exact-SHA OWNER approval.
[CmdletBinding()]
param(
 [ValidateSet('Plan','Preflight','Arm','Verify','Cleanup')]
 [string]$Mode='Plan',
 [string]$OwnerApproval=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$HostName='DESKTOP-8Q4GFC8'
$UserName='NOVELIGHT-GateB'
$TaskName='NOVELIGHT-GateB-Independent-Recovery'
$Parent='C:\ProgramData\NOVELIGHT'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Source=Join-Path $PSScriptRoot 'gateb-recovery-watchdog-worker.ps1'
$Installed=Join-Path $Root 'watchdog.ps1'
$WorkerHash='766b91d8238572fcbbcefcc2edf825d0d32d29ae2e2bb6d9136845cc3bece5d5'
$PowerShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$AdminSid='S-1-5-32-544'
$SystemSid='S-1-5-18'

if($Mode -eq 'Plan'){
 Write-Output 'GATEB_WATCHDOG_OFFLINE_PLAN_ONLY_NO_MUTATION'
 exit 0
}
function Assert-Trust {
 param([string]$Path,[string]$MemberSid)
 $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
 if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'BAD_PATH'}
 $acl=[IO.Directory]::GetAccessControl($Path)
 if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){throw 'ACL_OWNER'}
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if($rules.Count -ne 3){throw 'ACL_COUNT'}
 foreach($sid in @($AdminSid,$SystemSid,$MemberSid)){
  $matches=@($rules | Where-Object {$_.IdentityReference.Value -ceq $sid -and $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited})
  if($matches.Count -ne 1){throw 'ACL_IDENTITY'}
  $rights=$matches[0].FileSystemRights
  if($sid -eq $MemberSid){
   $flags=[Security.AccessControl.FileSystemRights]
   if(($rights -band $flags::ReadAndExecute) -ne $flags::ReadAndExecute -or
      ($rights -band $flags::Write) -ne 0 -or ($rights -band $flags::Delete) -ne 0 -or
      ($rights -band $flags::ChangePermissions) -ne 0 -or
      ($rights -band $flags::TakeOwnership) -ne 0){throw 'MEMBER_WRITABLE'}
  }elseif(($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
          [Security.AccessControl.FileSystemRights]::FullControl){throw 'ADMIN_NOT_FULL'}
 }
}
function Get-AccountDisabled {
 if($env:COMPUTERNAME -cne $HostName -or $env:ProgramData -ine 'C:\ProgramData'){throw 'HOST'}
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'NOT_ADMIN'}
 $user=Get-LocalUser -Name $UserName -ErrorAction Stop
 if(-not $user.SID -or $user.Enabled){throw 'ACCOUNT_MUST_BE_DISABLED'}
 $members=@(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop)
 if(@($members|Where-Object {$_.SID.Value -ceq $user.SID.Value}).Count -ne 0){throw 'ADMIN_ACCOUNT'}
 if((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $WorkerHash){throw 'SOURCE_HASH'}
 if(-not (Test-Path -LiteralPath $PowerShell -PathType Leaf)){throw 'POWERSHELL_MISSING'}
 if((Get-Service -Name 'Schedule' -ErrorAction Stop).Status -ne 'Running'){
  throw 'TASK_SCHEDULER_UNAVAILABLE'
 }
 foreach($command in @('Register-ScheduledTask','Start-ScheduledTask','Stop-ScheduledTask',
   'Unregister-ScheduledTask','Disable-LocalUser','New-ScheduledTaskTrigger')){
  if(-not (Get-Command $command -ErrorAction SilentlyContinue)){throw 'TASK_COMMAND_MISSING'}
 }
 $profiles=@(Get-CimInstance Win32_UserProfile -Filter (
   "SID='" + $user.SID.Value + "'"
 ) -ErrorAction Stop)
 if($profiles.Count -ne 0){throw 'UNEXPECTED_EXISTING_USER_PROFILE'}
 return $user
}
function Assert-PinnedTask {
 $task=Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
 $a=@($task.Actions)
 $exactArgs='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Installed + '" -Mode Recover'
 if($a.Count -ne 1 -or $a[0].Execute -ine $PowerShell -or $a[0].Arguments -cne $exactArgs){throw 'ACTION_DRIFT'}
 if($task.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or
    $task.Principal.LogonType.ToString() -ne 'ServiceAccount'){throw 'PRINCIPAL_DRIFT'}
 if(@($task.Triggers).Count -ne 2){throw 'TRIGGER_DRIFT'}
 if((Get-FileHash -LiteralPath $Installed -Algorithm SHA256).Hash.ToLowerInvariant() -cne $WorkerHash){throw 'INSTALL_HASH'}
}
$stage='PREFLIGHT'
try{
 $user=Get-AccountDisabled
 if($Mode -in @('Preflight','Arm')){
  if(Test-Path -LiteralPath $Root){throw 'DIRECTORY_ALREADY_EXISTS'}
  if($null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)){throw 'TASK_ALREADY_EXISTS'}
  Assert-Trust -Path $Parent -MemberSid $user.SID.Value
  $parentEntries=@([IO.Directory]::GetFileSystemEntries($Parent))
  $expectedExistingChild=Join-Path $Parent 'GateB'
  if($parentEntries.Count -ne 1 -or $parentEntries[0] -cne $expectedExistingChild){
    throw 'PARENT_CONTENTS_CHANGED'
  }
  if($Mode -eq 'Preflight'){
   Write-Output 'GATEB_WATCHDOG_PREFLIGHT_READY_NO_MUTATION'
   exit 0
  }
 }
 if($Mode -eq 'Arm'){
  if($OwnerApproval -cne 'ARM_ONE_GATEB_WATCHDOG_GUARD_ONLY_TASK_AND_FOLDER'){throw 'APPROVAL_REQUIRED'}
  $stage='CREATE_PROTECTED_WATCHDOG_FOLDER'
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true,$false)
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($AdminSid))
  foreach($sid in @($AdminSid,$SystemSid)){
   $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
     [Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit, ObjectInherit','None','Allow'
   ))
  }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
   $user.SID,'ReadAndExecute','ContainerInherit, ObjectInherit','None','Allow'
  ))
  [IO.Directory]::CreateDirectory($Root,$acl)|Out-Null
  Assert-Trust -Path $Root -MemberSid $user.SID.Value
  $stage='STAGE_HASH_PINNED_WORKER'
  [IO.File]::Copy($Source,$Installed,$false)
  if((Get-FileHash $Installed -Algorithm SHA256).Hash.ToLowerInvariant() -cne $WorkerHash){throw 'WORKER_CHANGED'}
  $stage='CREATE_NON_SECRET_GUARD_STATE'
  [IO.File]::WriteAllText((Join-Path $Root 'target-sid.txt'),$user.SID.Value,(New-Object Text.UTF8Encoding($false)))
  $obj=[ordered]@{
    version=1;host=$HostName;sid=$user.SID.Value;taskName=$TaskName;
    phase='GUARD_ONLY';deadlineUtc=[DateTime]::UtcNow.AddMinutes(15).ToString('yyyy-MM-ddTHH:mm:ssZ');
    parentPid=0;parentStartUtc=''
  }
  [IO.File]::WriteAllText((Join-Path $Root 'state.json'),($obj|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
  $stage='REGISTER_ONE_FIXED_SYSTEM_TASK'
  $arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$Installed+'" -Mode Recover'
  $action=New-ScheduledTaskAction -Execute $PowerShell -Argument $arguments
  $triggers=@(
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 7)),
    (New-ScheduledTaskTrigger -AtStartup)
  )
  $identity=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $null=Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $identity -Settings $settings -ErrorAction Stop
  Assert-PinnedTask
  $stage='VERIFY_INDEPENDENT_SYSTEM_HEARTBEAT'
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $proof=$false
  for($i=0;$i -lt 15;$i++){
   Start-Sleep -Seconds 1
   $file=Join-Path $Root 'heartbeat.json'
   if(Test-Path -LiteralPath $file -PathType Leaf){
    try{
     $hb=ConvertFrom-Json ([IO.File]::ReadAllText($file)) -ErrorAction Stop
     $time=[DateTime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
     if($hb.status -ceq 'WATCHDOG_DISABLED_CONFIRMED' -and $hb.observedDisabled -eq $true -and
        $time -gt [DateTime]::UtcNow.AddSeconds(-20)){$proof=$true;break}
    }catch{}
   }
  }
  if(-not $proof){throw 'HEARTBEAT_NOT_ATTESTED'}
  Write-Output 'GATEB_WATCHDOG_GUARD_ONLY_ARMED_SYSTEM_HEARTBEAT_PASS'
  exit 0
 }
 if($Mode -in @('Verify','Cleanup')){
  $stage='CHECK_PINNED_WATCHDOG'
  Assert-Trust -Path $Root -MemberSid $user.SID.Value
  Assert-PinnedTask
  if([IO.File]::ReadAllText((Join-Path $Root 'target-sid.txt')).Trim() -cne $user.SID.Value){throw 'SID_DRIFT'}
  $state=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $Root 'state.json'))) -ErrorAction Stop
  if($state.phase -cne 'GUARD_ONLY' -or $state.sid -cne $user.SID.Value){throw 'NOT_GUARD_ONLY'}
  if($Mode -eq 'Verify'){
   $heartbeatPath=Join-Path $Root 'heartbeat.json'
   $hb=ConvertFrom-Json ([IO.File]::ReadAllText($heartbeatPath)) -ErrorAction Stop
   $stamp=[DateTime]::Parse([string]$hb.checkedUtc).ToUniversalTime()
   if($hb.version -ne 1 -or [int]$hb.sequence -lt 2 -or
      $hb.status -cne 'WATCHDOG_DISABLED_CONFIRMED' -or
      $hb.observedDisabled -ne $true -or
      $stamp -lt [DateTime]::UtcNow.AddSeconds(-90) -or
      $stamp -gt [DateTime]::UtcNow.AddSeconds(5)){
     throw 'REPEATED_SYSTEM_HEARTBEAT_UNVERIFIED'
   }
   Write-Output 'GATEB_WATCHDOG_REPEAT_SYSTEM_HEARTBEAT_READONLY_VERIFIED'
   exit 0
  }
  if($OwnerApproval -cne 'CLEANUP_ONE_GATEB_WATCHDOG_AFTER_DISABLED_PROOF'){throw 'CLEANUP_APPROVAL_REQUIRED'}
  $stage='CLEANUP_ONLY_GUARD_ONLY_AND_DISABLED'
  $existingProfile=@(Get-CimInstance Win32_UserProfile -Filter (
    "SID='" + $user.SID.Value + "'"
  ) -ErrorAction Stop)
  if($existingProfile.Count -ne 0){throw 'PROFILE_STILL_PRESENT_NO_CLEANUP'}
  $allowed=@('watchdog.ps1','target-sid.txt','state.json','heartbeat.json')
  $entries=@([IO.Directory]::GetFileSystemEntries($Root))
  if(@($entries|Where-Object {[IO.Path]::GetFileName($_) -notin $allowed}).Count -gt 0){throw 'UNKNOWN_FILES'}
  $active=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if($active.State -eq 'Running'){
   Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  }
  $stopped=$false
  for($i=0;$i -lt 10;$i++){
   $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
   if($task.State -ne 'Running'){$stopped=$true;break}
   Start-Sleep -Seconds 1
  }
  if(-not $stopped){throw 'TASK_STILL_RUNNING'}
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
  if($null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)){throw 'TASK_REMAINING'}
  $stage='CLEAN_ONLY_OWNED_FILES'
  foreach($name in $allowed){
   $file=Join-Path $Root $name
   if([IO.File]::Exists($file)){[IO.File]::Delete($file)}
  }
  [IO.Directory]::Delete($Root,$false)
  if([IO.Directory]::Exists($Root) -or
    (Get-LocalUser -Name $UserName -ErrorAction Stop).Enabled){throw 'RESIDUE'}
  Write-Output 'GATEB_WATCHDOG_ONE_TASK_AND_FOLDER_CLEANED'
  exit 0
 }
}catch{
 Write-Output ('GATEB_WATCHDOG_FAILURE_STAGE='+$stage)
 Write-Output 'GATEB_WATCHDOG_SAFE_STOP_MANUAL_RECONCILIATION'
 exit 3
}
