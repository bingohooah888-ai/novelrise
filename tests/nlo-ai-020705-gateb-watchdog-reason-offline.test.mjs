import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const worker = join(
  root,
  'tools',
  'novelight-commander',
  'gateb-recovery-reason-worker-candidate.ps1'
);
const source = readFileSync(worker, 'utf8');
const updater = join(
  root,
  'tools',
  'novelight-commander',
  'gateb-reason-worker-one-shot-update.ps1'
);
const updateSource = readFileSync(updater, 'utf8');

function runPurePowerShellFunctions() {
  const q = worker.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    '$tokens=$null;$errors=$null',
    "$ast=[Management.Automation.Language.Parser]::ParseFile('" +
      q +
      "',[ref]$tokens,[ref]$errors)",
    "if(@($errors).Count -ne 0){throw 'AST_INVALID'}",
    "$fn=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Resolve-WatchdogRecoveryReason','Resolve-WatchdogDisableOutcome')},$true))",
    "if($fn.Count -ne 2){throw 'PURE_FUNCTIONS_MISSING'}",
    'foreach($f in $fn){. ([ScriptBlock]::Create($f.Extent.Text))}',
    "$now=[DateTime]::Parse('2026-11-07T12:00:00Z').ToUniversalTime()",
    '$early=$now.AddMinutes(-1);$soon=$now.AddMinutes(2);$late=$now.AddMinutes(21)',
    '$reasonCases=@(' +
      "@($false,'GUARDED_TEST',$soon,$true)," +
      "@($true,'GUARD_ONLY',$soon,$false)," +
      "@($true,'GUARDED_TEST',$early,$false)," +
      "@($true,'GUARDED_TEST',$late,$true)," +
      "@($true,'GUARDED_TEST',$soon,$false)," +
      "@($true,'GUARDED_TEST',$soon,$true)," +
      "@($true,'UNKNOWN',$soon,$true)," +
      "@($true,'guard_only',$soon,$true))",
    'foreach($x in $reasonCases){' +
      '$v=Resolve-WatchdogRecoveryReason -StateValid ([bool]$x[0]) ' +
      '-Phase ([string]$x[1]) -DeadlineUtc ([datetime]$x[2]) ' +
      '-NowUtc $now -ParentIdentityMatches ([bool]$x[3]);' +
      "Write-Output ('REASON='+$v)}",
    '$outcomeCases=@(' +
      "@($false,$false,$false,$true,'GUARD_ONLY')," +
      "@($true,$true,$true,$true,'PARENT_GONE')," +
      "@($true,$true,$false,$true,'PARENT_GONE')," +
      "@($true,$true,$true,$false,'DEADLINE_EXPIRED')," +
      "@($true,$false,$false,$false,'PARENT_ALIVE')," +
      "@($true,$false,$false,$true,'GUARD_ONLY')," +
      "@($false,$true,$true,$true,'GUARD_ONLY')," +
      "@($true,$false,$false,$false,'PARENT_GONE'))",
    'foreach($x in $outcomeCases){' +
      '$v=Resolve-WatchdogDisableOutcome -WasEnabledBefore ([bool]$x[0]) ' +
      '-DisableAttempted ([bool]$x[1]) -DisableCommandSucceeded ([bool]$x[2]) ' +
      '-ObservedDisabled ([bool]$x[3]) -ReasonCode ([string]$x[4]);' +
      "Write-Output ('OUTCOME='+$v)}"
  ].join(';');
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', windowsHide: true, timeout: 12000 }
  );
}

