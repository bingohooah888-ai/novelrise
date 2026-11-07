import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGES,
  assessDisabledGuardBaseline,
  simulateOneShotParentGone,
  assessFinalResidue,
  startLiveParentGoneTest
} from '../scripts/nlo-ai-020705-gateb-parentgone-offline-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ps = join(
  root,
  'tools',
  'novelight-commander',
  'gateb-parentgone-synthetic-one-shot.ps1'
);
const code = readFileSync(ps, 'utf8');
const scope = {
  mode: 'OFFLINE_ONLY',
  host: 'DESKTOP-8Q4GFC8',
  user: 'NOVELIGHT-GateB',
  task: 'NOVELIGHT-GateB-Independent-Recovery',
  workerSha256:
    '78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
};
const baseline = Object.freeze({
  ...scope,
  accountDisabled: true,
  nonAdmin: true,
  profileAbsent: true,
  vaultEmpty: true,
  taskSystem: true,
  taskActionPinned: true,
  taskLastExitZero: true,
  taskReady: true,
  taskScheduleMinutesRemaining: 480,
  aclPinned: true,
  sidPinned: true,
  guardOnly: true,
  heartbeatFreshSeconds: 25,
  heartbeatSequence: 8,
  heartbeatReasonGuardOnly: true,
  heartbeatOutcomeAlreadyDisabled: true,
  knownFilesOnly: true,
  noPriorLedger: true,
  nloUnchanged: true
});
const trial = Object.freeze({
  ...scope,
  accountDisabled: true,
  approvalAttempts: 1,
  oneShotLedgerAvailable: true,
  syntheticPidAbsent: true,
  originalGuardHashPinned: true,
  parentReasonObserved: true,
  parentOutcomeAlreadyDisabled: true,
  guardAtomicRestoreVerified: true,
  guardHeartbeatAfterParentReason: true,
  userStillDisabled: true,
  childProcessesAbsent: true,
  profileAbsent: true,
  vaultEmpty: true,
  temporaryFilesAbsent: true,
  ledgerRetained: true,
  nloUnchanged: true,
  failAt: null
});
const census = Object.freeze({
  ...scope,
  accountDisabled: true,
  guardRestoredSameHash: true,
  guardOnly: true,
  workerHashPinned: true,
  taskDefinitionUnchanged: true,
  heartbeatSequenceIncreased: true,
  newGuardHeartbeatFresh: true,
  reasonCodeGuardOnly: true,
  disableOutcomeAlreadyDisabled: true,
  profileAbsent: true,
  childProcessesAbsent: true,
  vaultEmpty: true,
  temporaryFilesAbsent: true,
  oneShotLedgerRetained: true,
  nloUnchanged: true
});
function noAuthority(r) {
  assert.equal(r.offlineOnly, true);
  assert.equal(r.authorized, false);
  for (const key of [
    'realOsMutation',
    'accountEnabled',
    'passwordReset',
    'parentKilled',
    'childKilled',
    'dpapiTested',
    'stateWritten',
    'taskChanged',
    'secretsUsed',
    'gateBComplete'
  ])
    assert.equal(r[key], false, key);
  assert.equal(r.gatesAtoEPassed, 0);
  assert.equal(r.cloudMutations, 0);
  assert.equal(r.paidModelCalls, 0);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.stages));
  assert.equal('secret' in r, false);
}
test('all omitted inputs fail closed and never confer live authority', () => {
  for (const fn of [
    assessDisabledGuardBaseline,
    simulateOneShotParentGone,
    assessFinalResidue
  ])
    noAuthority(fn());
});
test('unexpected fields, credentials, or command injection cannot be accepted or echoed', () => {
  for (const [fn, valid] of [
    [assessDisabledGuardBaseline, baseline],
    [simulateOneShotParentGone, trial],
    [assessFinalResidue, census]
  ]) {
    for (const patch of [
      { pat: 'synthetic-private-value' },
      { jwt: 'synthetic-private-value' },
      { password: 'synthetic-private-value' },
      { command: 'Enable-LocalUser' }
    ]) {
      const r = fn({ ...valid, ...patch });
      noAuthority(r);
      assert.equal(r.status, 'BLOCK_OFFLINE_INPUT');
      assert.doesNotMatch(JSON.stringify(r), /synthetic-private-value/u);
    }
  }
});
test('every API rejects non-fixed host, account, task and worker', () => {
  for (const [fn, valid] of [
    [assessDisabledGuardBaseline, baseline],
    [simulateOneShotParentGone, trial],
    [assessFinalResidue, census]
  ]) {
    for (const [key, value] of [
      ['host', 'OTHER_PC'],
      ['user', 'ANOTHER_USER'],
      ['task', 'ANOTHER_TASK'],
      ['workerSha256', 'not-pinned']
    ]) {
      const r = fn({ ...valid, [key]: value });
      noAuthority(r);
      assert.equal(r.status, 'BLOCK_FIXED_TARGET');
    }
  }
});
test('healthy GUARD_ONLY read-only baseline remains NO-GO', () => {
  const r = assessDisabledGuardBaseline(baseline);
  noAuthority(r);
  assert.equal(r.status, 'OFFLINE_GUARD_BASELINE_MATCH_NO_GO');
});
test('heartbeat freshness, sequence and 7-day scheduler expiry block', () => {
  for (const patch of [
    { heartbeatFreshSeconds: 151 },
    { heartbeatFreshSeconds: -1 },
    { heartbeatFreshSeconds: Number.NaN },
    { heartbeatSequence: 1 },
    { taskScheduleMinutesRemaining: 30 },
    { taskScheduleMinutesRemaining: Number.POSITIVE_INFINITY }
  ]) {
    const r = assessDisabledGuardBaseline({ ...baseline, ...patch });
    noAuthority(r);
    assert.equal(r.status, 'BLOCK_STALE_HEARTBEAT_OR_EXPIRING_SCHEDULE');
  }
});
test('disabled/non-admin, pinned task/ACL/SID and durable one-shot marker are mandatory', () => {
  for (const key of [
    'accountDisabled',
    'nonAdmin',
    'profileAbsent',
    'vaultEmpty',
    'taskSystem',
    'taskActionPinned',
    'taskLastExitZero',
    'taskReady',
    'aclPinned',
    'sidPinned',
    'guardOnly',
    'heartbeatReasonGuardOnly',
    'heartbeatOutcomeAlreadyDisabled',
    'knownFilesOnly',
    'noPriorLedger',
    'nloUnchanged'
  ]) {
    const r = assessDisabledGuardBaseline({ ...baseline, [key]: false });
    noAuthority(r);
    assert.equal(r.status, 'BLOCK_TRUST_OR_ONE_SHOT_PRECONDITION', key);
  }
});
test('mocked complete parent-gone and atomic restore STILL cannot open Gate B', () => {
  const r = simulateOneShotParentGone(trial);
  noAuthority(r);
  assert.equal(
    r.status,
    'OFFLINE_PARENT_GONE_BRANCH_AND_RESTORE_SIMULATED_NO_GO'
  );
  assert.deepEqual(r.stages, STAGES);
});
for (const stage of STAGES) {
  test(
    'fault injection at ' + stage + ' consumes attempt, never authorizes retry',
    () => {
      const r = simulateOneShotParentGone({ ...trial, failAt: stage });
      noAuthority(r);
      assert.equal(
        r.status,
        'OFFLINE_INJECTED_FAILURE_CONSUMED_MANUAL_CENSUS_NO_GO'
      );
      assert.equal(r.stages.at(-1), stage);
    }
  );
}
test('new approval is a single attempt, and fake parent PID must be absent', () => {
  for (const patch of [
    { approvalAttempts: 0 },
    { approvalAttempts: 2 },
    { oneShotLedgerAvailable: false },
    { syntheticPidAbsent: false },
    { accountDisabled: false },
    { originalGuardHashPinned: false }
  ]) {
    const r = simulateOneShotParentGone({ ...trial, ...patch });
    noAuthority(r);
    assert.equal(r.status, 'BLOCK_REPLAY_OR_PARENT_PID_OR_GUARD');
  }
});
test('PARENT_GONE needs independently observed reason AND already-disabled outcome', () => {
  for (const patch of [
    { parentReasonObserved: false },
    { parentOutcomeAlreadyDisabled: false }
  ]) {
    const r = simulateOneShotParentGone({ ...trial, ...patch });
    noAuthority(r);
    assert.equal(r.status, 'BLOCK_PARENT_GONE_REASON_NOT_PROVEN_NO_GO');
  }
});
test('GUARD_ONLY atomic restore and newer guard heartbeat are separate gates', () => {
  const a = simulateOneShotParentGone({
    ...trial,
    guardAtomicRestoreVerified: false
  });
  const b = simulateOneShotParentGone({
    ...trial,
    guardHeartbeatAfterParentReason: false
  });
  noAuthority(a);
  noAuthority(b);
  assert.equal(a.status, 'BLOCK_GUARD_RESTORE_NOT_PROVEN_NO_GO');
  assert.equal(b.status, 'BLOCK_FRESH_GUARD_WITNESS_MISSING_NO_GO');
});
test('account disabling does not prove child process and user profile zero', () => {
  for (const patch of [
    { userStillDisabled: false },
    { childProcessesAbsent: false },
    { profileAbsent: false }
  ]) {
    const r = simulateOneShotParentGone({ ...trial, ...patch });
    noAuthority(r);
    assert.equal(r.status, 'BLOCK_ACCOUNT_PROCESS_PROFILE_RESIDUE_NO_GO');
  }
});
test('temporary residues, vault contents and durable ledger block success', () => {
  for (const patch of [
    { temporaryFilesAbsent: false },
    { vaultEmpty: false },
    { ledgerRetained: false }
  ]) {
    const r = simulateOneShotParentGone({ ...trial, ...patch });
    noAuthority(r);
    assert.equal(r.status, 'BLOCK_TEMP_RESIDUE_OR_LEDGER_UNVERIFIED_NO_GO');
  }
});
test('other NLO task definitions must remain unchanged', () => {
  const r = simulateOneShotParentGone({ ...trial, nloUnchanged: false });
  noAuthority(r);
  assert.equal(r.status, 'BLOCK_NLO_CHANGE_NO_GO');
});
test('final zero-residue census requires every dimension, but is still offline', () => {
  noAuthority(assessFinalResidue(census));
  assert.equal(
    assessFinalResidue(census).status,
    'OFFLINE_FINAL_CENSUS_CONTRACT_MATCH_NO_GO'
  );
  for (const key of Object.keys(census).slice(5)) {
    const r = assessFinalResidue({ ...census, [key]: false });
    noAuthority(r);
    assert.equal(r.status, 'BLOCK_CENSUS_NOT_ZERO_NO_GO', key);
  }
});
test('real OS executor deliberately absent from JavaScript', () => {
  assert.throws(startLiveParentGoneTest, /NOT_AUTHORIZED/u);
});
test('future PowerShell is default read-only, requires exact OWNER approval', () => {
  assert.match(code, /\[ValidateSet\('Preflight', 'Apply'\)\]/u);
  assert.match(code, /\$Mode = 'Preflight'/u);
  assert.match(code, /ONE_DISABLED_GATEB_SYNTHETIC_PARENT_GONE_STATE_TRIAL/u);
  assert.match(code, /GATEB_PARENTGONE_PREFLIGHT_READY_NO_MUTATION/u);
  assert.match(code, /GATEB_PARENTGONE_APPLY_CONSUMED_NO_RETRY/u);
});
test('scope is only one protected state, with atomic Replace twice and durable marker', () => {
  assert.match(code, /parentgone-once-consumed\.marker/u);
  assert.match(
    code,
    /\[IO\.File\]::Open\(\$Ledger,'CreateNew','Write','None'\)/u
  );
  assert.match(
    code,
    /\[IO\.File\]::Replace\(\$ArmStage,\$StatePath,\$OriginalBackup\)/u
  );
  assert.match(
    code,
    /\[IO\.File\]::Replace\(\$RestoreStage,\$StatePath,\$GuardedBackup\)/u
  );
  assert.match(code, /UNKNOWN_STATE_MUST_NOT_OVERWRITE/u);
  assert.match(code, /ORIGINAL_GUARD_NOT_RESTORED/u);
  assert.match(code, /TEMPORARY_FILE_RESIDUE/u);
});
test('fake parent PID never kills or starts a real process', () => {
  assert.match(code, /\$FakePid = \[int\]::MaxValue/u);
  assert.match(code, /SYNTHETIC_PID_ALREADY_OCCUPIED/u);
  assert.match(code, /phase = 'GUARDED_TEST'/u);
  assert.match(code, /AddMinutes\(5\)/u);
  assert.match(code, /reason 'PARENT_GONE'/u);
  assert.match(code, /reason 'GUARD_ONLY'/u);
  assert.doesNotMatch(
    code,
    /Enable-LocalUser|Disable-LocalUser|Set-LocalUser|New-LocalUser|Remove-LocalUser|Stop-Process|Start-Process|Start-ScheduledTask|Stop-ScheduledTask|Register-ScheduledTask|Unregister-ScheduledTask|Disable-ScheduledTask|Enable-ScheduledTask|Invoke-WebRequest|Invoke-RestMethod|CryptProtectData|Unprotect|Read-Host|Get-Clipboard/iu
  );
});
test('preflight verifies protected ACL, target process census, scheduling and guard', () => {
  for (const token of [
    'AreAccessRulesProtected',
    'ReadAndExecute',
    'GetOwnerSid',
    'Get-CimInstance Win32_UserProfile',
    'Win32_Process',
    'target-sid.txt',
    'ServiceAccount',
    'TimeTrigger',
    'BootTrigger',
    'LastTaskResult',
    'OriginalHash',
    'Read-Heartbeat',
    'GUARD_ONLY',
    'ALREADY_DISABLED',
    'GATEB_VAULT_NOT_EMPTY'
  ])
    assert.ok(code.includes(token), token);
});
test('no secret payload, exception message, SID or token is printed', () => {
  const outputLines = code
    .split(/\r?\n/u)
    .filter((line) => /^\s*Write-Output /u.test(line));
  assert.ok(outputLines.length >= 4);
  for (const line of outputLines) {
    assert.doesNotMatch(
      line,
      /\$_|Exception\.Message|Token|Password|Authorization|UserSid|Sid\.Value/u
    );
  }
});
test(
  'Windows PowerShell AST parses one-shot candidate without executing Apply',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const command = [
      '$t=$null;$e=$null',
      "[void][Management.Automation.Language.Parser]::ParseFile('" +
        ps.replaceAll("'", "''") +
        "',[ref]$t,[ref]$e)",
      'if(@($e).Count -gt 0){exit 3};exit 0'
    ].join(';');
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', windowsHide: true, timeout: 6000 }
    );
    assert.equal(r.status, 0, r.stderr);
  }
);
test(
  'Windows isolated-temp atomic Replace twice restores exact baseline without OS changes',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'gateb-parentgone-mock-'));
    const path = join(dir, 'state.json');
    const arm = join(dir, 'arm-stage');
    const original = join(dir, 'original');
    const restored = join(dir, 'restore-stage');
    const guarded = join(dir, 'guarded-backup');
    const baselineJson = '{"phase":"GUARD_ONLY","parentPid":0}';
    const armedJson = '{"phase":"GUARDED_TEST","parentPid":2147483647}';
    try {
      writeFileSync(path, baselineJson);
      writeFileSync(arm, armedJson);
      const quote = (v) => "'" + v.replaceAll("'", "''") + "'";
      const cmd = [
        '[IO.File]::Replace(' +
          quote(arm) +
          ',' +
          quote(path) +
          ',' +
          quote(original) +
          ')',
        '[IO.File]::Copy(' +
          quote(original) +
          ',' +
          quote(restored) +
          ',$false)',
        '[IO.File]::Replace(' +
          quote(restored) +
          ',' +
          quote(path) +
          ',' +
          quote(guarded) +
          ')'
      ].join(';');
      const r = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', cmd],
        { encoding: 'utf8', windowsHide: true, timeout: 7000 }
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(path, 'utf8'), baselineJson);
      assert.equal(readFileSync(original, 'utf8'), baselineJson);
      assert.equal(readFileSync(guarded, 'utf8'), armedJson);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'non-admin Windows Preflight fails closed with no file changes',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const who = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 6000
    });
    if (/S-1-16-12288/u.test(who)) return;
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', ps, '-Mode', 'Preflight'],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 }
    );
    assert.equal(r.status, 3);
    assert.match(r.stdout, /GATEB_PARENTGONE_APPLY_NOT_STARTED/u);
  }
);
