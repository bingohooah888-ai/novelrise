import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'tools',
    'novelight-commander',
    'gateb-dpapi-sid-proof-candidate.ps1'
  ),
  'utf8'
);

test('inspects by default and rejects unapproved live requests', () => {
  assert.match(src, /\[string\]\$Mode = 'Inspect'/u);
  assert.match(src, /if \(\$Mode -eq 'Inspect'\)/u);
  assert.match(src, /GATEB_DPAPI_SID_LIVE_PROBE_NOT_ARMED/u);
  assert.match(src, /\$OwnerApproval -cne \$Approval/u);
  assert.match(src, /GATEB_DPAPI_SID_PROBE_APPROVAL_REQUIRED/u);
});
test('only pinned Windows host, target SID and protected installed probe are allowed', () => {
  for (const value of [
    'DESKTOP-8Q4GFC8',
    'NOVELIGHT-GateB',
    'NOVELIGHT-GateB-Independent-Recovery',
    'C:\\ProgramData\\NOVELIGHT\\GateB-Watchdog'
  ]) {
    assert.ok(src.includes(value), value);
  }
  assert.match(src, /NOT_PROTECTED_INSTALL/u);
  assert.match(src, /PERMIT_SCRIPT_HASH_MISMATCH/u);
  assert.match(src, /TARGET_CAN_CHANGE_PERMIT/u);
  assert.match(src, /UNTRUSTED_VAULT_ACL/u);
});
test('target phases require exact nonadmin SID, enabled user and guarded parent', () => {
  assert.match(
    src,
    /\$current -cne \$sid -or \$admin -or -not \$target.Enabled/u
  );
  assert.match(src, /Assert-Guarded \$sid/u);
  assert.match(src, /PARENT_MISMATCH/u);
  assert.match(src, /WATCHDOG_DEADLINE_UNSAFE/u);
});
test('synthetic CurrentUser protect and same SID second process unprotect', () => {
  assert.match(src, /RandomNumberGenerator\]::Create\(\)/u);
  assert.match(src, /New-Object byte\[\] 32/u);
  assert.equal(
    (src.match(/DataProtectionScope\]::CurrentUser/gu) ?? []).length,
    4
  );
  assert.match(src, /TargetCreate/u);
  assert.match(src, /TargetVerify/u);
  assert.match(src, /GATEB_DPAPI_TARGET_SECOND_PROCESS_PASS/u);
  assert.match(src, /FileMode\]::CreateNew/u);
});
test('admin cross-SID denial checks real cryptographic failure, not ACL denial', () => {
  assert.match(
    src,
    /\$current -ceq \$sid -or -not \$admin -or \$target.Enabled/u
  );
  assert.match(
    src,
    /catch \[Security\.Cryptography\.CryptographicException\]/u
  );
  assert.match(src, /DIFFERENT_SID_UNPROTECT_NOT_REJECTED/u);
  assert.match(src, /GATEB_DPAPI_DIFFERENT_SID_DENIED_PASS/u);
});
test('leaves post-test residue for separately authorized cleanup', () => {
  assert.match(src, /Do not delete proof or user profile here/u);
  assert.doesNotMatch(
    src,
    /Remove-Item|Disable-LocalUser|Enable-LocalUser|Set-LocalUser|Stop-Process|Register-ScheduledTask|Start-ScheduledTask/u
  );
});
test('does not accept secrets or run network/cloud operations', () => {
  assert.doesNotMatch(
    src,
    /Read-Host|Get-Clipboard|ConvertTo-SecureString|Invoke-WebRequest|Invoke-RestMethod|curl\.exe|SUPABASE_ACCESS_TOKEN|Start-Process|Set-Content|Get-Credential/iu
  );
  assert.match(src, /array\]::Clear\(\$bytes/u);
  assert.match(src, /array\]::Clear\(\$plain/u);
  assert.match(src, /GATEB_DPAPI_SID_PROBE_NO_GO_/u);
});

test('target success receipt is created only after DPAPI passes and in target Vault', () => {
  assert.match(src, /gateb-dpapi-target-create\.receipt/u);
  assert.match(src, /gateb-dpapi-target-verify\.receipt/u);
  assert.match(src, /FileMode\]::CreateNew/u);
  const last = src.slice(src.indexOf('# A protected launcher cannot redirect'));
  assert.ok(last.indexOf('if ($Passed') < last.indexOf('[IO.File]::Open('));
  assert.match(last, /Write-Output \$ResultMarker/u);
});
