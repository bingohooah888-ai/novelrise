# Gate B 02-07-05: fixed-host read-only admission for a future one-shot test.
# No Apply is implemented. A separately attested crash-resistant watchdog
# and a new owner approval pinned to the actual future executable are required.
[CmdletBinding()]
param(
  [ValidateSet('Preflight', 'Apply')]
  [string]$Mode = 'Preflight'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Mode -eq 'Apply') {
  Write-Output 'GATEB_APPLY_BLOCKED_INDEPENDENT_RECOVERY_NOT_ATTESTED'
  exit 4
}
try {
  if ($PSVersionTable.PSEdition -ne 'Desktop' -or
      $env:COMPUTERNAME -cne 'DESKTOP-8Q4GFC8' -or
      $env:ProgramData -ine 'C:\ProgramData') {
    throw 'WRONG_HOST'
  }
  $me = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
  )
  if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'ADMIN_REQUIRED'
  }
  $account = Get-LocalUser -Name 'NOVELIGHT-GateB' -ErrorAction Stop
  if ($account.Enabled -or -not $account.SID) {
    throw 'ACCOUNT_NOT_DISABLED'
  }
  $admins = @(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop)
  if (@($admins | Where-Object {
      $_.SID.Value -eq $account.SID.Value
    }).Count -ne 0) {
    throw 'ACCOUNT_IS_ADMIN'
  }

  $parent = 'C:\ProgramData\NOVELIGHT'
  $child = 'C:\ProgramData\NOVELIGHT\GateB'
  foreach ($item in @(
    @{ Path = $parent; Parent = $true },
    @{ Path = $child; Parent = $false }
  )) {
    $dir = Get-Item -LiteralPath $item.Path -Force -ErrorAction Stop
    if (-not $dir.PSIsContainer -or
        ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'UNSAFE_DIRECTORY'
    }
    $acl = [IO.Directory]::GetAccessControl($item.Path)
    if (-not $acl.AreAccessRulesProtected) { throw 'ACL_INHERITANCE' }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne
        'S-1-5-32-544') { throw 'ACL_OWNER' }
    $rules = @($acl.GetAccessRules(
      $true, $true, [Security.Principal.SecurityIdentifier]
    ))
    if ($rules.Count -ne 3) { throw 'ACL_RULE_COUNT' }
    foreach ($sid in @('S-1-5-32-544', 'S-1-5-18', $account.SID.Value)) {
      $matches = @($rules | Where-Object {
        $_.IdentityReference.Value -eq $sid -and
        $_.AccessControlType -eq 'Allow' -and
        -not $_.IsInherited
      })
      if ($matches.Count -ne 1) { throw 'ACL_UNEXPECTED_MEMBER' }
    }
    $member = @($rules | Where-Object {
      $_.IdentityReference.Value -eq $account.SID.Value
    })[0]
    $rights = [Security.AccessControl.FileSystemRights]
    $required = if ($item.Parent) { $rights::ReadAndExecute } else {
      $rights::Modify
    }
    if (($member.FileSystemRights -band $required) -ne $required -or
        ($member.FileSystemRights -band $rights::ChangePermissions) -ne 0 -or
        ($member.FileSystemRights -band $rights::TakeOwnership) -ne 0 -or
        ($item.Parent -and
         ($member.FileSystemRights -band $rights::Write) -ne 0)) {
      throw 'USER_ACL_EXCESSIVE_OR_INSUFFICIENT'
    }
  }
  $entries = @([IO.Directory]::GetFileSystemEntries($parent))
  if ($entries.Count -ne 1 -or $entries[0] -cne $child -or
      @([IO.Directory]::GetFileSystemEntries($child)).Count -ne 0) {
    throw 'EXISTING_DATA_PRESENT'
  }
  $profile = @(Get-CimInstance Win32_UserProfile -Filter (
    "SID='" + $account.SID.Value + "'"
  ) -ErrorAction Stop)
  if ($profile.Count -ne 0) { throw 'UNEXPECTED_EXISTING_PROFILE' }
  $seclogon = Get-Service -Name 'seclogon' -ErrorAction Stop
  if ($seclogon.Status -ne 'Running') { throw 'SECONDARY_LOGON_NOT_RUNNING' }
  foreach ($name in @(
    'Set-LocalUser', 'Enable-LocalUser', 'Disable-LocalUser',
    'Get-LocalUser', 'Get-LocalGroupMember', 'Start-Process'
  )) {
    if (-not (Get-Command -Name $name -ErrorAction SilentlyContinue)) {
      throw 'REQUIRED_COMMAND_UNAVAILABLE'
    }
  }
  $start = Get-Command -Name 'Start-Process' -ErrorAction Stop
  foreach ($name in @('Credential', 'LoadUserProfile', 'PassThru')) {
    if (-not $start.Parameters.ContainsKey($name)) {
      throw 'SECONDARY_LOGON_PARAMETER_UNAVAILABLE'
    }
  }
  # This is not a live authorization. No recovery watchdog was created.
  Write-Output 'GATEB_AUTH_PREFLIGHT_READY_WATCHDOG_REQUIRED'
  exit 0
} catch {
  # Do not expose error details, local usernames, ACL text or secrets.
  Write-Output 'GATEB_AUTH_PREFLIGHT_DENIED_NO_MUTATION'
  exit 3
}
