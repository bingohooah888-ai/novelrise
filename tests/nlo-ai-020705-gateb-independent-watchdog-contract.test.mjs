import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideGateBWatchdogRecovery,
  simulateGateBWatchdogArm,
  simulateWatchdogCleanup,
  runLiveGateBWatchdog
} from '../scripts/nlo-ai-020705-gateb-independent-watchdog-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manager = join(
  root,
  'tools',
  'novelight-commander',
  'gateb-independent-watchdog-manager.ps1'
);
const worker = join(
  root,
  'tools',
  'novelight-commander',
  'gateb-recovery-watchdog-worker.ps1'
);
const repair = join(
  root,
  'tools',
  'novelight-commander',
  'gateb-watchdog-worker-one-shot-repair.ps1'
);
const msrc = readFileSync(manager, 'utf8');
const wsrc = readFileSync(worker, 'utf8');
const rsrc = readFileSync(repair, 'utf8');
const scope = {
  mode: 'OFFLINE_SIMULATE',
  host: 'DESKTOP-8Q4GFC8',
  account: 'NOVELIGHT-GateB',
  taskName: 'NOVELIGHT-GateB-Independent-Recovery'
};
const recovery = {
  ...scope,
  systemPrincipal: true,
  protectedAcl: true,
  sidMatches: true,
  phase: 'GUARDED_TEST',
  parentAlive: true,
  deadlineReached: false,
  enabled: true
};
const arm = {
  ...scope,
  initiallyDisabled: true,
  taskInitiallyAbsent: true,
  directoryInitiallyAbsent: true,
  approvedAttemptCount: 1,
  failStage: null
};
const cleanup = {
  ...scope,
  accountDisabled: true,
  guardOnlyPhase: true,
  taskActionPinned: true,
  workerHashPinned: true,
  unknownFilesPresent: false,
  approvalAttempts: 1
};
function checkNoLive(x) {
  assert.equal(x.simulated, true);
  for (const key of [
    'ownerApprovalSpent',
    'accountEnabled',
    'accountPasswordChanged',
    'systemTaskCreated',
    'realRecoveryDemonstrated',
    'realPatAccepted',
    'stagingAuthorized',
    'productionAuthorized',
    'gateBGo'
  ])
    assert.equal(x[key], false, key);
  assert.equal(x.actualWindowsMutations, 0);
  assert.equal(x.cloudMutations, 0);
  assert.equal(Object.isFrozen(x), true);
}
test('default and credential-like inputs are rejected without output leakage', () => {
  for (const value of [
    {},
    null,
    [],
    { ...recovery, token: 'mock' },
    { ...arm, password: 'mock' },
    { ...cleanup, secret: 'mock' },
    { ...recovery, mode: 'LIVE' }
  ]) {
    const outputs = [
      decideGateBWatchdogRecovery(value),
      simulateGateBWatchdogArm(value),
      simulateWatchdogCleanup(value)
    ];
    for (const o of outputs) {
      checkNoLive(o);
      assert.doesNotMatch(JSON.stringify(o), /mock/u);
    }
  }
});
test('system task with sealed SID can only request a scoped disable', () => {
  for (const change of [
    { phase: 'GUARD_ONLY' },
    { parentAlive: false },
    { deadlineReached: true }
  ]) {
    const o = decideGateBWatchdogRecovery({ ...recovery, ...change });
    checkNoLive(o);
    assert.equal(o.intent, 'DISABLE_ONLY_PINNED_SID');
  }
});
test('disabled user is verified without any mutation', () => {
  const o = decideGateBWatchdogRecovery({ ...recovery, enabled: false });
  checkNoLive(o);
  assert.equal(o.intent, 'READONLY_CENSUS');
});
test('live parent is monitored rather than granting any authority', () => {
  const o = decideGateBWatchdogRecovery(recovery);
  checkNoLive(o);
  assert.equal(o.intent, 'MONITOR_NEXT_TICK');
});
test('wrong principal / ACL / SID blocks the worker state machine', () => {
  for (const key of ['systemPrincipal', 'protectedAcl', 'sidMatches']) {
    const o = decideGateBWatchdogRecovery({ ...recovery, [key]: false });
    checkNoLive(o);
    assert.equal(o.status, 'BLOCK_UNTRUSTED_SYSTEM_BOUNDARY');
  }
});
test('foreign host account task or production ref do not widen scope', () => {
  for (const [key, value] of [
    ['host', 'OTHER-PC'],
    ['account', 'NLO'],
    ['taskName', 'other-task'],
    ['phase', 'PRODUCTION'],
    ['enabled', 'yes']
  ]) {
    const o = decideGateBWatchdogRecovery({ ...recovery, [key]: value });
    checkNoLive(o);
    assert.equal(o.intent, 'NONE');
  }
});
test('one-shot arm is purely modeled; no task or Windows mutation is made', () => {
  const o = simulateGateBWatchdogArm(arm);
  checkNoLive(o);
  assert.equal(o.stages.length, 8);
  assert.equal(o.status, 'OFFLINE_WATCHDOG_ARM_SEQUENCE_MODELED_NO_GO');
});
test('each of eight failure stages stops and requires reconciliation', () => {
  const phases = simulateGateBWatchdogArm(arm).stages;
  for (const stage of phases) {
    const o = simulateGateBWatchdogArm({ ...arm, failStage: stage });
    checkNoLive(o);
    assert.equal(o.intent, 'STOP_NO_AUTO_RETRY');
    assert.equal(o.stages.at(-1), stage);
  }
});
test('one-shot cannot replay or assume already configured OS state', () => {
  for (const change of [
    { initiallyDisabled: false },
    { taskInitiallyAbsent: false },
    { directoryInitiallyAbsent: false },
    { approvedAttemptCount: 2 },
    { approvedAttemptCount: 0 },
    { failStage: 'unknown' }
  ]) {
    const o = simulateGateBWatchdogArm({ ...arm, ...change });
    checkNoLive(o);
    assert.equal(o.status, 'BLOCK_PRECONDITIONS_OR_REPLAY');
  }
});
test('cleanup requires a disabled account and fixed owned task/files', () => {
  const o = simulateWatchdogCleanup(cleanup);
  checkNoLive(o);
  assert.equal(o.status, 'OFFLINE_OWNED_WATCHDOG_CLEANUP_MODELED_NO_GO');
  for (const change of [
    { accountDisabled: false },
    { guardOnlyPhase: false },
    { taskActionPinned: false },
    { workerHashPinned: false },
    { unknownFilesPresent: true },
    { approvalAttempts: 2 }
  ]) {
    const denied = simulateWatchdogCleanup({ ...cleanup, ...change });
    checkNoLive(denied);
    assert.equal(denied.intent, 'KEEP_GUARD');
  }
});
test('all live attempts from pure model are rejected', () => {
  assert.throws(runLiveGateBWatchdog, /NOT_AUTHORIZED/u);
});
test('case-insensitive PowerShell user object never overwrites pinned account name', () => {
  const name = wsrc.match(/^\$(\w+) = 'NOVELIGHT-GateB'$/mu)?.[1];
  assert.equal(name, 'TargetAccountName');
  assert.notEqual(name.toLowerCase(), 'account');
  assert.equal(
    (wsrc.match(/Get-LocalUser -Name \$TargetAccountName\b/gmu) || []).length,
    3
  );
  assert.doesNotMatch(wsrc, /Get-LocalUser -Name \$Account\b/iu);
  assert.match(wsrc, /^\$account = \$null$/mu);
});

