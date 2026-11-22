# Gate B independent recovery candidate. No external network, PAT, secret or AI.
# SYSTEM scheduled-task entrypoint only, installed under a protected local ACL.
[CmdletBinding()]
param(
  [ValidateSet('Inspect', 'Recover')]
  [string]$Mode = 'Inspect'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = 'C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$TargetAccountName = 'NOVELIGHT-GateB'
$ExpectedHost = 'DESKTOP-8Q4GFC8'
$AdminSid = 'S-1-5-32-544'
$SystemSid = 'S-1-5-18'

if ($Mode -ne 'Recover') {
  Write-Output 'GATEB_WATCHDOG_OFFLINE_INSPECT_ONLY'
  exit 2
}

$account = $null
$trusted = $false
$status = 'WATCHDOG_NO_PROOF'
try {
  if ($env:COMPUTERNAME -cne $ExpectedHost) { throw 'WRONG_HOST' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if ($identity.User.Value -cne $SystemSid) { throw 'SYSTEM_ONLY' }
  $dir = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if (-not $dir.PSIsContainer -or
      ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'UNTRUSTED_PATH'
  }
  $acl = [IO.Directory]::GetAccessControl($Root)
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid) {
    throw 'UNTRUSTED_ACL'
  }
  $account = Get-LocalUser -Name $TargetAccountName -ErrorAction Stop
  if (-not $account.SID) { throw 'MISSING_SID' }
  $expected = @($AdminSid, $SystemSid, $account.SID.Value)
  $rules = @($acl.GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]
  ))
  if ($rules.Count -ne 3) { throw 'RULE_COUNT' }
  foreach ($sid in $expected) {
    $match = @($rules | Where-Object {
      $_.IdentityReference.Value -ceq $sid -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if ($match.Count -ne 1) { throw 'ACL_IDENTITY' }
    $rule = $match[0]
    if ($sid -eq $account.SID.Value) {
      if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0 -or
          ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Delete) -ne 0 -or
          ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ChangePermissions) -ne 0 -or
          ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::TakeOwnership) -ne 0) {
        throw 'MEMBER_MUST_BE_READONLY'
      }
    } elseif (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
               [Security.AccessControl.FileSystemRights]::FullControl) {
      throw 'ADMIN_SYSTEM_RIGHTS'
    }
  }
  $sidFile = Join-Path $Root 'target-sid.txt'
  if (-not (Test-Path -LiteralPath $sidFile -PathType Leaf)) { throw 'SID_FILE_MISSING' }
  $sid = [IO.File]::ReadAllText($sidFile).Trim()
  if ($sid -cne $account.SID.Value) { throw 'TARGET_SID_CHANGED' }
  $trusted = $true

  # A missing or invalid state means immediate account disable, never fail-open.
  $state = $null
  try {
    $statePath = Join-Path $Root 'state.json'
    $state = ConvertFrom-Json -InputObject (
      [IO.File]::ReadAllText($statePath)
    ) -ErrorAction Stop
    if ($state.version -ne 1 -or
        $state.host -cne $ExpectedHost -or
        $state.sid -cne $sid -or
        $state.taskName -cne 'NOVELIGHT-GateB-Independent-Recovery' -or
        $state.phase -notin @('GUARD_ONLY', 'GUARDED_TEST') -or
        $state.deadlineUtc -notmatch 'Z$') {
      $state = $null
    }
  } catch {
    $state = $null
  }

  $mustDisable = $false
  if ($null -eq $state) {
    $mustDisable = $true
    $status = 'WATCHDOG_INVALID_STATE'
  } elseif ($state.phase -eq 'GUARD_ONLY') {
    $mustDisable = $true
    $status = 'WATCHDOG_GUARD_ONLY'
  } else {
    $deadline = [DateTime]::Parse(
      [string]$state.deadlineUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AdjustToUniversal
    )
    if ($deadline -lt [DateTime]::UtcNow -or
        $deadline -gt [DateTime]::UtcNow.AddMinutes(20)) {
      $mustDisable = $true
      $status = 'WATCHDOG_DEADLINE'
    }
    $parent = $null
    try {
      $parent = Get-Process -Id ([int]$state.parentPid) -ErrorAction Stop
      $startUtc = $parent.StartTime.ToUniversalTime().ToString('o')
      if ($startUtc -cne [string]$state.parentStartUtc) { $parent = $null }
    } catch {
      $parent = $null
    }
    if ($null -eq $parent) {
      $mustDisable = $true
      $status = 'WATCHDOG_PARENT_GONE'
    }
    if (-not $mustDisable) { $status = 'WATCHDOG_PARENT_ALIVE' }
  }

  if ($mustDisable -and $account.Enabled) {
    Disable-LocalUser -SID $account.SID -ErrorAction Stop
    $account = Get-LocalUser -Name $TargetAccountName -ErrorAction Stop
  }
  if ($mustDisable -and $account.Enabled) { throw 'DISABLE_UNCONFIRMED' }
  if (-not $account.Enabled) { $status = 'WATCHDOG_DISABLED_CONFIRMED' }
} catch {
  # If the sealed SID was trusted, make a final conservative disable attempt.
  if ($trusted -and $null -ne $account -and $account.Enabled) {
    try {
      Disable-LocalUser -SID $account.SID -ErrorAction Stop
      $account = Get-LocalUser -Name $TargetAccountName -ErrorAction Stop
    } catch {
      $status = 'WATCHDOG_RECOVERY_UNCONFIRMED'
    }
  }
  if ($trusted -and $null -ne $account -and -not $account.Enabled) {
    $status = 'WATCHDOG_DISABLED_CONFIRMED'
  } else {
    $status = 'WATCHDOG_RECOVERY_UNCONFIRMED'
  }
}

# Never return a SID, command line, exception, password or account contents.
# Heartbeat is only meaningful if the ACL and the SYSTEM principal are verified.
if ($trusted) {
  try {
    $sequence = 1
    $previous = Join-Path $Root 'heartbeat.json'
    if ([IO.File]::Exists($previous)) {
      try {
        $last = ConvertFrom-Json ([IO.File]::ReadAllText($previous))
        $number = [int]$last.sequence
        if ($last.version -eq 1 -and $number -ge 1 -and $number -lt 100000) {
          $sequence = $number + 1
        }
      } catch {
        $sequence = 1
      }
    }
    $heartbeat = [ordered]@{
      version = 1
      sequence = $sequence
      status = $status
      checkedUtc = [DateTime]::UtcNow.ToString('o')
      observedDisabled = [bool]($null -ne $account -and -not $account.Enabled)
    } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText(
      (Join-Path $Root 'heartbeat.json'), $heartbeat,
      (New-Object Text.UTF8Encoding($false))
    )
  } catch {
    $status = 'WATCHDOG_HEARTBEAT_UNCONFIRMED'
  }
}
if ($status -eq 'WATCHDOG_DISABLED_CONFIRMED' -or
    $status -eq 'WATCHDOG_PARENT_ALIVE') {
  Write-Output 'GATEB_WATCHDOG_SYSTEM_OBSERVATION_RECORDED'
  exit 0
}
Write-Output 'GATEB_WATCHDOG_RECOVERY_NOT_CONFIRMED'
exit 3
