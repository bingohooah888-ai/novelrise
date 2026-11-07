import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CRASH_STAGES,
  evaluateGuardedCrashReadiness,
  simulateCrashRecoveryTrial,
  evaluateZeroResidueCensus,
  evaluateParentDeathReasonEvidence,
  startRealGuardedCrashTest
} from '../scripts/nlo-ai-020705-gateb-crash-recovery-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inspector = join(
  root,
  'tools',
  'novelight-commander',
  'gateb-crash-recovery-readonly-preflight.ps1'
);
const source = readFileSync(inspector, 'utf8');
const scope = {
  mode: 'OFFLINE_ONLY',
  host: 'DESKTOP-8Q4GFC8',
  user: 'NOVELIGHT-GateB',
  task: 'NOVELIGHT-GateB-Independent-Recovery'
};
const ready = Object.freeze({
  ...scope,
  workerSha256:
    'dd418a7a50854c54a182fd3042b8dfadd5b8da77f9c99d106aab4bd706c3e66f',
  accountDisabled: true,
  nonAdmin: true,
  profileAbsent: true,
  vaultEmpty: true,
  guardPhase: 'GUARD_ONLY',
  systemPrincipal: true,
  taskActionPinned: true,
  workerFilePinned: true,
  protectedAcl: true,
  sidMatches: true,
  repeatedHeartbeat: true,
  heartbeatAgeSeconds: 18,
  taskLastExitCode: 0,
  repetitionWindowMinutesLeft: 600,
  independentKillProof: false,
  nloTaskDefinitionsUnchanged: true
});
const trial = Object.freeze({
  ...scope,
  ownerApprovalAttempts: 1,
  accountInitiallyDisabled: true,
  guardWitnessCurrent: true,
  parentIdentityPinned: true,
  childIdentityPinned: true,
  watchdogScheduleValid: true,
  failAt: null,
  watchdogSimulatesRecovery: true,
  childProcessLeftRunning: false,
  profileRemains: false,
  crossUserDpapiDenySimulated: true
});
const zero = Object.freeze({
  ...scope,
  accountDisabled: true,
  fixedSidMatches: true,
  guardOnly: true,
  heartbeatFresh: true,
  workerHashPinned: true,
  taskEnabled: true,
  taskRunningSuccessfully: true,
  parentProcessAbsent: true,
  childProcessesAbsent: true,
  newUserProfileAbsent: true,
  vaultEmpty: true,
  temporaryFilesAbsent: true,
  nloTaskDefinitionsUnchanged: true,
  realCredentialsNotUsed: true
});
function noRealAuthority(result) {
  assert.equal(result.simulationOnly, true);
  assert.equal(result.gateBGo, false);
  assert.equal(result.liveExecutionAuthorized, false);
  for (const key of [
    'userEnabled',
    'passwordReset',
    'processKilled',
    'taskMutated',
    'dpapiExecuted',
    'liveRecoveryAttested',
    'profileDeleted',
    'realPatUsed',
    'productionAccessGranted'
  ])
    assert.equal(result[key], false, key);
  assert.equal(result.cloudMutations, 0);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.steps), true);
  assert.equal('token' in result, false);
  assert.equal('password' in result, false);
}
test('default invocation is denied in all three pure modules', () => {
  for (const fn of [
    evaluateGuardedCrashReadiness,
    simulateCrashRecoveryTrial,
    evaluateZeroResidueCensus
  ])
    noRealAuthority(fn());
});
test('extra secret and command fields are rejected and never echoed', () => {
  for (const input of [
    { ...ready, pat: 'secret-placeholder' },
    { ...trial, password: 'secret-placeholder' },
    { ...zero, jwt: 'secret-placeholder' },
    { ...ready, command: 'Enable-LocalUser' },
    { ...trial, endpoint: 'https://example.invalid' },
    null,
    [],
    Object.create(null)
  ]) {
    for (const fn of [
      evaluateGuardedCrashReadiness,
      simulateCrashRecoveryTrial,
      evaluateZeroResidueCensus
    ]) {
      const result = fn(input);
      noRealAuthority(result);
      assert.doesNotMatch(JSON.stringify(result), /secret-placeholder/u);
    }
  }
});
test('scope never widens to a second account or host', () => {
  for (const [key, value] of [
    ['host', 'OTHER-PC'],
    ['user', 'OtherAccount'],
    ['task', 'SomeOtherTask'],
    ['mode', 'LIVE']
  ])
    for (const fn of [
      evaluateGuardedCrashReadiness,
      simulateCrashRecoveryTrial,
      evaluateZeroResidueCensus
    ])
      noRealAuthority(fn({ ...ready, [key]: value }));
});
test('valid GUARD_ONLY heartbeat is not kill recovery proof', () => {
  const r = evaluateGuardedCrashReadiness(ready);
  noRealAuthority(r);
  assert.equal(
    r.status,
    'OFFLINE_GUARD_READY_BUT_KILL_RECOVERY_NOT_PROVEN_NO_GO'
  );
});
test('mock kill proof cannot confer live authorization', () => {
  const r = evaluateGuardedCrashReadiness({
    ...ready,
    independentKillProof: true
  });
  noRealAuthority(r);
  assert.equal(r.status, 'OFFLINE_MOCK_READINESS_ONLY_NO_GO');
});
test('stale heartbeat, expiry, and out-of-range times fail closed', () => {
  for (const change of [
    { heartbeatAgeSeconds: 121 },
    { heartbeatAgeSeconds: -1 },
    { heartbeatAgeSeconds: Number.NaN },
    { repetitionWindowMinutesLeft: 29 },
    { repetitionWindowMinutesLeft: Number.POSITIVE_INFINITY }
  ]) {
    const r = evaluateGuardedCrashReadiness({ ...ready, ...change });
    noRealAuthority(r);
    assert.equal(r.status, 'BLOCK_STALE_HEARTBEAT_OR_EXPIRING_TASK');
  }
});
test('task failure, user/profile drift and ACL failure block', () => {
  for (const key of [
    'accountDisabled',
    'nonAdmin',
    'profileAbsent',
    'vaultEmpty',
    'systemPrincipal',
    'taskActionPinned',
    'workerFilePinned',
    'protectedAcl',
    'sidMatches',
    'repeatedHeartbeat',
    'nloTaskDefinitionsUnchanged'
  ]) {
    const r = evaluateGuardedCrashReadiness({ ...ready, [key]: false });
    noRealAuthority(r);
    assert.equal(r.status, 'BLOCK_INDEPENDENT_GUARD_PROOF_INCOMPLETE', key);
  }
  assert.equal(
    evaluateGuardedCrashReadiness({ ...ready, taskLastExitCode: 3 }).status,
    'BLOCK_INDEPENDENT_GUARD_PROOF_INCOMPLETE'
  );
});
test('worker SHA, GUARD_ONLY and identity are exact', () => {
  for (const change of [
    { workerSha256: 'invalid' },
    { guardPhase: 'GUARDED_TEST' },
    { user: 'NOVELIGHT-B' },
    { host: 'DESKTOP-OTHER' }
  ]) {
    const r = evaluateGuardedCrashReadiness({ ...ready, ...change });
    noRealAuthority(r);
    assert.equal(r.status, 'BLOCK_FIXED_IDENTITY_OR_GUARD_SCOPE');
  }
});
test('all crash-phase simulations remain NO-GO even at apparent completion', () => {
  const result = simulateCrashRecoveryTrial(trial);
  noRealAuthority(result);
  assert.equal(result.steps.length, 15);
  assert.equal(
    result.status,
    'OFFLINE_CRASH_RECOVERY_SEQUENCE_SIMULATED_NO_GO'
  );
  assert.deepEqual(result.steps, CRASH_STAGES);
});
test('all 15 injected crashes consume attempt and require manual census', () => {
  for (const failAt of CRASH_STAGES) {
    const result = simulateCrashRecoveryTrial({ ...trial, failAt });
    noRealAuthority(result);
    assert.equal(
      result.status,
      'OFFLINE_INJECTED_FAILURE_REQUIRES_MANUAL_CENSUS_NO_GO'
    );
    assert.equal(result.steps.at(-1), failAt);
  }
});
test('absent guard, wrong attempt count and unpinned child block before trial', () => {
  for (const change of [
    { ownerApprovalAttempts: 2 },
    { ownerApprovalAttempts: 0 },
    { accountInitiallyDisabled: false },
    { guardWitnessCurrent: false },
    { parentIdentityPinned: false },
    { childIdentityPinned: false },
    { watchdogScheduleValid: false },
    { failAt: 'outside-model' }
  ]) {
    const r = simulateCrashRecoveryTrial({ ...trial, ...change });
    noRealAuthority(r);
    assert.equal(r.status, 'BLOCK_MISSING_GUARD_OR_REPLAY');
    assert.equal(r.steps.length, 0);
  }
});
test('parent termination without independent watchdog recovery is no-go', () => {
  const r = simulateCrashRecoveryTrial({
    ...trial,
    watchdogSimulatesRecovery: false
  });
  noRealAuthority(r);
  assert.equal(r.status, 'OFFLINE_SIMULATED_WATCHDOG_MISSED_RECOVERY_NO_GO');
});
test('disabling the account does not prove child process termination', () => {
  const r = simulateCrashRecoveryTrial({
    ...trial,
    childProcessLeftRunning: true
  });
  noRealAuthority(r);
  assert.equal(
    r.status,
    'OFFLINE_ENABLED_ACCOUNT_MAY_BE_DISABLED_BUT_PROCESS_REMAINS_NO_GO'
  );
});
test('failed cross-user DPAPI denial is not counted as proof', () => {
  const r = simulateCrashRecoveryTrial({
    ...trial,
    crossUserDpapiDenySimulated: false
  });
  noRealAuthority(r);
  assert.equal(r.status, 'OFFLINE_DPAPI_USER_BOUNDARY_NOT_PROVEN_NO_GO');
});
test('profile leftovers cannot be silently deleted in simulation', () => {
  const r = simulateCrashRecoveryTrial({ ...trial, profileRemains: true });
  noRealAuthority(r);
  assert.equal(r.status, 'OFFLINE_PROFILE_RESIDUE_MANUAL_RECONCILIATION_NO_GO');
});
test('zero-residue model covers child/process/profile/guard independently', () => {
  for (const key of Object.keys(zero).slice(4)) {
    const r = evaluateZeroResidueCensus({ ...zero, [key]: false });
    noRealAuthority(r);
    assert.equal(
      r.status,
      'BLOCK_RESIDUAL_PROCESS_PROFILE_OR_GUARD_UNVERIFIED',
      key
    );
  }
});
test('perfect mocked zero census still cannot open Gate B', () => {
  const r = evaluateZeroResidueCensus(zero);
  noRealAuthority(r);
  assert.equal(r.status, 'OFFLINE_ZERO_RESIDUE_CONTRACT_MATCH_NO_GO');
});
test('existing disabled-only heartbeat cannot attest parent-death branch', () => {
  const observed = evaluateParentDeathReasonEvidence({
    ...scope,
    watchdogReason: 'WATCHDOG_DISABLED_CONFIRMED',
    heartbeatFresh: true,
    sidMatches: true,
    accountDisabled: true
  });
  noRealAuthority(observed);
  assert.equal(observed.status, 'BLOCK_PARENT_DEATH_BRANCH_NOT_OBSERVABLE');
});
test('synthetic explicit reason remains no-go even with positive mock claims', () => {
  const observed = evaluateParentDeathReasonEvidence({
    ...scope,
    watchdogReason: 'WATCHDOG_PARENT_GONE',
    heartbeatFresh: true,
    sidMatches: true,
    accountDisabled: true
  });
  noRealAuthority(observed);
  assert.equal(
    observed.status,
    'OFFLINE_PARENT_GONE_MARKER_MATCH_NO_REAL_DISABLE_PROOF_NO_GO'
  );
});
test('stale or unpinned parent-death witness fails closed', () => {
  const reason = {
    ...scope,
    watchdogReason: 'WATCHDOG_PARENT_GONE',
    heartbeatFresh: true,
    sidMatches: true,
    accountDisabled: true
  };
  for (const patch of [
    { heartbeatFresh: false },
    { sidMatches: false },
    { accountDisabled: false }
  ]) {
    const observed = evaluateParentDeathReasonEvidence({ ...reason, ...patch });
    noRealAuthority(observed);
    assert.equal(observed.status, 'BLOCK_PARENT_DEATH_REASON_UNVERIFIED');
  }
});
test('there is no live OS/DPAPI runner entrypoint', () => {
  assert.throws(startRealGuardedCrashTest, /NOT_IMPLEMENTED/u);
});
test('read-only PowerShell preflight locks task/host/user and worker hash', () => {
  assert.match(source, /DESKTOP-8Q4GFC8/u);
  assert.match(source, /NOVELIGHT-GateB/u);
  assert.match(source, /GATEB_CRASH_REAL_EXECUTION_NOT_IMPLEMENTED/u);
  assert.match(source, /GUARD_ONLY/u);
  assert.match(source, /WATCHDOG_TRIGGER_EXPIRED_OR_UNSAFE/u);
  assert.match(source, /heartbeat\.json/u);
  assert.match(source, /GetAccessControl/u);
  assert.match(source, /Win32_UserProfile/u);
  assert.match(source, /Get-ScheduledTaskInfo/u);
  assert.doesNotMatch(
    source,
    /Enable-LocalUser|Disable-LocalUser|Set-LocalUser|New-LocalUser|Remove-LocalUser|Start-ScheduledTask|Register-ScheduledTask|Stop-Process|Stop-ScheduledTask|Unregister-ScheduledTask|Set-Acl|Remove-Item|Read-Host|Get-Clipboard|Invoke-RestMethod|Invoke-WebRequest/iu
  );
});
test(
  'Windows PowerShell AST parses the read-only inspector',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const code = [
      '$t=$null;$e=$null',
      '[void][Management.Automation.Language.Parser]::ParseFile(' +
        "'" +
        inspector.replaceAll("'", "''") +
        "',[ref]$t,[ref]$e)",
      'if(@($e).Count -ne 0){exit 3};exit 0'
    ].join(';');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', code],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    assert.equal(result.status, 0);
  }
);
test(
  'Windows Apply route cannot mutate even with elevated user',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', inspector, '-Mode', 'Apply'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    assert.equal(r.status, 4);
    assert.equal(r.stdout.trim(), 'GATEB_CRASH_REAL_EXECUTION_NOT_IMPLEMENTED');
  }
);
test(
  'Windows unprivileged read-only inspection fails closed',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const who = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (/S-1-16-12288/u.test(who)) return;
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', inspector, '-Mode', 'Inspect'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    assert.equal(r.status, 3);
    assert.equal(
      r.stdout.trim(),
      'GATEB_CRASH_READONLY_PREFLIGHT_INCOMPLETE_NO_GO'
    );
  }
);