test(
  'Windows name binding survives case-insensitive PowerShell variables',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const r = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$TargetAccountName='NOVELIGHT-GateB';$account=$null;" +
          "if($TargetAccountName -cne 'NOVELIGHT-GateB'){exit 3};exit 0"
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 5000 }
    );
    assert.equal(r.status, 0);
  }
);

test('worker source is SYSTEM/SID/ACL locked and never reads secrets', () => {
  assert.match(wsrc, /S-1-5-18/u);
  assert.match(wsrc, /GetAccessControl/u);
  assert.match(wsrc, /target-sid\.txt/u);
  assert.match(wsrc, /Disable-LocalUser -SID \$account\.SID/u);
  assert.match(wsrc, /WATCHDOG_PARENT_GONE/u);
  assert.match(wsrc, /WATCHDOG_DEADLINE/u);
  assert.match(wsrc, /WATCHDOG_GUARD_ONLY/u);
  assert.doesNotMatch(
    wsrc,
    /Set-LocalUser|Enable-LocalUser|Remove-LocalUser|Remove-Item|Invoke-RestMethod|Invoke-WebRequest|Get-Clipboard|Set-Clipboard|Read-Host|Get-Secret|Supabase|Cloudflare|Vercel/iu
  );
});
test('manager pins only one SYSTEM task and protects executable staging', () => {
  assert.match(msrc, /S-1-5-32-544/u);
  assert.match(msrc, /New-ScheduledTaskTrigger -AtStartup/u);
  assert.match(msrc, /New-ScheduledTaskTrigger -Once/u);
  assert.match(msrc, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/u);
  assert.match(msrc, /New-ScheduledTaskPrincipal -UserId 'SYSTEM'/u);
  assert.match(msrc, /Get-FileHash/u);
  assert.match(msrc, /TASK_SCHEDULER_UNAVAILABLE/u);
  assert.match(msrc, /PARENT_CONTENTS_CHANGED/u);
  assert.match(msrc, /UNEXPECTED_EXISTING_USER_PROFILE/u);
  assert.match(msrc, /SetAccessRuleProtection\(\$true,\$false\)/u);
  assert.match(msrc, /GUARD_ONLY/u);
  assert.match(msrc, /Test-Path -LiteralPath \$Root/u);
  assert.match(msrc, /GATEB_WATCHDOG_SAFE_STOP_MANUAL_RECONCILIATION/u);
  assert.doesNotMatch(
    msrc,
    /Enable-LocalUser|Set-LocalUser|Remove-LocalUser|New-LocalUser|Get-Clipboard|Read-Host|Supabase|Cloudflare|Vercel/iu
  );
});
test('fixed worker hash and repeated heartbeat are required before enabling', () => {
  const expected = msrc.match(/\$WorkerHash='([a-f0-9]{64})'/u)?.[1];
  assert.ok(expected);
  assert.equal(
    createHash('sha256').update(readFileSync(worker)).digest('hex'),
    expected
  );
  assert.match(wsrc, /sequence = \$sequence/u);
  assert.match(wsrc, /\$sequence = \$number \+ 1/u);
  assert.match(msrc, /\[int\]\$hb\.sequence -lt 2/u);
  assert.match(msrc, /REPEATED_SYSTEM_HEARTBEAT_UNVERIFIED/u);
});

