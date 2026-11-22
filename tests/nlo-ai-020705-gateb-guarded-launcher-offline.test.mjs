import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TARGET,
  STEPS,
  planGateBDpapiTrial,
  simulateGateBSidRecovery,
  realGuardedLaunchGateB
} from '../scripts/nlo-ai-020705-gateb-guarded-launcher-offline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ps = readFileSync(
  join(
    root,
    'tools',
    'novelight-commander',
    'gateb-dpapi-guarded-launcher-candidate.ps1'
  ),
  'utf8'
);
const restore = readFileSync(
  join(
    root,
    'tools',
    'novelight-commander',
    'gateb-dpapi-guarded-restore-candidate.ps1'
  ),
  'utf8'
);

test('plan defaults to no Windows authority even with no user input', () => {
  const out = planGateBDpapiTrial();
  assert.equal(out.status, 'BLOCK_PRECONDITIONS_NO_GO');
  assert.ok(out.missing.includes('trustedCredentialAvailable'));
  assert.equal(out.realWindowsActions, 0);
  assert.equal(out.liveAuthorised, false);
});
test('fully satisfied mock admission STILL cannot authorize real Windows apply', () => {
  const keys = planGateBDpapiTrial().missing;
  const context = Object.fromEntries(keys.map((key) => [key, true]));
  const p = planGateBDpapiTrial({ ...context, maxApply: 1, guardSeconds: 300 });
  assert.equal(p.status, 'OFFLINE_PLAN_ONLY_NOT_LIVE_AUTHORITY');
  assert.equal(p.liveAuthorised, false);
  assert.equal(p.realCredentialsAccepted, false);
  assert.equal(p.realDpapiActions, 0);
});
test('reject unscoped retries, excessive lease and secret-bearing input', () => {
  const p = planGateBDpapiTrial({
    maxApply: 2,
    guardSeconds: 301,
    password: 'DO_NOT_LOG'
  });
  assert.equal(p.status, 'BLOCK_PRECONDITIONS_NO_GO');
  assert.equal(p.sensitiveInputDenied, true);
  assert.doesNotMatch(JSON.stringify(p), /DO_NOT_LOG/u);
  assert.equal(TARGET.maxApply, 1);
  assert.equal(TARGET.maxGuardSeconds, 300);
});
test('real protected launch function is permanently disabled', () => {
  const r = realGuardedLaunchGateB();
  assert.equal(r.status, 'BLOCK_LIVE_CREDENTIAL_LAUNCH_UNIMPLEMENTED');
  assert.equal(r.realWindowsActions, 0);
  assert.equal(r.realRunnerStarted, false);
});
test('offline sequence covers same SID separate-process and different SID failure', () => {
  assert.ok(STEPS.includes('TARGET_CURRENTUSER_DPAPI_SYNTHETIC_CREATE'));
  assert.ok(STEPS.includes('NEW_TARGET_SID_PROCESS_SAME_USER_DPAPI_VERIFY'));
  assert.ok(STEPS.includes('ADMIN_OTHER_SID_DPAPI_CRYPTOGRAPHIC_REJECTION'));
  const out = simulateGateBSidRecovery();
  assert.equal(out.status, 'OFFLINE_SEQUENCE_PASS_NOT_LIVE_PROOF');
  assert.equal(out.guardRestored, true);
  assert.equal(out.targetEnabled, false);
  assert.equal(out.gate, 'NO_GO');
  assert.equal(out.realWindowsActions, 0);
  assert.equal(out.ledgerConsumed, true);
});
test('every injected stage failure stays NO-GO and consumed ledger never resets', () => {
  for (let i = 0; i < STEPS.length; i++) {
    const out = simulateGateBSidRecovery({ failAt: i });
    assert.equal(out.status, 'OFFLINE_INJECTED_NO_GO', STEPS[i]);
    assert.equal(
      out.ledgerConsumed,
      i > STEPS.indexOf('ATOMIC_CONSUME_NEW_ONE_SHOT_MARKER')
    );
    assert.equal(out.realWindowsActions, 0);
    assert.equal(out.gate, 'NO_GO');
  }
});
test('parent death requires independent re-disable proof and state restoration', () => {
  const out = simulateGateBSidRecovery({ killParentAt: 11 });
  assert.equal(out.reason, 'PARENT_GONE');
  assert.equal(out.watchdogDisableObserved, false);
  assert.equal(out.independentWatchdogProofRequired, true);
  assert.equal(out.targetEnabled, true);
  assert.equal(out.adminEmergencyDisableRequired, true);
  assert.equal(out.manualRestoreRequired, true);
  assert.equal(out.guardRestored, false);
});
test('expiry, wrong SID and cross-SID DPAPI success are explicit NO-GO', () => {
  const expiry = simulateGateBSidRecovery({ clockExpiredAt: 10 });
  const sid = simulateGateBSidRecovery({ wrongSid: true });
  const crypto = simulateGateBSidRecovery({ dpapiCrossSidAccepted: true });
  assert.equal(expiry.reason, 'DEADLINE_EXPIRED');
  assert.equal(sid.reason, 'WRONG_TARGET_SID');
  assert.equal(crypto.reason, 'CROSS_SID_DPAPI_ACCEPTED_CRITICAL');
  assert.ok([expiry, sid, crypto].every((o) => o.gate === 'NO_GO'));
});
test('process or logon session residue is not confused with disabled account', () => {
  for (const condition of [
    { processResidue: true },
    { sessionResidue: true }
  ]) {
    const out = simulateGateBSidRecovery(condition);
    assert.equal(out.reason, 'PROCESS_OR_SESSION_RESIDUE');
    assert.equal(out.residualNoGo, true);
    assert.equal(out.gate, 'NO_GO');
  }
});
test('PowerShell Plan and Apply are always denied before sensitive functions', () => {
  assert.match(ps, /\$Mode -eq 'Plan'/u);
  assert.match(ps, /\$Mode -eq 'Apply'/u);
  assert.match(ps, /GATEB_DPAPI_GUARDED_LAUNCHER_LIVE_BLOCKED/u);
  assert.match(ps, /Start-PinnedTargetSidProbe/u);
  assert.match(ps, /Credential \$Credential -LoadUserProfile/u);
  assert.match(ps, /CHILD_SID_MISMATCH/u);
  assert.match(ps, /GUARD_ONLY_NOT_VERIFIED/u);
  assert.match(ps, /WATCHDOG_EXPIRING/u);
  assert.match(ps, /PROCESS_OWNER_UNVERIFIED/u);
  assert.doesNotMatch(
    ps,
    /Enable-LocalUser|Disable-LocalUser|Set-LocalUser|Register-ScheduledTask|Remove-Item|Start-ScheduledTask/u
  );
});
test('synthetic candidate does not read real external credentials or call cloud', () => {
  assert.doesNotMatch(
    ps,
    /Read-Host|Get-Clipboard|Invoke-WebRequest|Invoke-RestMethod|Get-Credential|SUPABASE_ACCESS_TOKEN/iu
  );
  assert.equal(TARGET.allowedCredentialModes.includes('S4U'), false);
  assert.ok(STEPS.includes('VERIFY_NO_CHILD_PROCESS_OR_LOGON_SESSION'));
});

