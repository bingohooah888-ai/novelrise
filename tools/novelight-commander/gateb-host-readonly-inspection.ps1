# Gate B Windows isolation: read-only post-create inspection.
# Never accepts a credential, changes account state/ACL, or starts a runner.
[CmdletBinding()]
param(
  [ValidateSet('Inspect')]
  [string]$Mode = 'Inspect'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedHost = 'DESKTOP-8Q4GFC8'
$accountName = 'NOVELIGHT-GateB'
$parent = 'C:\ProgramData\NOVELIGHT'
$child = 'C:\ProgramData\NOVELIGHT\GateB'
$adminSid = 'S-1-5-32-544'
$systemSid = 'S-1-5-18'

function Assert-DirectoryAcl {
  param(
    [string]$Path,
    [string]$MemberSid,
    [bool]$IsParent
  )
  $entry = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (-not $entry.PSIsContainer -or
      ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'BAD_PATH'
  }
  $acl = [IO.Directory]::GetAccessControl($Path)
  if (-not $acl.AreAccessRulesProtected) { throw 'INHERITED_ACL' }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $adminSid) {
    throw 'WRONG_OWNER'
  }
  $rules = @($acl.GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]
  ))
  if ($rules.Count -ne 3) { throw 'RULE_COUNT' }
  foreach ($sid in @($adminSid, $systemSid, $MemberSid)) {
    $one = @($rules | Where-Object {
      $_.IdentityReference.Value -eq $sid -and
      $_.AccessControlType -eq 'Allow' -and
      -not $_.IsInherited
    })
    if ($one.Count -ne 1) { throw 'RULE_IDENTITY' }
  }
  $allowed = @($adminSid, $systemSid, $MemberSid)
  if (@($rules | Where-Object {
    $_.IdentityReference.Value -notin $allowed
  }).Count -ne 0) { throw 'UNEXPECTED_IDENTITY' }
  foreach ($sid in @($adminSid, $systemSid)) {
    $grant = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })[0]
    $all = [Security.AccessControl.FileSystemRights]::FullControl
    if (($grant.FileSystemRights -band $all) -ne $all) { throw 'ADMIN_OR_SYSTEM_NOT_FULL' }
  }
  $member = @($rules | Where-Object {
    $_.IdentityReference.Value -eq $MemberSid
  })[0]
  $rights = [Security.AccessControl.FileSystemRights]
  $wanted = if ($IsParent) { $rights::ReadAndExecute } else { $rights::Modify }
  if (($member.FileSystemRights -band $wanted) -ne $wanted) {
    throw 'MEMBER_RIGHTS_MISSING'
  }
  if (($member.FileSystemRights -band $rights::ChangePermissions) -ne 0 -or
      ($member.FileSystemRights -band $rights::TakeOwnership) -ne 0) {
    throw 'EXCESSIVE_MEMBER_RIGHTS'
  }
  if ($IsParent -and ($member.FileSystemRights -band $rights::Write) -ne 0) {
    throw 'PARENT_WRITE_GRANT'
  }
}

try {
  if ($env:COMPUTERNAME -cne $expectedHost -or
      $env:ProgramData -ine 'C:\ProgramData') { throw 'WRONG_HOST' }
  $user = Get-LocalUser -Name $accountName -ErrorAction Stop
  if ($user.Enabled -or -not $user.SID) { throw 'USER_NOT_DISABLED' }
  $admins = @(Get-LocalGroupMember -SID $adminSid -ErrorAction Stop)
  if (@($admins | Where-Object { $_.SID.Value -eq $user.SID.Value }).Count -ne 0) {
    throw 'USER_IS_ADMIN'
  }
  Assert-DirectoryAcl -Path $parent -MemberSid $user.SID.Value -IsParent $true
  Assert-DirectoryAcl -Path $child -MemberSid $user.SID.Value -IsParent $false
  $items = @([IO.Directory]::GetFileSystemEntries($parent))
  if ($items.Count -ne 1 -or $items[0] -cne $child) { throw 'UNEXPECTED_PARENT_CONTENTS' }
  if (@([IO.Directory]::GetFileSystemEntries($child)).Count -ne 0) {
    throw 'CHILD_NOT_EMPTY'
  }
  Write-Output 'GATEB_HOST_READONLY_INSPECTION_PASS'
  exit 0
} catch {
  # Keep Windows error details, SID, ACL contents, and credentials out of logs.
  Write-Output 'GATEB_HOST_READONLY_INSPECTION_INCOMPLETE_NO_GO'
  exit 3
}
