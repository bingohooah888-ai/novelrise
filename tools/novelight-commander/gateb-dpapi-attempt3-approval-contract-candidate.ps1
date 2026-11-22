# Source-only approval contract for a separately authorized Windows administrator.
# Import does not mutate Windows; accepts no password, secret, or token.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Assert-GateBDpapiOwnerPermit {
  param(
    [Parameter(Mandatory)][string]$PermitPath,
    [Parameter(Mandatory)][string]$ScriptDirectory,
    [Parameter(Mandatory)][string]$ExpectedHead,
    [Parameter(Mandatory)][string]$TargetSid,
    [Parameter(Mandatory)][string]$ExpectedTask,
    [switch]$RequireUnexpired
  )
  $ownerSid='S-1-5-32-544'
  if($env:COMPUTERNAME -cne 'DESKTOP-8Q4GFC8'){throw 'WRONG_HOST'}
  $me=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if(-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and
    [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne 'S-1-5-18'){
    throw 'ADMIN_OR_SYSTEM_REQUIRED'
  }
  $dir=[IO.Path]::GetFullPath($ScriptDirectory)
  if($dir -cne 'C:\ProgramData\NOVELIGHT\GateB-Watchdog'){throw 'UNPINNED_INSTALL_ROOT'}
  $item=Get-Item -LiteralPath $dir -Force -ErrorAction Stop
  if(-not $item.PSIsContainer -or
    ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'UNTRUSTED_DIR'}
  $acl=[IO.Directory]::GetAccessControl($dir)
  if(-not $acl.AreAccessRulesProtected -or
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $ownerSid){
    throw 'UNTRUSTED_DIR_ACL'
  }
  if([IO.Path]::GetFullPath($PermitPath) -cne (Join-Path $dir 'gateb-dpapi-owner-permit.json')){
    throw 'UNPINNED_PERMIT_PATH'
  }
  $file=Get-Item -LiteralPath $PermitPath -Force -ErrorAction Stop
  if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'BAD_PERMIT_LEAF'
  }
  # A target SID must not be able to edit or replace the approval permit.
  $permitAcl=[IO.File]::GetAccessControl($PermitPath)
  if(-not $permitAcl.AreAccessRulesProtected -or
    $permitAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $ownerSid){
    throw 'PERMIT_OWNER_DRIFT'
  }
  $rules=@($permitAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  $trusted=@($ownerSid,'S-1-5-18',$TargetSid)
  if($rules.Count -ne 3){throw 'PERMIT_EXTRA_ACL_RULES'}
  foreach($id in $trusted){
    $matches=@($rules|Where-Object {$_.IdentityReference.Value -ceq $id -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited})
    if($matches.Count -ne 1){throw 'PERMIT_ACL_IDENTITY_DRIFT'}
    $flags=[Security.AccessControl.FileSystemRights]
    $rights=$matches[0].FileSystemRights
    if($id -ceq $TargetSid){
      if(($rights -band $flags::Read) -ne $flags::Read -or
        ($rights -band $flags::Write) -ne 0 -or
        ($rights -band $flags::Delete) -ne 0 -or
        ($rights -band $flags::ChangePermissions) -ne 0 -or
        ($rights -band $flags::TakeOwnership) -ne 0){throw 'PERMIT_WRITABLE_BY_TARGET'}
    }elseif(($rights -band $flags::FullControl) -ne $flags::FullControl){
      throw 'PERMIT_ADMIN_SYSTEM_ACL_DRIFT'
    }
  }
  $json=[IO.File]::ReadAllText($PermitPath,[Text.Encoding]::UTF8)
  $approval=ConvertFrom-Json -InputObject $json -ErrorAction Stop
  $fields=@($approval.PSObject.Properties.Name)
  $expected=@('version','approvalId','attemptId','host','account','sid','task','head',
    'maxApply','maxEnabledSeconds','maxGuardSeconds','deadlineUtc','installerSha256','files')
  if($fields.Count -ne $expected.Count -or
    @($fields|Where-Object {$_ -notin $expected}).Count -ne 0){
    throw 'PERMIT_FIELDS_DRIFT'
  }
  if($approval.version -ne 3 -or
     $approval.approvalId -cne 'GATEB_DPAPI_ATTEMPT3_OWNER_APPROVED' -or
     $approval.attemptId -cne 'GATEB_DPAPI_ATTEMPT3_20261108' -or
     $approval.host -cne 'DESKTOP-8Q4GFC8' -or
     $approval.account -cne 'NOVELIGHT-GateB' -or
     $approval.sid -cne $TargetSid -or
     $approval.task -cne $ExpectedTask -or
     $approval.head -cne $ExpectedHead -or
     $approval.maxApply -ne 1 -or
     $approval.maxEnabledSeconds -ne 240 -or
     $approval.maxGuardSeconds -ne 300 -or
     [string]$approval.deadlineUtc -notmatch 'Z$'){throw 'PERMIT_SCOPE_MISMATCH'}
  if($RequireUnexpired){
    $expires=[datetime]::Parse([string]$approval.deadlineUtc).ToUniversalTime()
    if($expires -le [datetime]::UtcNow -or
      $expires -gt [datetime]::UtcNow.AddMinutes(20)){
      throw 'OWNER_PERMIT_NOT_FRESH'
    }
  }
  $names=@(
    'gateb-dpapi-sid-proof.ps1',
    'gateb-dpapi-one-shot-coordinator.ps1',
    'gateb-dpapi-system-rescue.ps1',
    'gateb-dpapi-approval-contract.ps1'
  )
  $actualFields=@($approval.files.PSObject.Properties.Name)
  if($actualFields.Count -ne $names.Count -or
    @($actualFields|Where-Object {$_ -notin $names}).Count -ne 0){
    throw 'PERMIT_HASH_LIST_DRIFT'
  }
  foreach($name in $names){
    $hash=[string]$approval.files.$name
    if($hash -notmatch '^[0-9a-f]{64}$'){throw 'PERMIT_HASH_INVALID'}
    $path=Join-Path $dir $name
    $leaf=Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if($leaf.PSIsContainer -or
       ($leaf.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'INSTALLED_FILE_UNTRUSTED'}
    if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hash){
      throw 'INSTALLED_FILE_SHA_DRIFT'
    }
  }
  return $approval
}
