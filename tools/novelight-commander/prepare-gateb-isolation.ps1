# NOVELIGHT Gate B — exact-scope Windows host isolation setup.
# PREPARATION ONLY until a NEW, separately scoped OWNER approval.
# NEVER call Apply during offline tests. No existing NLO paths are touched.
[CmdletBinding()]
param(
  [ValidateSet('Preflight', 'Apply')]
  [string]$Mode = 'Preflight',
  [string]$OwnerApproval = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TargetHost = 'DESKTOP-8Q4GFC8'
$Account = 'NOVELIGHT-GateB'
$Parent = 'C:\ProgramData\NOVELIGHT'
$Vault = 'C:\ProgramData\NOVELIGHT\GateB'
$ExpectedApproval = 'CREATE_ONE_DISABLED_GATEB_USER_AND_TWO_DIRECTORIES'
$AdminSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$SystemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')

function Test-SafePath {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)
}
function New-GateBDirectoryAcl {
  param(
    [Security.Principal.SecurityIdentifier]$Member,
    [bool]$ForParent
  )
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($AdminSid)
  foreach ($sid in @($AdminSid, $SystemSid)) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'
    )
    $acl.AddAccessRule($rule)
  }
  $priv = if ($ForParent) { 'ReadAndExecute' } else { 'Modify' }
  $inherit = if ($ForParent) { 'None' } else { 'ContainerInherit, ObjectInherit' }
  $memberRule = [Security.AccessControl.FileSystemAccessRule]::new(
    $Member, $priv, $inherit, 'None', 'Allow'
  )
  $acl.AddAccessRule($memberRule)
  return $acl
}
function Assert-GateBDirectoryAcl {
  param(
    [string]$Path,
    [Security.Principal.SecurityIdentifier]$Member
  )
  if (-not (Test-SafePath $Path)) { throw 'PATH_UNSAFE' }
  $acl = [IO.Directory]::GetAccessControl($Path)
  if (-not $acl.AreAccessRulesProtected) { throw 'ACL_INHERITANCE' }
  if ($acl.Owner -ne $AdminSid.Value -and
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $AdminSid.Value) {
    throw 'ACL_OWNER_UNEXPECTED'
  }
  $rules = @($acl.GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]
  ))
  $allowed = @($AdminSid.Value, $SystemSid.Value, $Member.Value)
  if ($rules.Count -ne 3) { throw 'ACL_RULE_COUNT' }
  foreach ($rule in $rules) {
    if ($rule.IsInherited -or
        $rule.AccessControlType -ne 'Allow' -or
        $rule.IdentityReference.Value -notin $allowed) {
      throw 'ACL_UNEXPECTED_GRANT'
    }
  }
  foreach ($sid in $allowed) {
    if (@($rules | Where-Object { $_.IdentityReference.Value -eq $sid }).Count -ne 1) {
      throw 'ACL_MISSING_REQUIRED_IDENTITY'
    }
  }
}
function New-EphemeralGateBPassword {
  # Random bytes are generated locally; neither plaintext nor ciphertext
  # is written, printed, sent to child processes, or returned to the caller.
  # No recovery password is escrowed. Account starts DISABLED.
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = [byte[]]::new(48)
  $secret = [Security.SecureString]::new()
  try {
    $rng.GetBytes($bytes)
    foreach ($value in $bytes) {
      $secret.AppendChar($alphabet[[int]($value -band 63)])
    }
    foreach ($c in @('a', 'A', '7', '!')) { $secret.AppendChar([char]$c) }
    $secret.MakeReadOnly()
    return $secret
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $rng.Dispose()
  }
}

# Strict read-only preflight. Callers may parse this script but must not
# run Apply until the OWNER separately approves elevated local mutations.
$ok = $true
if ($env:COMPUTERNAME -cne $TargetHost) { $ok = $false }
if ($env:ProgramData -ine 'C:\ProgramData') { $ok = $false }
if (-not (Test-SafePath 'C:\ProgramData')) { $ok = $false }
if ((Test-Path -LiteralPath $Parent) -or (Test-Path -LiteralPath $Vault)) { $ok = $false }
if ($null -ne (Get-LocalUser -Name $Account -ErrorAction SilentlyContinue)) { $ok = $false }
if (-not (Get-Command New-LocalUser -ErrorAction SilentlyContinue) -or
    -not (Get-Command Remove-LocalUser -ErrorAction SilentlyContinue)) { $ok = $false }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) { $ok = $false }
