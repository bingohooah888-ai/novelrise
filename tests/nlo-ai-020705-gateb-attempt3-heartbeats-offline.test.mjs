import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'tools',
    'novelight-commander',
    'gateb-dpapi-attempt3-protected-upgrade-candidate.ps1'
  ),
  'utf8'
);
const start = src.indexOf('function Assert-ExistingTasks {');
const end = src.indexOf('function Prepare {', start);
assert.ok(start >= 0 && end > start);
const actualFunction = src.slice(start, end);

test(
  'actual protected-upgrade heartbeat guard accepts normal watchdog with no SID but pins rescue SID',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const program = [
      'Set-StrictMode -Version Latest',
      "$ErrorActionPreference='Stop'",
      "$script:Sid='S-1-5-21-7777777'",
      "$script:WatchdogTask='NOVELIGHT-GateB-Independent-Recovery'",
      "$script:RescueTask='NOVELIGHT-GateB-DPAPI-Independent-Rescue'",
      "$script:Root=Join-Path ([IO.Path]::GetTempPath()) ('gateb-hb-test-'+[guid]::NewGuid().ToString('N'))",
      '[IO.Directory]::CreateDirectory($Root) | Out-Null',
      'function Must([bool]$condition,[string]$code){if(-not $condition){throw $code}}',
      'function Leaf([string]$path){',
      "  if(-not $path.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw 'NOT_TEMP'}",
      "  if(-not [IO.File]::Exists($path)){throw 'MISSING_FIXTURE'}",
      '}',
      'function Get-ScheduledTask {',
      '  [CmdletBinding()]param([string]$TaskName,[string]$TaskPath)',
      "  if($TaskName -notin @($script:WatchdogTask,$script:RescueTask)){throw 'UNKNOWN_TASK'}",
      "  return [pscustomobject]@{State='Ready';Principal=[pscustomobject]@{UserId='SYSTEM'}}",
      '}',
      'function Get-ScheduledTaskInfo {',
      '  [CmdletBinding()]param([string]$TaskName,[string]$TaskPath)',
      '  return [pscustomobject]@{LastTaskResult=0}',
      '}',
      actualFunction,
      "foreach($case in @('normal_no_sid','rescue_wrong_sid','rescue_missing_sid','normal_bad_reason','rescue_bad_status','normal_stale')){",
      '  $now=[datetime]::UtcNow',
      '  $when=if($case -eq "normal_stale"){$now.AddMinutes(-10).ToString("o")}else{$now.ToString("o")}',
      "  $normal=[ordered]@{version=1;sequence=10;reasonCode='GUARD_ONLY';observedDisabled=$true;checkedUtc=$when}",
      "  $rescue=[ordered]@{version=1;sequence=10;status='IDLE_DISABLED';sid=$Sid;checkedUtc=$now.ToString('o')}",
      "  if($case -eq 'rescue_wrong_sid'){$rescue.sid='S-1-5-21-8888888'}",
      "  if($case -eq 'rescue_missing_sid'){$rescue.Remove('sid')}",
      "  if($case -eq 'normal_bad_reason'){$normal.reasonCode='PARENT_ALIVE'}",
      "  if($case -eq 'rescue_bad_status'){$rescue.status='RESCUE_FAIL'}",
      "  [IO.File]::WriteAllText((Join-Path $Root 'heartbeat.json'),($normal|ConvertTo-Json -Compress))",
      "  [IO.File]::WriteAllText((Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'),($rescue|ConvertTo-Json -Compress))",
      '  try{',
      '    Assert-ExistingTasks',
      "    'RESULT:'+$case+':PASS'",
      '  }catch{',
      '    $failure=[string]$_.Exception.Message',
      "    if($_.Exception.GetType().Name -eq 'PropertyNotFoundException'){$failure='MISSING_SID_BLOCKED'}",
      "    'RESULT:'+$case+':'+$failure",
      '  }',
      '}',
      '[IO.Directory]::Delete($Root,$true)'
    ].join('\n');
    const encoded = Buffer.from(program, 'utf16le').toString('base64');
    const run = spawnSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(run.status, 0, run.stderr);
    const rows = run.stdout
      .trim()
      .split(/\r?\n/u)
      .filter((s) => s.startsWith('RESULT:'));
    assert.deepEqual(rows, [
      'RESULT:normal_no_sid:PASS',
      'RESULT:rescue_wrong_sid:RESCUE_HEARTBEAT_SID_DRIFT',
      'RESULT:rescue_missing_sid:MISSING_SID_BLOCKED',
      'RESULT:normal_bad_reason:WATCHDOG_NOT_IDLE',
      'RESULT:rescue_bad_status:RESCUE_NOT_IDLE',
      'RESULT:normal_stale:HEARTBEAT_STALE'
    ]);
  }
);

test('read-only Preflight keeps permit/SID checks while returning a bounded error code', () => {
  assert.match(
    src,
    /Must \(\$hb\.sid -ceq \$Sid\) 'RESCUE_HEARTBEAT_SID_DRIFT'/u
  );
  assert.match(src, /if\(\$name -eq 'heartbeat\.json'\)\{/u);
  assert.doesNotMatch(
    src,
    /\$hb\.sid -ceq \$Sid -or \$name -eq 'heartbeat\.json'/u
  );
  assert.match(src, /GATEB_ATTEMPT3_PREFLIGHT_READONLY_NO_GO_CODE=/u);
  assert.match(src, /ValidateSet\('Plan','Preflight','Upgrade'\)/u);
});
