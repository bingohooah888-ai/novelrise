import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tools',
  'novelight-commander'
);
const read = (name) => readFileSync(join(dir, name), 'utf8');
const install = read('gateb-dpapi-protected-install-candidate.ps1');
const permit = read('gateb-dpapi-approval-contract.ps1');
const rescue = read('gateb-dpapi-system-rescue-candidate.ps1');
const coordinator = read('gateb-dpapi-one-shot-coordinator-candidate.ps1');
const proof = read('gateb-dpapi-sid-proof-candidate.ps1');

test('installer Plan is a no-op and install is a separate Admin-permit action', () => {
  assert.match(install, /\[ValidateSet\('Plan','Install'\)\]/u);
  assert.match(install, /GATEB_DPAPI_INSTALL_OFFLINE_PLAN_ONLY/u);
  assert.match(install, /function Assert-InstallPrerequisites/u);
  assert.match(install, /PERMIT_NOT_OWNER_CONTROLLED/u);
  assert.match(install, /INSTALLER_NOT_OWNER_HASH_PINNED/u);
  assert.match(install, /OWNER_PERMIT_SCOPE_INVALID/u);
});
test('install only copies SHA pinned files with a CreateNew one-shot install marker', () => {
  assert.match(install, /gateb-dpapi-install-once\.marker/u);
  assert.match(install, /FileMode\]::CreateNew/u);
  assert.match(install, /SOURCE_NOT_OWNER_HASH_PINNED/u);
  assert.match(
    install,
    /SetAccessRuleProtection|GetAccessRule|AreAccessRulesProtected/u
  );
  assert.match(install, /\[IO.File\]::Copy\(\$src,\$dest,\$false\)/u);
  assert.doesNotMatch(
    install,
    /Remove-Item|Delete-Item|Reset-LocalUser|Disable-LocalUser|Enable-LocalUser/u
  );
});
test('future SYSTEM task boot and daily minute cadence is scoped to rescue', () => {
  assert.match(install, /NOVELIGHT-GateB-DPAPI-Independent-Rescue/u);
  assert.match(install, /<BootTrigger>/u);
  assert.match(install, /<CalendarTrigger>/u);
  assert.match(install, /<Interval>PT1M<\/Interval>/u);
  assert.match(install, /<Duration>P1D<\/Duration>/u);
  assert.match(install, /<UserId>S-1-5-18<\/UserId>/u);
  assert.match(
    install,
    /Register-ScheduledTask -TaskName \$TaskName -TaskPath/u
  );
  assert.match(install, /INSTALLED_SYSTEM_TASK_NOT_PINNED/u);
});
test('protected contract checks immutable head scope, exact hashes, account SID and expiry', () => {
  assert.match(permit, /function Assert-GateBDpapiOwnerPermit/u);
  assert.match(permit, /PERMIT_SCOPE_MISMATCH/u);
  assert.match(permit, /OWNER_PERMIT_NOT_FRESH/u);
  assert.match(permit, /INSTALLED_FILE_SHA_DRIFT/u);
  assert.match(permit, /PERMIT_WRITABLE_BY_TARGET/u);
  assert.match(permit, /PERMIT_OWNER_DRIFT/u);
  assert.match(permit, /maxApply -ne 1/u);
  assert.match(permit, /maxEnabledSeconds -ne 240/u);
  assert.match(permit, /maxGuardSeconds -ne 300/u);
});
test('proof arm inherits owner-pinned SHA and deadline', () => {
  assert.match(install, /gateb-dpapi-sid-proof-arm\.json/u);
  assert.match(
    install,
    /scriptSha256=\[string\]\$p.files\.'gateb-dpapi-sid-proof\.ps1'/u
  );
  assert.match(proof, /PERMIT_SCRIPT_HASH_MISMATCH/u);
  assert.match(proof, /UNTRUSTED_TARGET_VAULT_RIGHTS/u);
});
test('rescue task is independently executable under SYSTEM and can emit evidence', () => {
  assert.match(rescue, /function Invoke-AuthorizedSystemRecovery/u);
  assert.match(rescue, /SYSTEM_ONLY/u);
  assert.match(rescue, /Assert-GateBDpapiOwnerPermit/u);
  assert.match(rescue, /IDLE_DISABLED/u);
  assert.match(rescue, /ARMED_PARENT_ALIVE/u);
  assert.match(rescue, /RESTORED_GUARD_ONLY/u);
  assert.match(rescue, /Write-RescueHeartbeat/u);
  assert.match(rescue, /Invoke-IndependentSystemGuardRestore/u);
  assert.match(rescue, /GATEB_DPAPI_SYSTEM_RESCUE_NO_GO_/u);
});
test('coordinator live mode is unreachable from worktree or without protected owner permit', () => {
  assert.match(coordinator, /NOT_PROTECTED_INSTALL/u);
  assert.match(coordinator, /Assert-GateBDpapiOwnerPermit/u);
  assert.match(coordinator, /RequireUnexpired/u);
  assert.match(coordinator, /Assert-ProtectedRescueIsReady/u);
  assert.match(coordinator, /SYSTEM_RESCUE_NOT_ATTESTED/u);
  assert.match(coordinator, /ONE_SHOT_ALREADY_CONSUMED_OR_PARTIAL/u);
  assert.match(coordinator, /GATEB_DPAPI_ONE_SHOT_NO_GO_NO_RETRY/u);
});
test('both SYSTEM monitors must arm before enabling and attest restoration', () => {
  const start = coordinator.indexOf('function Invoke-ApprovedOneShotTrial');
  const body = coordinator.slice(
    start,
    coordinator.indexOf('# Explicitly protected future Apply entrypoint', start)
  );
  assert.ok(
    body.indexOf('Wait-IndependentArmedHeartbeat') <
      body.indexOf('Enable-LocalUser')
  );
  assert.ok(
    body.indexOf('Wait-RescueArmedHeartbeat') < body.indexOf('Enable-LocalUser')
  );
  assert.ok(
    body.indexOf('Wait-GuardOnlyRestoredHeartbeats') >
      body.indexOf('Restore-GuardAtomicallyAfterProof')
  );
  assert.match(
    coordinator,
    /INDEPENDENT_GUARD_ONLY_RESTORE_HEARTBEATS_MISSING/u
  );
});
test('no unscoped cloud, credentials in logs, or production actions', () => {
  const text = [install, permit, rescue, coordinator].join('\n');
  assert.doesNotMatch(
    text,
    /Invoke-WebRequest|Invoke-RestMethod|api\.supabase|vercel\.com|Stripe|SUPABASE_ACCESS_TOKEN|Get-Clipboard|Get-Credential|Read-Host/iu
  );
});

test('admin installation waits for real independent SYSTEM heartbeat', () => {
  assert.match(install, /INDEPENDENT_SYSTEM_RESCUE_HEARTBEAT_NOT_OBSERVED/u);
  assert.match(
    install,
    /GATEB_DPAPI_INSTALL_AND_INDEPENDENT_RESCUE_HEARTBEAT_PASS/u
  );
  assert.match(install, /Assert-GateBDpapiOwnerPermit/u);
  assert.match(install, /LastTaskResult -eq 0/u);
  assert.match(install, /Get-LocalUser -Name \$AccountName/u);
});
test('permit cannot have extra, inherited, or target write ACL', () => {
  assert.match(permit, /PERMIT_EXTRA_ACL_RULES/u);
  assert.match(permit, /PERMIT_ACL_IDENTITY_DRIFT/u);
  assert.match(permit, /PERMIT_WRITABLE_BY_TARGET/u);
  assert.match(install, /PERMIT_HAS_UNTRUSTED_ACCESS/u);
  assert.match(install, /PERMIT_TARGET_MODIFY_RIGHTS/u);
});
