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

# Pure decision function; offline tests execute only its AST, never Recover.
# Priority: unsafe state > deadline expiration > parent loss > healthy parent.
function Resolve-WatchdogRecoveryReason {
  param(
    [bool]$StateValid,
    [string]$Phase,
    [datetime]$DeadlineUtc,
    [datetime]$NowUtc,
    [bool]$ParentIdentityMatches
  )
  if (-not $StateValid) { return 'STATE_INVALID' }
  if ($Phase -ceq 'GUARD_ONLY') { return 'GUARD_ONLY' }
  if ($Phase -cne 'GUARDED_TEST') { return 'STATE_INVALID' }
  if ($DeadlineUtc -lt $NowUtc) { return 'DEADLINE_EXPIRED' }
  if ($DeadlineUtc -gt $NowUtc.AddMinutes(20)) { return 'STATE_INVALID' }
  if (-not $ParentIdentityMatches) { return 'PARENT_GONE' }
  return 'PARENT_ALIVE'
}

# Outcome never claims a recovery from the account being disabled already.
function Resolve-WatchdogDisableOutcome {
  param(
    [bool]$WasEnabledBefore,
    [bool]$DisableAttempted,
    [bool]$DisableCommandSucceeded,
    [bool]$ObservedDisabled,
    [string]$ReasonCode
  )
  if ($WasEnabledBefore -and $DisableAttempted -and
      $DisableCommandSucceeded -and $ObservedDisabled) {
    return 'DISABLED_BY_WATCHDOG'
  }
  if (-not $WasEnabledBefore -and -not $DisableAttempted -and
      $ObservedDisabled) {
    return 'ALREADY_DISABLED'
  }
  if ($WasEnabledBefore -and -not $DisableAttempted -and
      -not $ObservedDisabled -and $ReasonCode -ceq 'PARENT_ALIVE') {
    return 'NOT_REQUIRED_PARENT_ALIVE'
  }
  return 'DISABLE_UNCONFIRMED'
}

if ($Mode -ne 'Recover') {
  Write-Output 'GATEB_WATCHDOG_OFFLINE_INSPECT_ONLY'
  exit 2
}

$account = $null
$trusted = $false
$status = 'WATCHDOG_NO_PROOF'
$RecoveryReasonCode = 'UNVERIFIED_ERROR'
$DisableOutcomeCode = 'NOT_ATTEMPTED'
$WasEnabledAtTrust = $false
$DisableInvoked = $false
$DisableCommandSucceeded = $false
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
  $WasEnabledAtTrust = [bool]$account.Enabled
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

  # Use one fixed UTC time for deadline precedence, with no secret output.
  $nowUtc = [DateTime]::UtcNow
  $deadlineUtc = $nowUtc
  $stateValid = ($null -ne $state)
  $parentIdentityMatches = $false
  if ($stateValid -and $state.phase -ceq 'GUARDED_TEST') {
    try {
      $deadlineUtc = [DateTime]::Parse(
        [string]$state.deadlineUtc,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AdjustToUniversal
      )
    } catch {
      $stateValid = $false
    }
    if ($stateValid) {
      try {
        $parent = Get-Process -Id ([int]$state.parentPid) -ErrorAction Stop
        $startUtc = $parent.StartTime.ToUniversalTime().ToString('o')
        $parentIdentityMatches = ($startUtc -ceq [string]$state.parentStartUtc)
      } catch {
        $parentIdentityMatches = $false
      }
    }
  }
  $phase = if ($stateValid) { [string]$state.phase } else { '' }
  $RecoveryReasonCode = Resolve-WatchdogRecoveryReason -StateValid $stateValid `
    -Phase $phase -DeadlineUtc $deadlineUtc -NowUtc $nowUtc `
    -ParentIdentityMatches $parentIdentityMatches
  $mustDisable = ($RecoveryReasonCode -cne 'PARENT_ALIVE')
  switch ($RecoveryReasonCode) {
    'GUARD_ONLY' { $status = 'WATCHDOG_GUARD_ONLY' }
    'DEADLINE_EXPIRED' { $status = 'WATCHDOG_DEADLINE' }
    'PARENT_GONE' { $status = 'WATCHDOG_PARENT_GONE' }
    'PARENT_ALIVE' { $status = 'WATCHDOG_PARENT_ALIVE' }
    default { $status = 'WATCHDOG_INVALID_STATE' }
  }

  if ($mustDisable -and $account.Enabled) {
    # Exactly one attempt in this invocation; no broad user or process action.
    $DisableInvoked = $true
    Disable-LocalUser -SID $account.SID -ErrorAction Stop
    $DisableCommandSucceeded = $true
    $account = Get-LocalUser -Name $TargetAccountName -ErrorAction Stop
  }
  if ($mustDisable -and $account.Enabled) { throw 'DISABLE_UNCONFIRMED' }
  if (-not $account.Enabled) { $status = 'WATCHDOG_DISABLED_CONFIRMED' }
} catch {
  # Conservatively disable only the already-trusted SID, at most once.
  if ($trusted -and $null -ne $account -and $account.Enabled -and
      -not $DisableInvoked) {
    $DisableInvoked = $true
    try {
      Disable-LocalUser -SID $account.SID -ErrorAction Stop
      $DisableCommandSucceeded = $true
      $account = Get-LocalUser -Name $TargetAccountName -ErrorAction Stop
    } catch {
      # The final, separate evidence check will mark the failure.
    }
  }
  if ($trusted -and $null -ne $account -and -not $account.Enabled) {
    $status = 'WATCHDOG_DISABLED_CONFIRMED'
  } else {
    $status = 'WATCHDOG_RECOVERY_UNCONFIRMED'
  }
}

# Refresh the observed user once before writing any trusted heartbeat.
# Do not claim DISABLED_BY_WATCHDOG without a successful Disable-LocalUser call.
if ($trusted) {
  try {
    $refreshedAccount = Get-LocalUser -Name $TargetAccountName -ErrorAction Stop
    if ($refreshedAccount.SID.Value -cne $account.SID.Value) {
      throw 'TARGET_SID_CHANGED_DURING_RECOVERY'
    }
    $account = $refreshedAccount
    $DisableOutcomeCode = Resolve-WatchdogDisableOutcome `
      -WasEnabledBefore $WasEnabledAtTrust -DisableAttempted $DisableInvoked `
      -DisableCommandSucceeded $DisableCommandSucceeded `
      -ObservedDisabled (-not $account.Enabled) -ReasonCode $RecoveryReasonCode
    if ($DisableOutcomeCode -ceq 'DISABLE_UNCONFIRMED' -or
        ($status -ceq 'WATCHDOG_DISABLED_CONFIRMED' -and $account.Enabled)) {
      $status = 'WATCHDOG_RECOVERY_UNCONFIRMED'
    }
  } catch {
    $DisableOutcomeCode = 'DISABLE_UNCONFIRMED'
    $status = 'WATCHDOG_RECOVERY_UNCONFIRMED'
    $account = $null
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
      # Additive v1 evidence: do not change existing manager heartbeat contract.
      reasonCode = $RecoveryReasonCode
      disableOutcome = $DisableOutcomeCode
      accountWasEnabledBefore = $WasEnabledAtTrust
      disableAttempted = $DisableInvoked
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
