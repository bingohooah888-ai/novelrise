import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  simulateGateBOneShotAuth,
  enableGateBUser
} from '../scripts/nlo-ai-020705-gateb-one-shot-auth-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ps = join(
  root,
  'tools',
  'novelight-commander',
  'gateb-one-shot-auth-preflight.ps1'
);
const psContent = readFileSync(ps, 'utf8');
const model = Object.freeze({
  mode: 'OFFLINE_SIMULATION_ONLY',
  host: 'DESKTOP-8Q4GFC8',
  account: 'NOVELIGHT-GateB',
  branch: 'work/ai-020705-gateb-one-shot-auth-preflight-20261107',
  stagingRef: 'wmlzjgvxgoyrovdhbqbg',
  watchdogIndependentlyAttested: true,
  initiallyDisabled: true,
  profileInitiallyAbsent: true,
  approvalAttempts: 1,
  failAtStage: null
});

function checkNeverAuthorizes(x) {
  assert.equal(x.simulationOnly, true);
  assert.equal(x.executionAuthorized, false);
  for (const name of [
    'userChanged',
    'realUserEnabled',
    'realPasswordReset',
    'actualWatchdogArmed',
    'syntheticUserLoggedOn',
    'realDpapiTestRun',
    'realPatAccepted',
    'stagingWriteAuthorized',
    'productionAccessAuthorized',
    'aiSpendAuthorized',
    'gateBGo'
  ])
    assert.equal(x[name], false, name);
  assert.equal(x.cloudMutations, 0);
  assert.equal(Object.isFrozen(x), true);
}

test('default/unknown inputs fail closed and never authorize live action', () => {
  for (const input of [
    {},
    null,
    [],
    { ...model, token: 'dummy' },
    { ...model, password: 'dummy' },
    { ...model, path: 'C:/temp' },
    { ...model, mode: 'Apply' }
  ]) {
    const x = simulateGateBOneShotAuth(input);
    checkNeverAuthorizes(x);
    assert.equal(x.status, 'BLOCK_EXACT_OFFLINE_OPT_IN_REQUIRED');
  }
});

test('other host, user, branch, staging and production refs are refused', () => {
  for (const [key, value] of [
    ['host', 'OTHER-PC'],
    ['account', 'OtherUser'],
    ['branch', 'main'],
    ['stagingRef', 'fiepaguycecrredwrcwx'],
    ['stagingRef', 'unknown']
  ]) {
    const x = simulateGateBOneShotAuth({ ...model, [key]: value });
    checkNeverAuthorizes(x);
    assert.equal(x.status, 'BLOCK_SCOPE_MISMATCH');
  }
});

test('unarmed watchdog blocks before even a simulated reset', () => {
  const x = simulateGateBOneShotAuth({
    ...model,
    watchdogIndependentlyAttested: false
  });
  checkNeverAuthorizes(x);
  assert.equal(x.status, 'BLOCK_CRASH_RECOVERY_WITNESS_MISSING');
  assert.equal(x.observed.length, 0);
});

test('replay, previously enabled account and existing profile are refused', () => {
  for (const change of [
    { initiallyDisabled: false },
    { profileInitiallyAbsent: false },
    { approvalAttempts: 0 },
    { approvalAttempts: 2 },
    { failAtStage: 'unknownStage' }
  ]) {
    const x = simulateGateBOneShotAuth({ ...model, ...change });
    checkNeverAuthorizes(x);
    assert.equal(x.status, 'BLOCK_PRECONDITIONS_OR_REPLAY');
  }
});

test('all modeled stages complete without conferring any real authority', () => {
  const x = simulateGateBOneShotAuth(model);
  checkNeverAuthorizes(x);
  assert.equal(x.status, 'OFFLINE_COMPLETE_CONTRACT_SIMULATED_NO_GO');
  assert.deepEqual(x.observed, [
    'preflight',
    'armWatchdog',
    'resetPassword',
    'enableUser',
    'startSyntheticChild',
    'disableUser',
    'crossUserDeny',
    'cleanupNewProfile',
    'zeroResidue'
  ]);
});

test('all nine failure-injection points simulate safe disabled end state', () => {
  for (const phase of [
    'preflight',
    'armWatchdog',
    'resetPassword',
    'enableUser',
    'startSyntheticChild',
    'disableUser',
    'crossUserDeny',
    'cleanupNewProfile',
    'zeroResidue'
  ]) {
    const x = simulateGateBOneShotAuth({ ...model, failAtStage: phase });
    checkNeverAuthorizes(x);
    assert.equal(x.status, 'OFFLINE_INJECTED_FAILURE_RECOVERED_NO_GO');
    assert.ok(x.observed.at(-1).startsWith('mock'));
  }
});

test('mock witness cannot enable the real user or launch a runner', () => {
  assert.throws(enableGateBUser, /NOT_IMPLEMENTED/u);
  const x = simulateGateBOneShotAuth(model);
  assert.equal(x.actualWatchdogArmed, false);
  assert.equal(x.realUserEnabled, false);
});

test('PowerShell admits only read-only preflight and permanently blocks Apply', () => {
  assert.match(psContent, /ValidateSet\('Preflight', 'Apply'\)/u);
  assert.match(
    psContent,
    /GATEB_APPLY_BLOCKED_INDEPENDENT_RECOVERY_NOT_ATTESTED/u
  );
  assert.match(psContent, /GATEB_AUTH_PREFLIGHT_READY_WATCHDOG_REQUIRED/u);
  assert.match(psContent, /Get-LocalUser/u);
  assert.match(psContent, /GetAccessControl/u);
  assert.match(psContent, /Win32_UserProfile/u);
  assert.match(psContent, /Get-Service -Name 'seclogon'/u);
  assert.doesNotMatch(
    psContent,
    /^(?:\s*)(?:Set-LocalUser|Enable-LocalUser|Disable-LocalUser|Register-ScheduledTask|New-LocalUser|Remove-LocalUser|Remove-Item|Set-Acl|Start-Process)\s+-/gmu
  );
  assert.doesNotMatch(
    psContent,
    /Invoke-RestMethod|Invoke-WebRequest|Get-Clipboard|Set-Clipboard|Read-Host|ConvertFrom-SecureString|ConvertTo-SecureString/iu
  );
});

test(
  'Windows read-only actual preflight fails closed under nonadmin context',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const whoami = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true
    });
    // Automated tests never invoke a privileged administrative operation.
    if (/S-1-16-12288/u.test(whoami)) return;
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      ps,
      '-Mode',
      'Preflight'
    ];
    const result = spawnSync('powershell.exe', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    assert.equal(result.status, 3);
    assert.equal(
      result.stdout.trim(),
      'GATEB_AUTH_PREFLIGHT_DENIED_NO_MUTATION'
    );
  }
);

test(
  'Windows Apply route is unconditionally refused without side effects',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', ps, '-Mode', 'Apply'],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    assert.equal(result.status, 4);
    assert.equal(
      result.stdout.trim(),
      'GATEB_APPLY_BLOCKED_INDEPENDENT_RECOVERY_NOT_ATTESTED'
    );
  }
);