test('guard restore needs fixed source/active hashes and refuses unknown state', () => {
  assert.match(restore, /Invoke-AtomicGuardRestore/u);
  assert.match(restore, /UNKNOWN_STATE_NO_OVERWRITE/u);
  assert.match(restore, /\[IO\.File\]::Replace\(/u);
  assert.match(restore, /Assert-PinnedState \$guard 'GUARDED_TEST'/u);
  assert.match(restore, /Assert-PinnedState \$original 'GUARD_ONLY'/u);
  assert.match(restore, /ACTIVE_PARENT_NOT_SAFE_TO_RESTORE/u);
  assert.match(restore, /GUARD_ALREADY_GUARD_ONLY_READONLY/u);
  assert.match(restore, /GUARD_INTERRUPTED_RESTORE_REQUIRED/u);
});
test('recovery entrypoint refuses Restore without a new owner-scoped implementation', () => {
  assert.match(restore, /\$Mode -eq 'Restore'/u);
  assert.match(restore, /GATEB_DPAPI_GUARD_RESTORE_UNAPPROVED_BLOCKED/u);
  assert.match(restore, /gateb-dpapi-once-consumed\.marker/u);
  assert.match(restore, /RESTORE_TEMP_ALREADY_PRESENT/u);
  assert.doesNotMatch(
    restore,
    /Enable-LocalUser|Disable-LocalUser|Stop-Process|Set-LocalUser|Register-ScheduledTask/u
  );
});
test('unproven forced parent death must not masquerade as observed disable', () => {
  const out = simulateGateBSidRecovery({ killParentAt: 10 });
  assert.equal(out.watchdogDisableObserved, false);
  assert.equal(out.independentWatchdogProofRequired, true);
  assert.equal(out.adminEmergencyDisableRequired, true);
  assert.equal(out.targetEnabled, true);
  assert.equal(out.manualRestoreRequired, true);
  assert.equal(out.gate, 'NO_GO');
});

test('session residue uses user SID-associated Win32_LogonSession independently of process count', () => {
  assert.match(ps, /Get-CimInstance Win32_UserAccount -Filter/u);
  assert.match(ps, /Get-CimAssociatedInstance -InputObject \$account\[0\]/u);
  assert.match(ps, /Win32_LoggedOnUser -ResultClassName Win32_LogonSession/u);
  assert.match(ps, /TARGET_LOGON_SESSION_REMAINS/u);
  assert.match(ps, /Assert-TargetSessionsZero/u);
});
