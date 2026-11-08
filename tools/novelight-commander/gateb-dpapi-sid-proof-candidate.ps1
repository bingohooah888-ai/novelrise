# Gate B CURRENTUSER DPAPI cross-SID probe CANDIDATE; not deployed or authorized.
# Only synthetic random bytes. Real execution needs separate owner one-shot approval,
# trusted guarded target-SID launcher and an administrator-owned protected permit.
# Default Inspect is read-only and refuses live operations.
[CmdletBinding()]
param(
  [ValidateSet('Inspect','TargetCreate','TargetVerify','AdminCrossSid')]
  [string]$Mode = 'Inspect',
  [string]$OwnerApproval = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$HostPin = 'DESKTOP-8Q4GFC8'
$TargetName = 'NOVELIGHT-GateB'
$TaskName = 'NOVELIGHT-GateB-Independent-Recovery'
$Root = 'C:\ProgramData\NOVELIGHT\GateB-Watchdog'
$Vault = 'C:\ProgramData\NOVELIGHT\GateB'
$InstalledScript = Join-Path $Root 'gateb-dpapi-sid-proof.ps1'
$PermitPath = Join-Path $Root 'gateb-dpapi-sid-proof-arm.json'
$StatePath = Join-Path $Root 'state.json'
$BlobPath = Join-Path $Vault 'gateb-synthetic-currentuser-proof.blob'
$DigestPath = Join-Path $Vault 'gateb-synthetic-currentuser-proof.sha256'
$Approval = 'ONE_GATEB_DPAPI_SYNTHETIC_SID_PROOF'
$AdminSid = 'S-1-5-32-544'
$SystemSid = 'S-1-5-18'
$Stage = 'DENIED'
$Passed = $false
$ResultMarker = ''

function Assert-Leaf([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.PSIsContainer -or
    ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'UNSAFE_FILE'
  }
}
function Assert-ProtectedRoot([string]$Sid) {
  $item = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or
    ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'UNTRUSTED_ROOT'
  }
  $acl = [IO.Directory]::GetAccessControl($Root)
  if (-not $acl.AreAccessRulesProtected -or
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid) {
    throw 'UNTRUSTED_ROOT_ACL'
  }
  $rules = @($acl.GetAccessRules($true, $true,
    [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 3) { throw 'UNTRUSTED_ROOT_RULES' }
  foreach ($id in @($AdminSid, $SystemSid, $Sid)) {
    $matching = @($rules | Where-Object {
      $_.IdentityReference.Value -ceq $id -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if ($matching.Count -ne 1) { throw 'UNTRUSTED_ROOT_IDENTITY' }
    $rights = $matching[0].FileSystemRights
    $flags = [Security.AccessControl.FileSystemRights]
    if ($id -ceq $Sid) {
      if (($rights -band $flags::Write) -ne 0 -or
        ($rights -band $flags::Delete) -ne 0 -or
        ($rights -band $flags::ChangePermissions) -ne 0 -or
        ($rights -band $flags::TakeOwnership) -ne 0) {
        throw 'TARGET_CAN_CHANGE_PERMIT'
      }
    } elseif (($rights -band $flags::FullControl) -ne $flags::FullControl) {
      throw 'ADMIN_SYSTEM_ACL_DRIFT'
    }
  }
}
function Assert-Vault([string]$Sid) {
  $item = Get-Item -LiteralPath $Vault -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or
    ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'UNTRUSTED_VAULT'
  }
  $acl = [IO.Directory]::GetAccessControl($Vault)
  if (-not $acl.AreAccessRulesProtected -or
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $AdminSid) {
    throw 'UNTRUSTED_VAULT_ACL'
  }
  $rules = @($acl.GetAccessRules($true, $true,
    [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 3) { throw 'UNTRUSTED_VAULT_RULES' }
  foreach ($id in @($AdminSid, $SystemSid, $Sid)) {
    $matched = @($rules | Where-Object {
      $_.IdentityReference.Value -ceq $id -and
      $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited
    })
    if ($matched.Count -ne 1) { throw 'UNTRUSTED_VAULT_IDENTITY' }
    $rights = $matched[0].FileSystemRights
    $flags = [Security.AccessControl.FileSystemRights]
    if ($id -ceq $Sid) {
      if (($rights -band $flags::Modify) -ne $flags::Modify -or
        ($rights -band $flags::ChangePermissions) -ne 0 -or
        ($rights -band $flags::TakeOwnership) -ne 0) {
        throw 'UNTRUSTED_TARGET_VAULT_RIGHTS'
      }
    } elseif (($rights -band $flags::FullControl) -ne $flags::FullControl) {
      throw 'UNTRUSTED_ADMIN_SYSTEM_VAULT_RIGHTS'
    }
  }
}
function Assert-Arm([string]$Sid) {
  # The trusted launcher must install a SHA-pinned copy and the permit as Admin
  # in a protected path, under a FRESH owner approval. This code never arms it.
  if ([IO.Path]::GetFullPath($PSCommandPath) -cne $InstalledScript) {
    throw 'NOT_PROTECTED_INSTALL'
  }
  Assert-ProtectedRoot $Sid
  Assert-Leaf $InstalledScript
  Assert-Leaf $PermitPath
  $permit = ConvertFrom-Json -InputObject (
    [IO.File]::ReadAllText($PermitPath)
  ) -ErrorAction Stop
  $keys = @($permit.PSObject.Properties.Name)
  $wanted = @('version','host','account','sid','scriptSha256','deadlineUtc','approvalId')
  if ($keys.Count -ne $wanted.Count -or
    @($keys | Where-Object { $_ -notin $wanted }).Count -ne 0 -or
    $permit.version -ne 1 -or $permit.host -cne $HostPin -or
    $permit.account -cne $TargetName -or $permit.sid -cne $Sid -or
    $permit.approvalId -cne $Approval -or
    [string]$permit.deadlineUtc -notmatch 'Z$') {
    throw 'PERMIT_NOT_PINNED'
  }
  $now = [datetime]::UtcNow
  $deadline = [datetime]::Parse([string]$permit.deadlineUtc).ToUniversalTime()
  if ($deadline -le $now -or $deadline -gt $now.AddMinutes(20)) {
    throw 'PERMIT_EXPIRED_OR_TOO_LONG'
  }
  $actualHash = (Get-FileHash -LiteralPath $InstalledScript -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -cne [string]$permit.scriptSha256) {
    throw 'PERMIT_SCRIPT_HASH_MISMATCH'
  }
}
function Assert-Guarded([string]$Sid) {
  $s = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($StatePath)) -ErrorAction Stop
  $now = [datetime]::UtcNow
  if ($s.version -ne 1 -or $s.host -cne $HostPin -or
    $s.sid -cne $Sid -or $s.taskName -cne $TaskName -or
    $s.phase -cne 'GUARDED_TEST') { throw 'NOT_GUARDED' }
  $deadline = [datetime]::Parse([string]$s.deadlineUtc).ToUniversalTime()
  if ($deadline -le $now -or $deadline -gt $now.AddMinutes(20)) {
    throw 'WATCHDOG_DEADLINE_UNSAFE'
  }
  $parent = Get-Process -Id ([int]$s.parentPid) -ErrorAction Stop
  if ($parent.StartTime.ToUniversalTime().ToString('o') -cne
    [string]$s.parentStartUtc) { throw 'PARENT_MISMATCH' }
}
if ($Mode -eq 'Inspect') {
  Write-Output 'GATEB_DPAPI_SID_LIVE_PROBE_NOT_ARMED'
  exit 2
}
if ($OwnerApproval -cne $Approval) {
  Write-Output 'GATEB_DPAPI_SID_PROBE_APPROVAL_REQUIRED'
  exit 4
}
$bytes = $null
$plain = $null
$hash = $null
try {
  $Stage = 'IDENTITY'
  if ($env:COMPUTERNAME -cne $HostPin) { throw 'WRONG_HOST' }
  $target = Get-LocalUser -Name $TargetName -ErrorAction Stop
  if (-not $target.SID) { throw 'NO_TARGET_SID' }
  $sid = $target.SID.Value
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
  $admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($Mode -in @('TargetCreate','TargetVerify')) {
    if ($current -cne $sid -or $admin -or -not $target.Enabled) {
      throw 'TARGET_IDENTITY_REQUIRED'
    }
  } elseif ($current -ceq $sid -or -not $admin -or $target.Enabled) {
    throw 'DIFFERENT_ADMIN_SID_AND_DISABLED_TARGET_REQUIRED'
  }
  $Stage = 'PROTECTED_APPROVAL'
  Assert-Arm $sid
  Assert-Vault $sid
  if ($Mode -in @('TargetCreate','TargetVerify')) { Assert-Guarded $sid }
  $Stage = 'DPAPI'
  if ($Mode -eq 'TargetCreate') {
    if (@([IO.Directory]::GetFileSystemEntries($Vault)).Count -ne 0) {
      throw 'VAULT_NOT_EMPTY'
    }
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $hash = [Security.Cryptography.SHA256]::Create()
    $digest = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    $cipher = [Security.Cryptography.ProtectedData]::Protect(
      $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
      $cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    if ($plain.Length -ne $bytes.Length) { throw 'ROUNDTRIP_LENGTH_MISMATCH' }
    $difference = 0
    for ($i = 0; $i -lt $bytes.Length; $i++) {
      $difference = $difference -bor ($bytes[$i] -bxor $plain[$i])
    }
    if ($difference -ne 0) { throw 'ROUNDTRIP_MISMATCH' }
    $stream = [IO.File]::Open($BlobPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($cipher,0,$cipher.Length);$stream.Flush($true) } finally {$stream.Dispose()}
    $stream = [IO.File]::Open($DigestPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
      $data = [Text.Encoding]::ASCII.GetBytes($digest)
      $stream.Write($data,0,$data.Length);$stream.Flush($true)
    } finally {$stream.Dispose()}
    $ResultMarker = 'GATEB_DPAPI_TARGET_CURRENTUSER_CREATE_PASS'
  } elseif ($Mode -eq 'TargetVerify') {
    Assert-Leaf $BlobPath
    Assert-Leaf $DigestPath
    $blob = [IO.File]::ReadAllBytes($BlobPath)
    $digest = [IO.File]::ReadAllText($DigestPath)
    if ($digest -notmatch '^[0-9a-f]{64}$') { throw 'DIGEST_INVALID' }
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
      $blob,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $hash = [Security.Cryptography.SHA256]::Create()
    $actual = [BitConverter]::ToString($hash.ComputeHash($plain)).Replace('-','').ToLowerInvariant()
    if ($actual -cne $digest) { throw 'TARGET_SEPARATE_PROCESS_UNPROTECT_MISMATCH' }
    $ResultMarker = 'GATEB_DPAPI_TARGET_SECOND_PROCESS_PASS'
  } else {
    Assert-Leaf $BlobPath
    $blob = [IO.File]::ReadAllBytes($BlobPath)
    $rejected = $false
    try {
      $plain = [Security.Cryptography.ProtectedData]::Unprotect(
        $blob,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser
      )
    } catch [Security.Cryptography.CryptographicException] {
      $rejected = $true
    }
    if (-not $rejected) { throw 'DIFFERENT_SID_UNPROTECT_NOT_REJECTED' }
    $ResultMarker = 'GATEB_DPAPI_DIFFERENT_SID_DENIED_PASS'
  }
  $Passed = $true
} catch {
  $Passed = $false
} finally {
  if ($null -ne $plain) { [array]::Clear($plain,0,$plain.Length) }
  if ($null -ne $bytes) { [array]::Clear($bytes,0,$bytes.Length) }
  if ($null -ne $hash) { $hash.Dispose() }
  # Do not delete proof or user profile here. Requires separately scoped cleanup.
}
# A protected launcher cannot redirect target stdout into the read-only
# Watchdog directory. The target instead writes a fixed, NON-SECRET completion
# receipt into its modify-ACL Vault, only after the actual DPAPI checks pass.
# Receipt alone is not authoritative: the launcher also validates exit code,
# installed script SHA, target SID, permit and independent watchdog proof.
if ($Passed -and $Mode -in @('TargetCreate','TargetVerify')) {
  $receipt = if ($Mode -ceq 'TargetCreate') {
    Join-Path $Vault 'gateb-dpapi-target-create.receipt'
  } else {
    Join-Path $Vault 'gateb-dpapi-target-verify.receipt'
  }
  $stream = $null
  try {
    $stream = [IO.File]::Open($receipt,[IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,[IO.FileShare]::None)
    $fixed = [Text.Encoding]::ASCII.GetBytes($ResultMarker)
    $stream.Write($fixed,0,$fixed.Length)
    $stream.Flush($true)
  } catch {
    $Passed = $false
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }
}
if ($Passed) {
  Write-Output $ResultMarker
  exit 0
}
# Never display errors, tokens, SIDs, entropy, ciphertext, DPAPI keys or paths.
Write-Output ('GATEB_DPAPI_SID_PROBE_NO_GO_' + $Stage)
exit 3