test('default Inspect is offline-only and fixed SYSTEM/host/SID/ACL remain', () => {
  assert.match(source, /\[ValidateSet\('Inspect', 'Recover'\)\]/u);
  assert.match(source, /\[string\]\$Mode = 'Inspect'/u);
  assert.match(source, /GATEB_WATCHDOG_OFFLINE_INSPECT_ONLY/u);
  for (const signature of [
    'DESKTOP-8Q4GFC8',
    'NOVELIGHT-GateB',
    'S-1-5-18',
    'S-1-5-32-544',
    'target-sid.txt',
    'AreAccessRulesProtected',
    'MEMBER_MUST_BE_READONLY',
    'TARGET_SID_CHANGED'
  ])
    assert.ok(source.includes(signature), signature);
});
test('reason pure function has explicit priority without any side effects', () => {
  const fn = source.slice(
    source.indexOf('function Resolve-WatchdogRecoveryReason'),
    source.indexOf('function Resolve-WatchdogDisableOutcome')
  );
  for (const tag of [
    "'STATE_INVALID'",
    "'GUARD_ONLY'",
    "'DEADLINE_EXPIRED'",
    "'PARENT_GONE'",
    "'PARENT_ALIVE'"
  ])
    assert.ok(fn.includes(tag), tag);
  assert.doesNotMatch(
    fn,
    /Get-Process|Get-LocalUser|Disable-LocalUser|WriteAllText|ReadAllText|Stop-Process|Invoke-|Remove-|Start-ScheduledTask/iu
  );
});
test('disable outcome requires success and independent refreshed observation', () => {
  const fn = source.slice(
    source.indexOf('function Resolve-WatchdogDisableOutcome'),
    source.indexOf("if ($Mode -ne 'Recover')")
  );
  for (const tag of [
    "'ALREADY_DISABLED'",
    "'DISABLED_BY_WATCHDOG'",
    "'NOT_REQUIRED_PARENT_ALIVE'",
    "'DISABLE_UNCONFIRMED'"
  ])
    assert.ok(fn.includes(tag), tag);
  assert.match(fn, /\$DisableCommandSucceeded/u);
  assert.match(source, /TARGET_SID_CHANGED_DURING_RECOVERY/u);
  assert.match(source, /\$refreshedAccount = Get-LocalUser/u);
  assert.doesNotMatch(fn, /Disable-LocalUser|Get-LocalUser|Stop-Process/iu);
});
test('parent PID/start, UTC deadline and 20-minute safety bound persist', () => {
  assert.match(source, /Get-Process -Id \(\[int\]\$state\.parentPid\)/u);
  assert.match(
    source,
    /\$parent\.StartTime\.ToUniversalTime\(\)\.ToString\('o'\)/u
  );
  assert.match(source, /-ParentIdentityMatches \$parentIdentityMatches/u);
  assert.match(source, /-DeadlineUtc \$deadlineUtc/u);
  assert.match(source, /AddMinutes\(20\)/u);
});
test('heartbeat preserves schema v1 and adds separate reason/outcome only', () => {
  for (const field of [
    'version = 1',
    'sequence = $sequence',
    'status = $status',
    'reasonCode = $RecoveryReasonCode',
    'disableOutcome = $DisableOutcomeCode',
    'accountWasEnabledBefore = $WasEnabledAtTrust',
    'disableAttempted = $DisableInvoked',
    "checkedUtc = [DateTime]::UtcNow.ToString('o')",
    'observedDisabled = '
  ])
    assert.ok(source.includes(field), field);
});
test('at most one Disable-LocalUser call per worker invocation', () => {
  assert.equal(
    (source.match(/Disable-LocalUser -SID \$account\.SID/gmu) || []).length,
    2
  );
  assert.match(source, /-not \$DisableInvoked/u);
  assert.match(source, /\$DisableInvoked = \$true/u);
  assert.match(source, /\$DisableCommandSucceeded = \$true/u);
  assert.doesNotMatch(source, /^\$Account\s*=\s*['"]/mu);
});
test('no raw exception or credentials in output, no cross-service mutation', () => {
  const outputs = source
    .split('\n')
    .filter((line) => /^\s*Write-Output /u.test(line));
  assert.equal(outputs.length, 3);
  for (const line of outputs) {
    assert.doesNotMatch(line, /\$_|Password|Token|SID\.Value|Authorization/u);
  }
  assert.doesNotMatch(
    source,
    /Enable-LocalUser|Set-LocalUser|New-LocalUser|Remove-LocalUser|Remove-Item|Stop-Process|Start-ScheduledTask|Register-ScheduledTask|Unregister-ScheduledTask|Invoke-RestMethod|Invoke-WebRequest|Get-Clipboard|Set-Clipboard|Read-Host/iu
  );
});
test('trust and heartbeat failure remain fail-closed', () => {
  assert.match(source, /WATCHDOG_HEARTBEAT_UNCONFIRMED/u);
  assert.match(source, /WATCHDOG_RECOVERY_UNCONFIRMED/u);
  assert.match(source, /GATEB_WATCHDOG_RECOVERY_NOT_CONFIRMED/u);
  assert.match(source, /WriteAllText/u);
  assert.match(source, /GATEB_WATCHDOG_SYSTEM_OBSERVATION_RECORDED/u);
});
test(
  'isolated PowerShell AST functions: eight reason and eight outcome cases',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const r = runPurePowerShellFunctions();
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split(/\r?\n/u);
    assert.deepEqual(lines.slice(0, 8), [
      'REASON=STATE_INVALID',
      'REASON=GUARD_ONLY',
      'REASON=DEADLINE_EXPIRED',
      'REASON=STATE_INVALID',
      'REASON=PARENT_GONE',
      'REASON=PARENT_ALIVE',
      'REASON=STATE_INVALID',
      'REASON=STATE_INVALID'
    ]);
    assert.deepEqual(lines.slice(8), [
      'OUTCOME=ALREADY_DISABLED',
      'OUTCOME=DISABLED_BY_WATCHDOG',
      'OUTCOME=DISABLE_UNCONFIRMED',
      'OUTCOME=DISABLE_UNCONFIRMED',
      'OUTCOME=NOT_REQUIRED_PARENT_ALIVE',
      'OUTCOME=DISABLE_UNCONFIRMED',
      'OUTCOME=DISABLE_UNCONFIRMED',
      'OUTCOME=DISABLE_UNCONFIRMED'
    ]);
  }
);
test(
  'Inspect path never attempts Recover, independently of admin status',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', worker, '-Mode', 'Inspect'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    assert.equal(r.status, 2);
    assert.equal(r.stdout.trim(), 'GATEB_WATCHDOG_OFFLINE_INSPECT_ONLY');
  }
);

