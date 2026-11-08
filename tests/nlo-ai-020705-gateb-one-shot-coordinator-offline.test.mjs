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
    'gateb-dpapi-one-shot-coordinator-candidate.ps1'
  ),
  'utf8'
);

test('Plan rejects, Apply always rejects; unreachable trial only declared', () => {
  assert.match(src, /\[ValidateSet\('Plan','Apply'\)\]/u);
  assert.match(src, /GATEB_DPAPI_ONE_SHOT_OFFLINE_CONTRACT_ONLY/u);
  assert.match(
    src,
    /GATEB_DPAPI_ONE_SHOT_LIVE_BLOCKED_REQUIRES_NEW_APPROVAL_AND_SYSTEM_RESCUE/u
  );
  assert.match(src, /function Invoke-UnreachableAuthorizedTrial/u);
  assert.equal(
    (src.match(/Invoke-UnreachableAuthorizedTrial/gu) ?? []).length,
    1
  );
  assert.match(src, /exit 4\s*$/u);
});
test('only fixed host, user, watchdog and old installed worker hash', () => {
  for (const v of [
    'DESKTOP-8Q4GFC8',
    'NOVELIGHT-GateB',
    'NOVELIGHT-GateB-Independent-Recovery',
    '78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
  ])
    assert.ok(src.includes(v), v);
  assert.match(src, /GUARD_ONLY/u);
  assert.match(src, /GUARDED_TEST/u);
});
test('one-shot ledger CreateNew and immutable old markers not removed', () => {
  assert.match(src, /function Consume-OneShotLedger/u);
  assert.match(src, /FileMode\]::CreateNew/u);
  assert.match(src, /ONE_SHOT_ALREADY_CONSUMED_OR_PARTIAL/u);
  assert.doesNotMatch(src, /Remove-Item|Delete-Item|File\]::Delete/u);
});
test('password generated in-memory via CSPRNG and never as full plaintext string', () => {
  assert.match(
    src,
    /Security\.Cryptography\.RandomNumberGenerator\]::Create\(\)/u
  );
  assert.match(src, /SecureString\]::new\(\)/u);
  assert.match(src, /AppendChar/u);
  assert.match(src, /Set-LocalUser -SID/u);
  assert.match(src, /PSCredential\]::new/u);
  assert.doesNotMatch(
    src,
    /ConvertTo-SecureString|Get-Credential|Read-Host|Get-Clipboard/u
  );
});
test('atomic guarded state writes require parent PID plus UTC birth', () => {
  assert.match(src, /function Arm-GuardAtomically/u);
  assert.match(src, /PARENT_CHANGED/u);
  assert.match(src, /parentStartUtc=\$ParentStartUtc/u);
  assert.match(src, /File\]::Replace\(\$temp,\$State/u);
  assert.match(src, /GUARDED_TEST/u);
  assert.match(src, /MaxGuardSeconds=300/u);
});
test('independent SYSTEM heartbeat must observe PARENT_ALIVE before enable', () => {
  assert.match(src, /function Wait-IndependentArmedHeartbeat/u);
  assert.match(src, /reasonCode -ceq 'PARENT_ALIVE'/u);
  const body = src.slice(
    src.indexOf('function Invoke-UnreachableAuthorizedTrial')
  );
  assert.ok(
    body.indexOf('Wait-IndependentArmedHeartbeat') <
      body.indexOf('Enable-LocalUser')
  );
  assert.match(src, /INDEPENDENT_ARMED_WATCHDOG_NOT_ATTESTED/u);
});
test('two target logon processes use loaded profile and marker proof', () => {
  assert.match(src, /-Credential \$Cred -LoadUserProfile -PassThru/u);
  assert.match(src, /TargetCreate/u);
  assert.match(src, /TargetVerify/u);
  assert.match(src, /GATEB_DPAPI_TARGET_CURRENTUSER_CREATE_PASS/u);
  assert.match(src, /GATEB_DPAPI_TARGET_SECOND_PROCESS_PASS/u);
});
test('disable account before cross-SID cryptographic refusal', () => {
  const body = src.slice(
    src.indexOf('function Invoke-UnreachableAuthorizedTrial')
  );
  assert.ok(
    body.indexOf('Disable-TargetOnce') < body.indexOf('Invoke-CrossSidProbe')
  );
  assert.match(src, /GATEB_DPAPI_DIFFERENT_SID_DENIED_PASS/u);
});
test('process and session census both required before restore', () => {
  assert.match(src, /TARGET_CHILD_REMAINS/u);
  assert.match(src, /OWNER_UNVERIFIED_LIVE_PROCESS/u);
  assert.match(src, /Win32_LogonSession/u);
  assert.match(src, /LOGON_SESSION_REMAINS/u);
  assert.match(src, /function Restore-GuardAtomicallyAfterProof/u);
  assert.match(src, /Assert-ProcessAndSessionZero/u);
});
test('no live cloud, task registration, PAT or logging private values', () => {
  assert.doesNotMatch(
    src,
    /Invoke-WebRequest|Invoke-RestMethod|curl\.exe|api\.supabase|vercel\.com|SUPABASE_ACCESS_TOKEN|Register-ScheduledTask|Unregister-ScheduledTask|Set-ScheduledTask|Write-Host \$(?:password|cred)/iu
  );
});
test('guard expiry and startup are not mistaken for autonomous recovery', () => {
  assert.match(src, /INDEPENDENT_RESCUE_AND_NEW_OWNER_PERMIT_REQUIRED/u);
  assert.match(src, /worker only disables users/u);
  assert.match(src, /MaxEnabledSeconds=240/u);
  assert.match(src, /ACCOUNT_ENABLED_LEASE_EXPIRED/u);
});