test('owned cleanup stops only matching task and refuses existing profile', () => {
  assert.match(msrc, /PROFILE_STILL_PRESENT_NO_CLEANUP/u);
  assert.match(msrc, /Stop-ScheduledTask -TaskName \$TaskName/u);
  assert.match(msrc, /Unregister-ScheduledTask -TaskName \$TaskName/u);
  assert.ok(
    msrc.indexOf('Stop-ScheduledTask -TaskName $TaskName') <
      msrc.indexOf('Unregister-ScheduledTask -TaskName $TaskName')
  );
  assert.match(msrc, /UNKNOWN_FILES/u);
  assert.match(msrc, /\[IO\.Directory\]::Delete\(\$Root,\$false\)/u);
  assert.doesNotMatch(msrc, /Remove-Item.*-Recurse/iu);
});

test('one-shot repair pins old and corrected worker hashes and same task', () => {
  const oldHash = rsrc.match(/\$OldWorkerSha256 = '([a-f0-9]{64})'/u)?.[1];
  const newHash = rsrc.match(/\$NewWorkerSha256 = '([a-f0-9]{64})'/u)?.[1];
  assert.equal(
    oldHash,
    '766b91d8238572fcbbcefcc2edf825d0d32d29ae2e2bb6d9136845cc3bece5d5'
  );
  assert.equal(
    newHash,
    createHash('sha256').update(readFileSync(worker)).digest('hex')
  );
  assert.match(msrc, new RegExp(newHash, 'u'));
  assert.match(
    rsrc,
    /REPAIR_ONE_EXISTING_GATEB_WATCHDOG_WORKER_AND_RESTART_TASK/u
  );
  assert.match(rsrc, /NOVELIGHT-GateB-Independent-Recovery/u);
  assert.match(rsrc, /GUARD_ONLY/u);
  assert.match(rsrc, /INSTALLED_WORKER_NOT_OLD_PINNED_VERSION/u);
  assert.match(rsrc, /REPAIR_LEFTOVERS_EXIST/u);
});