test('offline update pins exactly the installed old worker and candidate SHA', () => {
  const old = updateSource.match(/\$OldWorkerSha256 = '([a-f0-9]{64})'/u)?.[1];
  const next = updateSource.match(/\$NewWorkerSha256 = '([a-f0-9]{64})'/u)?.[1];
  assert.equal(
    old,
    'dd418a7a50854c54a182fd3042b8dfadd5b8da77f9c99d106aab4bd706c3e66f'
  );
  assert.equal(
    next,
    createHash('sha256').update(readFileSync(worker)).digest('hex')
  );
  assert.match(updateSource, /gateb-recovery-reason-worker-candidate\.ps1/u);
  assert.match(
    updateSource,
    /UPDATE_ONE_EXISTING_GATEB_REASON_WORKER_GUARD_ONLY/u
  );
});
test('one-shot updater requires a fixed GUARD_ONLY SYSTEM task, protected ACL and stable 7-day schedule', () => {
  for (const required of [
    'NOVELIGHT-GateB-Independent-Recovery',
    'GUARD_ONLY',
    'ServiceAccount',
    'Assert-ProtectedFolder',
    'Get-ScheduledTaskInfo',
    'TASK_ACTION_DRIFT',
    'TASK_TRIGGERS_NOT_PINNED',
    'WATCHDOG_SCHEDULE_EXPIRING_OR_CHANGED',
    'GUARD_ONLY_HEARTBEAT_UNVERIFIED',
    'UNEXPECTED_FILES',
    'USER_PROFILE_PRESENT',
    'ReadAndExecute',
    'target-sid.txt',
    'LastTaskResult',
    'TotalDays -ne 7',
    'TotalSeconds -ne 60'
  ])
    assert.ok(updateSource.includes(required), required);
});
test('one-shot update stops only existing task, performs atomic backup swap and checks new reason evidence', () => {
  assert.match(updateSource, /Disable-ScheduledTask -TaskName \$TaskName/u);
  assert.match(updateSource, /Stop-ScheduledTask -TaskName \$TaskName/u);
  assert.match(updateSource, /Enable-ScheduledTask -TaskName \$TaskName/u);
  assert.match(updateSource, /Start-ScheduledTask -TaskName \$TaskName/u);
  assert.match(
    updateSource,
    /\[IO\.File\]::Replace\(\$TemporaryWorker, \$InstalledWorker, \$BackupWorker\)/u
  );
  for (const proof of [
    'reasonCode',
    'disableOutcome',
    'accountWasEnabledBefore',
    'disableAttempted',
    'PriorHeartbeatSequence',
    'PriorHeartbeatUtc',
    'ALREADY_DISABLED',
    'GATEB_REASON_WORKER_UPDATED_GUARD_ONLY_HEARTBEAT_PASS',
    'GATEB_REASON_WORKER_STOP_NO_RETRY_MANUAL_RECONCILIATION'
  ])
    assert.ok(updateSource.includes(proof), proof);
  assert.doesNotMatch(
    updateSource,
    /Enable-LocalUser|Set-LocalUser|New-LocalUser|Remove-LocalUser|Register-ScheduledTask|Unregister-ScheduledTask|Stop-Process|Remove-Item|Invoke-RestMethod|Invoke-WebRequest|Read-Host|Get-Clipboard/iu
  );
});
test(
  'updater script parses but offline suite never invokes Apply',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const q = updater.replaceAll("'", "''");
    const command =
      "$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile('" +
      q +
      "',[ref]$t,[ref]$e);if(@($e).Count -gt 0){exit 4};exit 0";
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    assert.equal(r.status, 0, r.stderr);
  }
);
test(
  'updater Preflight fails closed without elevation',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', updater, '-Mode', 'Preflight'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    assert.equal(r.status, 3);
    assert.match(
      r.stdout,
      /GATEB_REASON_WORKER_STOP_NO_RETRY_MANUAL_RECONCILIATION/u
    );
  }
);