if ($Mode -eq 'Preflight') {
  if ($ok) { Write-Output 'GATEB_PREFLIGHT_READY_NO_MUTATION'; exit 0 }
  Write-Output 'GATEB_PREFLIGHT_DENIED_NO_MUTATION'
  exit 2
}
if (-not $ok -or $OwnerApproval -cne $ExpectedApproval) {
  Write-Output 'GATEB_APPLY_DENIED_NO_MUTATION'
  exit 2
}

$createdUser = $false
$createdParent = $false
$createdVault = $false
$createdSid = $null
$secret = $null
$success = $false
$rollbackIncomplete = $false

try {
  # One disabled non-admin user. The password cannot be recovered from
  # console, disk or logs; a later separately approved admin reset is needed
  # before any runner can use this account.
  $secret = New-EphemeralGateBPassword
  $newUser = New-LocalUser -Name $Account -Password $secret -Disabled `
    -AccountNeverExpires -Description 'NOVELIGHT Gate B isolated (disabled pending new OWNER approval)' `
    -ErrorAction Stop
  $createdUser = $true
  $createdSid = $newUser.SID
  if (-not $createdSid) { throw 'ACCOUNT_SID_MISSING' }
  if ($newUser.Enabled -ne $false) { throw 'ACCOUNT_NOT_DISABLED' }

  $admins = @(Get-LocalGroupMember -SID $AdminSid.Value -ErrorAction Stop)
  if (@($admins | Where-Object { $_.SID.Value -eq $createdSid.Value }).Count -gt 0) {
    throw 'ACCOUNT_IS_ADMIN'
  }

  # Create with restricted ACL at creation time: no broad inherited Users
  # grant, including the short interval before post-creation verification.
  $parentAcl = New-GateBDirectoryAcl -Member $createdSid -ForParent $true
  [IO.Directory]::CreateDirectory($Parent, $parentAcl) | Out-Null
  $createdParent = $true
  $vaultAcl = New-GateBDirectoryAcl -Member $createdSid -ForParent $false
  [IO.Directory]::CreateDirectory($Vault, $vaultAcl) | Out-Null
  $createdVault = $true

  Assert-GateBDirectoryAcl -Path $Parent -Member $createdSid
  Assert-GateBDirectoryAcl -Path $Vault -Member $createdSid
  if ([IO.Directory]::GetFileSystemEntries($Vault).Length -ne 0) {
    throw 'VAULT_NOT_EMPTY'
  }
  if ([IO.Directory]::GetFileSystemEntries($Parent).Length -ne 1) {
    throw 'PARENT_UNEXPECTED_CONTENT'
  }
  $newUser = Get-LocalUser -Name $Account -ErrorAction Stop
  if ($newUser.SID.Value -ne $createdSid.Value -or $newUser.Enabled) {
    throw 'ACCOUNT_CHANGED'
  }
  $success = $true
} catch {
  # Never leak exceptions: OS errors can contain sensitive local data.
  $success = $false
} finally {
  if ($null -ne $secret) { $secret.Dispose(); $secret = $null }
  if (-not $success) {
    # Conservative rollback: delete only paths created by this invocation,
    # only if empty. Never recurse, touch existing NLO or delete unrelated
    # files/users. Ambiguous state becomes manual reconciliation.
    if ($createdVault) {
      try { [IO.Directory]::Delete($Vault, $false) }
      catch { $rollbackIncomplete = $true }
    }
    if ($createdParent) {
      try { [IO.Directory]::Delete($Parent, $false) }
      catch { $rollbackIncomplete = $true }
    }
    if ($createdUser -and $createdSid) {
      try {
        $existing = Get-LocalUser -Name $Account -ErrorAction Stop
        if ($existing.SID.Value -cne $createdSid.Value) {
          throw 'ACCOUNT_IDENTITY_CHANGED'
        }
        Remove-LocalUser -SID $createdSid -ErrorAction Stop
      } catch { $rollbackIncomplete = $true }
    }
    # No optimistic rollback claim: an uncertain create can leave objects
    # even if the API failed before setting the created-* flags.
    try {
      if ((Get-LocalUser -Name $Account -ErrorAction SilentlyContinue) -or
          (Test-Path -LiteralPath $Parent) -or
          (Test-Path -LiteralPath $Vault)) {
        $rollbackIncomplete = $true
      }
    } catch { $rollbackIncomplete = $true }
  }
}
if ($success) {
  Write-Output 'GATEB_DISABLED_ACCOUNT_AND_EMPTY_VAULT_CREATED_VERIFIED'
  exit 0
}
if ($rollbackIncomplete) {
  Write-Output 'GATEB_PARTIAL_STATE_MANUAL_RECONCILIATION_REQUIRED'
  exit 4
}
Write-Output 'GATEB_CREATION_FAILED_ROLLBACK_CONFIRMED'
exit 3
