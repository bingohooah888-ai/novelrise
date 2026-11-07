# NOVELIGHT Gate B: OFFLINE/SYNTHETIC DPAPI storage and handoff probe.
# No token input, clipboard, browser, GitHub, network or provider operations.
# Do not repurpose as a PAT issuer or live Gate B credential consumer.
param(
  [ValidateSet('Inspect', 'SelfTest')]
  [string]$Mode = 'Inspect'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Mode -ne 'SelfTest') {
  Write-Output 'GATEB_DPAPI_LIVE_DISABLED'
  exit 2
}
if ($PSVersionTable.PSEdition -ne 'Desktop' -or
    [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Write-Output 'GATEB_DPAPI_PLATFORM_DENIED'
  exit 2
}

$folder = $null
$handle = [IntPtr]::Zero
$phase = 'prepare'
$passed = $false
try {
  # The secret cannot be supplied by args, env, files, piped stdin or prompts.
  $marker = 'MOCK_NOVELIGHT_GATEB_DPAPI_ONLY_' + [Guid]::NewGuid().ToString('N')
  $folder = Join-Path ([IO.Path]::GetTempPath()) (
    'novelight-gateb-dpapi-synthetic-' + [Guid]::NewGuid().ToString('N')
  )
  [IO.Directory]::CreateDirectory($folder) | Out-Null

  $phase = 'acl'
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if (-not $sid) { throw 'SYNTHETIC_IDENTITY_UNAVAILABLE' }
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $phase = 'acl.rules'
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($sid)
  $ownRule = [Security.AccessControl.FileSystemAccessRule]::new(
    $sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'
  )
  $systemRule = [Security.AccessControl.FileSystemAccessRule]::new(
    $system, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'
  )
  $acl.AddAccessRule($ownRule)
  $acl.AddAccessRule($systemRule)
  $phase = 'acl.apply'
  [IO.Directory]::SetAccessControl($folder, $acl)
  $phase = 'acl.verify'
  $actual = [IO.Directory]::GetAccessControl($folder)
  if (-not $actual.AreAccessRulesProtected) {
    throw 'SYNTHETIC_ACL_NOT_PROTECTED'
  }
  $rules = $actual.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])
  foreach ($rule in $rules) {
    if ($rule.AccessControlType -eq 'Allow' -and
        $rule.IdentityReference.Value -ne $sid.Value -and
        $rule.IdentityReference.Value -ne $system.Value) {
      throw 'SYNTHETIC_ACL_BROAD_ACCESS'
    }
  }

  $phase = 'encrypt'
  $path = Join-Path $folder 'gateb-offline-only.dpapi'
  $secure = ConvertTo-SecureString $marker -AsPlainText -Force
  # Same Windows user-bound DPAPI serialization as existing NLO GitHub bridge.
  $ciphertext = ConvertFrom-SecureString -SecureString $secure
  [IO.File]::WriteAllText($path, $ciphertext, (New-Object Text.UTF8Encoding($false)))
  if (([IO.File]::ReadAllText($path)).Contains($marker)) {
    throw 'SYNTHETIC_PLAINTEXT_ON_DISK'
  }

  $phase = 'decrypt'
  # In-process synthetic handoff only. No secret is returned over stdout.
  $restored = ConvertTo-SecureString ([IO.File]::ReadAllText($path)) -ErrorAction Stop
  $handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($restored)
  $roundTrip = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)
  if ($roundTrip -cne $marker) { throw 'SYNTHETIC_ROUNDTRIP_MISMATCH' }
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
  $handle = [IntPtr]::Zero
  Remove-Variable roundTrip, restored, secure, marker -ErrorAction SilentlyContinue

  $phase = 'tamper'
  # Corrupt one hex digit in the *actual* DPAPI ciphertext; never log it.
  if ($ciphertext.Length -lt 30) { throw 'SYNTHETIC_BLOB_TOO_SHORT' }
  $index = $ciphertext.Length - 12
  $replacement = if ($ciphertext[$index] -eq '0') { '1' } else { '0' }
  $corrupt = $ciphertext.Substring(0, $index) + $replacement +
    $ciphertext.Substring($index + 1)
  $rejected = $false
  try { $null = ConvertTo-SecureString $corrupt -ErrorAction Stop }
  catch { $rejected = $true }
  if (-not $rejected) { throw 'SYNTHETIC_TAMPER_ACCEPTED' }

  # Do not report success until the isolated ciphertext has been erased.
  $passed = $true
}
catch {
  $passed = $false
}
finally {
  if ($handle -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
  }
  if ($folder -and (Test-Path -LiteralPath $folder)) {
    try { Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction Stop }
    catch { $passed = $false }
  }
  if ($folder -and (Test-Path -LiteralPath $folder)) { $passed = $false }
}
if ($passed) {
  Write-Output 'GATEB_DPAPI_SYNTHETIC_HANDOFF_PASS'
  exit 0
}
Write-Output 'GATEB_DPAPI_SYNTHETIC_DENIED'
exit 3