const rescue = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'tools',
    'novelight-commander',
    'gateb-dpapi-system-rescue-candidate.ps1'
  ),
  'utf8'
);
test('parent kill rescue is a distinct SYSTEM-only SHA-pinned path', () => {
  assert.match(rescue, /\[ValidateSet\('Inspect','Recover'\)\]/u);
  assert.match(rescue, /SYSTEM_HOST_REQUIRED/u);
  assert.match(rescue, /ARM_MANIFEST_INVALID/u);
  assert.match(rescue, /UNKNOWN_STATE_NO_OVERWRITE/u);
  assert.match(rescue, /Confirm-ScopeExpiredOrParentDead/u);
  assert.match(rescue, /Disable-LocalUser -SID \$u\.SID/u);
  assert.match(rescue, /CHILD_PROCESS_REMAINS/u);
  assert.match(rescue, /LOGON_SESSION_RESIDUE/u);
  assert.match(rescue, /File\]::Replace\(\$temp,\$State/u);
  assert.match(rescue, /GATEB_DPAPI_SYSTEM_RESCUE_NOT_ARMED_NO_OS_CHANGES/u);
  assert.match(rescue, /exit 4\s*$/u);
});
test('guard manifest is created atomically before live state activation', () => {
  assert.match(src, /gateb-dpapi-arm-manifest\.json/u);
  assert.match(src, /originalSha256=\$originalSha;guardedSha256=\$armedSha/u);
  const arming = src.slice(src.indexOf('function Arm-GuardAtomically('));
  assert.ok(
    arming.indexOf('FileMode]::CreateNew') <
      arming.indexOf('[IO.File]::Replace(')
  );
  assert.match(src, /state\.json\.dpapi-original/u);
});
test('receipts are written by SID to Vault, not protected SYSTEM directory', () => {
  assert.match(src, /Join-Path \$Vault 'gateb-dpapi-target-create\.receipt'/u);
  assert.match(src, /Join-Path \$Vault 'gateb-dpapi-target-verify\.receipt'/u);
  assert.doesNotMatch(src, /-RedirectStandardOutput/u);
  assert.match(src, /TARGET_CHILD_TIMEOUT_NO_GO/u);
  assert.match(src, /CHILD_PID_REUSED_DO_NOT_STOP/u);
  assert.match(src, /CHILD_SID_CHANGED_DO_NOT_STOP/u);
  assert.match(src, /Wait-Process -Id \$p.Id -Timeout 55/u);
});
test('unhandled control error tries exactly one local disable and clears password', () => {
  const controller = src.slice(
    src.indexOf('function Invoke-UnreachableAuthorizedTrial')
  );
  assert.match(controller, /try \{/u);
  assert.match(controller, /\} finally \{/u);
  assert.match(controller, /try \{ Disable-TargetOnce \}/u);
  assert.match(controller, /\$cred\.Password\.Dispose\(\)/u);
  assert.match(controller, /EMERGENCY_DISABLE_NOT_CONFIRMED/u);
});

test('normal GUARD_ONLY restore verifies both pinned state hashes', () => {
  assert.match(src, /UNTRUSTED_ARM_MANIFEST/u);
  assert.match(src, /UNKNOWN_GUARD_STATE_NO_OVERWRITE/u);
  assert.match(src, /\$currentHash -cne \$manifest.guardedSha256/u);
  assert.match(src, /\$originalHash -cne \$manifest.originalSha256/u);
});
