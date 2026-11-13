# Gate B future admin-only install plan. No operations when Plan (default).
# Mode Install requires a NEW one-shot owner permit in preexisting protected root.
# Must be executed ONLY under a later separate OWNER approval, never automatically.
[CmdletBinding()]
param([ValidateSet('Plan','Install')][string]$Mode='Plan',
  [string]$SourceRepo='',
  [string]$ExpectedHead='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Root='C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$TaskName='NOVELIGHT-GateB-DPAPI-Independent-Rescue'
$ExistingTask='NOVELIGHT-GateB-Independent-Recovery'
$AccountName='NOVELIGHT-GateB'
$Permit=Join-Path $Root 'gateb-dpapi-owner-permit.json'
$SetupMarker=Join-Path $Root 'gateb-dpapi-install-once.marker'
$SystemSid='S-1-5-18'
$AdminSid='S-1-5-32-544'
$Scripts=@(
  @{source='gateb-dpapi-sid-proof-candidate.ps1';installed='gateb-dpapi-sid-proof.ps1'},
  @{source='gateb-dpapi-one-shot-coordinator-candidate.ps1';installed='gateb-dpapi-one-shot-coordinator.ps1'},
  @{source='gateb-dpapi-system-rescue-candidate.ps1';installed='gateb-dpapi-system-rescue.ps1'},
  @{source='gateb-dpapi-approval-contract.ps1';installed='gateb-dpapi-approval-contract.ps1'}
)
function Assert-InstallPrerequisites {
  $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if($env:COMPUTERNAME -cne 'DESKTOP-8Q4GFC8' -or
    -not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'PINNED_ADMIN_REQUIRED'
  }
  $u=Get-LocalUser $AccountName -ErrorAction Stop
  if(-not $u.SID -or $u.Enabled){throw 'TARGET_MUST_BE_DISABLED'}
  $sid=$u.SID.Value
  if(@(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop|
    Where-Object {$_.SID.Value -ceq $sid}).Count -ne 0){throw 'TARGET_ADMIN'}
  $dir=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if(-not $dir.PSIsContainer -or
    ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'ROOT_REPARSE'}
  $acl=[IO.Directory]::GetAccessControl($Root)
  if(-not $acl.AreAccessRulesProtected -or
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){
    throw 'ROOT_ACL_UNTRUSTED'
  }
  if((Get-ScheduledTask -TaskName $ExistingTask -ErrorAction Stop).State -notin @('Ready','Running')){
    throw 'EXISTING_SYSTEM_WATCHDOG_UNAVAILABLE'
  }
  if($SourceRepo -eq '' -or $ExpectedHead -notmatch '^[0-9a-f]{40}$'){
    throw 'PINNED_SOURCE_REQUIRED'
  }
  $repo=[IO.Path]::GetFullPath($SourceRepo)
  if($repo -notlike 'C:\Users\bingo\Documents\novelrise-ai-020705-gateb-dpapi-20261106'){
    throw 'SOURCE_NOT_PINNED'
  }
  $actual=(git -C $repo rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $actual -cne $ExpectedHead -or
    @(git -C $repo status --porcelain).Count -ne 0){
    throw 'SOURCE_HEAD_DIRTY_OR_DRIFT'
  }
  if([IO.File]::Exists($SetupMarker) -or
    (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)){
    throw 'SETUP_ALREADY_CONSUMED'
  }
  $permitItem=Get-Item -LiteralPath $Permit -Force -ErrorAction Stop
  if($permitItem.PSIsContainer -or
    ($permitItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'UNSAFE_PERMIT'
  }
  $permitAcl=[IO.File]::GetAccessControl($Permit)
  if(-not $permitAcl.AreAccessRulesProtected -or
    $permitAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid){
    throw 'PERMIT_NOT_OWNER_CONTROLLED'
  }
  $permitRules=@($permitAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if($permitRules.Count -ne 3){throw 'PERMIT_HAS_UNTRUSTED_ACCESS'}
  foreach($permitSid in @($AdminSid,$SystemSid,$sid)){
    $allowed=@($permitRules|Where-Object {
      $_.IdentityReference.Value -ceq $permitSid -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if($allowed.Count -ne 1){throw 'PERMIT_ACCESS_DRIFT'}
    $rights=$allowed[0].FileSystemRights
    $flag=[Security.AccessControl.FileSystemRights]
    if($permitSid -ceq $sid){
      if(($rights -band $flag::Read) -ne $flag::Read -or
        ($rights -band $flag::Write) -ne 0 -or
        ($rights -band $flag::Delete) -ne 0 -or
        ($rights -band $flag::ChangePermissions) -ne 0 -or
        ($rights -band $flag::TakeOwnership) -ne 0){throw 'PERMIT_TARGET_MODIFY_RIGHTS'}
    }elseif(($rights -band $flag::FullControl) -ne $flag::FullControl){
      throw 'PERMIT_ADMIN_SYSTEM_ACCESS_DRIFT'
    }
  }
  $permitObject=ConvertFrom-Json ([IO.File]::ReadAllText($Permit)) -ErrorAction Stop
  if($permitObject.version -ne 1 -or
    $permitObject.approvalId -cne 'GATEB_DPAPI_ONE_SHOT_OWNER_APPROVED' -or
    $permitObject.host -cne 'DESKTOP-8Q4GFC8' -or
    $permitObject.account -cne $AccountName -or
    $permitObject.sid -cne $sid -or
    $permitObject.task -cne $TaskName -or
    $permitObject.head -cne $ExpectedHead -or
    $permitObject.maxApply -ne 1 -or
    $permitObject.maxGuardSeconds -ne 300 -or
    $permitObject.maxEnabledSeconds -ne 240){
    throw 'OWNER_PERMIT_SCOPE_INVALID'
  }
  $deadline=[datetime]::Parse([string]$permitObject.deadlineUtc).ToUniversalTime()
  if($deadline -le [datetime]::UtcNow -or
    $deadline -gt [datetime]::UtcNow.AddMinutes(20)){throw 'PERMIT_EXPIRED'}
  $installerHash=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if($installerHash -cne $permitObject.installerSha256){throw 'INSTALLER_NOT_OWNER_HASH_PINNED'}
  $fileFields=@($permitObject.files.PSObject.Properties.Name)
  $expectedFields=@($Scripts|ForEach-Object {$_.installed})
  if($fileFields.Count -ne $expectedFields.Count -or
    @($fileFields|Where-Object {$_ -notin $expectedFields}).Count -ne 0){
    throw 'PERMIT_MANIFEST_WRONG'
  }
  foreach($spec in $Scripts){
    $src=Join-Path (Join-Path $repo 'tools\novelight-commander') $spec.source
    $dest=Join-Path $Root $spec.installed
    $item=Get-Item -LiteralPath $src -Force -ErrorAction Stop
    if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      [IO.File]::Exists($dest)){throw 'SOURCE_OR_DEST_UNTRUSTED'}
    $want=[string]$permitObject.files.($spec.installed)
    if($want -notmatch '^[0-9a-f]{64}$' -or
      (Get-FileHash $src -Algorithm SHA256).Hash.ToLowerInvariant() -cne $want){
      throw 'SOURCE_NOT_OWNER_HASH_PINNED'
    }
  }
  return $permitObject
}
function Install-Once {
  $null=Assert-InstallPrerequisites
  # Consume the install marker before any installed file or task changes.
  $mark=[IO.File]::Open($SetupMarker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $bytes=[Text.Encoding]::ASCII.GetBytes('OWNER_APPROVED_INSTALL_CONSUMED')
    $mark.Write($bytes,0,$bytes.Length);$mark.Flush($true)
  }finally{$mark.Dispose()}
  foreach($spec in $Scripts){
    $src=Join-Path (Join-Path $SourceRepo 'tools\novelight-commander') $spec.source
    $dest=Join-Path $Root $spec.installed
    [IO.File]::Copy($src,$dest,$false)
  }
  # The DPAPI probe has its own minimal protected permit bound to the
  # already owner-pinned installed script hash and the same expiry.
  $p=ConvertFrom-Json ([IO.File]::ReadAllText($Permit)) -ErrorAction Stop
  $probePermit=[ordered]@{
    version=1;host='DESKTOP-8Q4GFC8';account=$AccountName
    sid=(Get-LocalUser $AccountName -ErrorAction Stop).SID.Value
    scriptSha256=[string]$p.files.'gateb-dpapi-sid-proof.ps1'
    deadlineUtc=[string]$p.deadlineUtc
    approvalId='ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF'
  }
  $armPath=Join-Path $Root 'gateb-dpapi-sid-proof-arm.json'
  $arm=[IO.File]::Open($armPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $bytes=[Text.Encoding]::UTF8.GetBytes(($probePermit|ConvertTo-Json -Compress))
    $arm.Write($bytes,0,$bytes.Length)
    $arm.Flush($true)
  }finally{$arm.Dispose()}
  # Startup-recovery task: daily repetition indefinitely until separately
  # removed by OWNER. A boot trigger recovers even when the daily schedule lags.
  $start=[DateTime]::Today.ToString('yyyy-MM-ddTHH:mm:ss')
  $command='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $argument='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+
    (Join-Path $Root 'gateb-dpapi-system-rescue.ps1')+'" -Mode Recover'
  $xml=@"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Gate B DPAPI independent SYSTEM rescue</Description></RegistrationInfo>
<Triggers>
<BootTrigger><Enabled>true</Enabled></BootTrigger>
<CalendarTrigger><Repetition><Interval>PT1M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
<StartBoundary>$start</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>
</Triggers>
<Principals><Principal id="Author"><UserId>S-1-5-18</UserId><LogonType>ServiceAccount</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
<StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled></Settings>
<Actions Context="Author"><Exec><Command>$command</Command><Arguments>$argument</Arguments></Exec></Actions>
</Task>
"@
  # A future OWNER approval includes task registration, not just file copy.
  Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Xml $xml -ErrorAction Stop | Out-Null
  $t=Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
  if($t.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or
    $t.Principal.LogonType.ToString() -cne 'ServiceAccount' -or
    @($t.Actions).Count -ne 1 -or $t.Actions[0].Arguments -cne $argument){
    throw 'INSTALLED_SYSTEM_TASK_NOT_PINNED'
  }
  . (Join-Path $Root 'gateb-dpapi-approval-contract.ps1')
  $null=Assert-GateBDpapiOwnerPermit -PermitPath $Permit -ScriptDirectory $Root -ExpectedHead $ExpectedHead -TargetSid $probePermit.sid -ExpectedTask $TaskName -RequireUnexpired
  # This is a live check ONLY under a newly approved future Install run.
  # Wait until the independent SYSTEM task itself writes an IDLE heartbeat.
  $heartbeat=Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'
  $end=[datetime]::UtcNow.AddSeconds(85)
  $attested=$false
  while([datetime]::UtcNow -lt $end){
    Start-Sleep -Seconds 2
    if(-not [IO.File]::Exists($heartbeat)){continue}
    try {
      $h=ConvertFrom-Json ([IO.File]::ReadAllText($heartbeat)) -ErrorAction Stop
      $stamp=[datetime]::Parse([string]$h.checkedUtc).ToUniversalTime()
      $last=Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
      if($h.version -eq 1 -and $h.host -ceq 'DESKTOP-8Q4GFC8' -and
        $h.sid -ceq $probePermit.sid -and
        $h.task -ceq $ExistingTask -and $h.status -ceq 'IDLE_DISABLED' -and
        [int]$h.sequence -ge 1 -and
        $stamp -ge [datetime]::UtcNow.AddSeconds(-120) -and
        $last.LastTaskResult -eq 0 -and
        -not (Get-LocalUser -Name $AccountName -ErrorAction Stop).Enabled){
        $attested=$true
        break
      }
    }catch{}
  }
  if(-not $attested){throw 'INDEPENDENT_SYSTEM_RESCUE_HEARTBEAT_NOT_OBSERVED'}
  Write-Output 'GATEB_DPAPI_INSTALL_AND_INDEPENDENT_RESCUE_HEARTBEAT_PASS'
}
if($Mode -eq 'Plan'){
  Write-Output 'GATEB_DPAPI_INSTALL_OFFLINE_PLAN_ONLY'
  exit 2
}
try {
  Install-Once
  exit 0
} catch {
  # Important: partial install is NOT rolled back or re-tried.
  Write-Output 'GATEB_DPAPI_INSTALL_NO_GO_DO_NOT_RETRY'
  exit 3
}