test('repair cannot alter user accounts, create tasks or touch cloud', () => {
  assert.match(rsrc, /Disable-ScheduledTask -TaskName \$TaskName/u);
  assert.match(rsrc, /Enable-ScheduledTask -TaskName \$TaskName/u);
  assert.match(rsrc, /Start-ScheduledTask -TaskName \$TaskName/u);
  assert.match(
    rsrc,
    /\[IO\.File\]::Replace\(\$TemporaryWorker, \$InstalledWorker, \$BackupWorker\)/u
  );
  assert.match(rsrc, /SYSTEM_HEARTBEAT_NOT_ATTESTED/u);
  assert.match(
    rsrc,
    /GATEB_WATCHDOG_REPAIR_STOP_NO_RETRY_MANUAL_RECONCILIATION/u
  );
  assert.doesNotMatch(
    rsrc,
    /Enable-LocalUser|Set-LocalUser|Remove-LocalUser|New-LocalUser|Register-ScheduledTask|Unregister-ScheduledTask|Invoke-RestMethod|Invoke-WebRequest|Get-Clipboard|Set-Clipboard|Read-Host|Supabase|Cloudflare|Vercel/iu
  );
});

test(
  'Windows PowerShell parser sees all three scripts without syntax errors',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    for (const file of [manager, worker, repair]) {
      const quoted = file.replaceAll("'", "''");
      const command = [
        '$t=$null;$e=$null',
        '[void][Management.Automation.Language.Parser]::ParseFile(' +
          "'" +
          quoted +
          "',[ref]$t,[ref]$e)",
        'if(@($e).Count -ne 0){exit 4};exit 0'
      ].join(';');
      const r = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true, encoding: 'utf8', timeout: 5000 }
      );
      assert.equal(r.status, 0, file);
    }
  }
);
test(
  'Windows plan and worker inspect never register or disable',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const a = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', manager, '-Mode', 'Plan'],
      { windowsHide: true, encoding: 'utf8', timeout: 5000 }
    );
    assert.equal(a.status, 0);
    assert.equal(
      a.stdout.trim(),
      'GATEB_WATCHDOG_OFFLINE_PLAN_ONLY_NO_MUTATION'
    );
    const b = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', worker, '-Mode', 'Inspect'],
      { windowsHide: true, encoding: 'utf8', timeout: 5000 }
    );
    assert.equal(b.status, 2);
    assert.equal(b.stdout.trim(), 'GATEB_WATCHDOG_OFFLINE_INSPECT_ONLY');
  }
);
test(
  'Windows unprivileged repair Preflight safely refuses any task mutation',
  { skip: process.platform !== 'win32' },
  () => {
    const who = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (/S-1-16-12288/u.test(who)) return;
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', repair, '-Mode', 'Preflight'],
      { windowsHide: true, encoding: 'utf8', timeout: 7000 }
    );
    assert.equal(r.status, 3);
    assert.match(
      r.stdout,
      /GATEB_WATCHDOG_REPAIR_STOP_NO_RETRY_MANUAL_RECONCILIATION/u
    );
  }
);

test(
  'Windows non-admin preflight refuses admin-only task plan',
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
      ['-NoProfile', '-NonInteractive', '-File', manager, '-Mode', 'Preflight'],
      { windowsHide: true, encoding: 'utf8', timeout: 7000 }
    );
    assert.equal(r.status, 3);
    assert.match(r.stdout, /GATEB_WATCHDOG_SAFE_STOP_MANUAL_RECONCILIATION/u);
  }
);
