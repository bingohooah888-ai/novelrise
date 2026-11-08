import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tools',
  'novelight-commander'
);
const read = (n) => readFileSync(join(dir, n), 'utf8');
const coord = read('gateb-dpapi-attempt4-one-shot-coordinator-candidate.ps1');
const rescue = read('gateb-dpapi-attempt4-system-rescue-candidate.ps1');
const permit = read('gateb-dpapi-attempt4-approval-contract-candidate.ps1');
const upgrade = read('gateb-dpapi-attempt4-protected-upgrade-candidate.ps1');

test('fourth scope is disjoint from spent attempt-1 and attempt-2 ledger', () => {
  for (const s of [coord, rescue]) {
    assert.match(s, /gateb-dpapi-attempt4-once-consumed\.marker/u);
    assert.match(s, /state\.json\.dpapi-attempt4-original/u);
    assert.match(s, /gateb-dpapi-attempt4-arm-manifest\.json/u);
    assert.doesNotMatch(s, /Remove-Item|Delete-Item|File\]::Delete/u);
  }
  assert.match(coord, /gateb-dpapi-one-shot-consumed\.marker/u);
  assert.match(coord, /gateb-dpapi-attempt2-once-consumed\.marker/u);
  assert.match(coord, /ATTEMPT2_SPENT_EVIDENCE_DRIFT/u);
  assert.match(coord, /ATTEMPT4_ALREADY_CONSUMED_OR_PARTIAL/u);
  assert.match(
    rescue,
    /gateb-dpapi-attempt4-system-rescue-first-failure\.json/u
  );
});
test('fourth owner permit is version 4, exact attempt and requires all four file hashes', () => {
  assert.match(permit, /\$approval.version -ne 4/u);
  assert.match(permit, /GATEB_DPAPI_ATTEMPT4_OWNER_APPROVED/u);
  assert.match(permit, /GATEB_DPAPI_ATTEMPT4_20261108/u);
  assert.match(permit, /INSTALLED_FILE_SHA_DRIFT/u);
  assert.match(permit, /OWNER_PERMIT_NOT_FRESH/u);
  assert.match(
    upgrade,
    /version=4;approvalId='GATEB_DPAPI_ATTEMPT4_OWNER_APPROVED'/u
  );
  assert.match(
    upgrade,
    /maxApply=1;maxEnabledSeconds=240;maxGuardSeconds=300/u
  );
  assert.match(upgrade, /ExpectedInstallerSha256/u);
  assert.match(upgrade, /ExpectedOldCoordinatorSha256/u);
  assert.match(upgrade, /ExpectedNewRescueSha256/u);
});
test('fourth independent rescue preserves hash-bound restore and first failure receipt', () => {
  assert.match(rescue, /function Get-RescueScope/u);
  assert.match(rescue, /function Confirm-ScopeExpiredOrParentDead/u);
  assert.match(rescue, /function Assert-NoLiveTargetResources/u);
  assert.match(rescue, /function Invoke-IndependentSystemGuardRestore/u);
  assert.match(rescue, /File\]::Replace\(\$temp,\$State/u);
  assert.match(rescue, /TARGET_PROFILE_LOADED_OR_UNVERIFIED/u);
  assert.match(rescue, /LOGON_SESSION_RESIDUE/u);
  assert.match(rescue, /FileMode\]::CreateNew/u);
  assert.match(rescue, /PARENT_ALIVE_NO_RESTORE/u);
});
test('fourth protected upgrade consumes a new install ledger and cannot mutate in Plan', () => {
  assert.match(
    upgrade,
    /gateb-dpapi-attempt4-protected-upgrade-once-consumed\.marker/u
  );
  assert.match(upgrade, /function Prepare/u);
  assert.match(upgrade, /function AtomicUpdate/u);
  assert.match(upgrade, /PREEXISTING_STAGE_OR_BACKUP/u);
  assert.match(upgrade, /BACKUP_SHA_CHANGED/u);
  assert.match(upgrade, /NEW_SYSTEM_RESCUE_HEARTBEAT_MISSING/u);
  assert.match(upgrade, /NEW_OWNER_APPROVAL_REQUIRED/u);
  assert.match(upgrade, /ValidateSet\('Plan','Preflight','Upgrade'\)/u);
  assert.match(upgrade, /GATEB_ATTEMPT4_PREFLIGHT_READONLY_PASS/u);
  assert.match(upgrade, /NO_RETRY_NO_AUTOMATIC_ROLLBACK/u);
  assert.doesNotMatch(
    upgrade,
    /Enable-LocalUser|Disable-LocalUser|Set-LocalUser|Register-ScheduledTask|Remove-Item|Remove-ScheduledTask/u
  );
});
test(
  'Plan and absent approval fail closed without invoking protected Windows operations',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const script = join(
      dir,
      'gateb-dpapi-attempt4-protected-upgrade-candidate.ps1'
    );
    for (const [mode, marker, exit] of [
      ['Plan', 'GATEB_ATTEMPT4_SOURCE_ONLY_NO_WINDOWS_CHANGES', 0],
      ['Preflight', 'GATEB_ATTEMPT4_PREFLIGHT_READONLY_NO_GO', 3],
      ['Upgrade', 'GATEB_ATTEMPT4_NEW_OWNER_APPROVAL_REQUIRED', 4]
    ]) {
      const run = spawnSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-File',
          script,
          '-Mode',
          mode
        ],
        { encoding: 'utf8', timeout: 10000 }
      );
      assert.equal(run.status, exit, run.stderr);
      assert.match(run.stdout, new RegExp(marker, 'u'));
    }
  }
);
test(
  'actual attempt-4 SYSTEM restore functions operate on isolated TEMP only',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const extract = (a, b) =>
      rescue.slice(rescue.indexOf(a), rescue.indexOf(b, rescue.indexOf(a)));
    const scope = extract(
      'function Get-RescueScope {',
      'function Confirm-ScopeExpiredOrParentDead('
    ).replace(
      /if\(\$env:COMPUTERNAME -cne \$HostPin -or\s+\[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.User\.Value -cne \$SystemSid\)\{\s+throw 'SYSTEM_HOST_REQUIRED'\s+\}/u,
      "if(-not $Root.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw 'FIXTURE_ONLY'}"
    );
    const parts = [
      extract('function Assert-PinnedLeaf(', 'function Assert-PinnedRoot'),
      scope,
      extract(
        'function Confirm-ScopeExpiredOrParentDead(',
        'function Assert-NoLiveTargetResources {'
      ),
      extract(
        'function Assert-NoLiveTargetResources {',
        'function Invoke-IndependentSystemGuardRestore {'
      ),
      extract(
        'function Invoke-IndependentSystemGuardRestore {',
        'function Write-RescueHeartbeat('
      ),
      extract(
        'function Write-RescueHeartbeat(',
        'function Invoke-AuthorizedSystemRecovery {'
      )
    ];
    const program = [
      'Set-StrictMode -Version Latest',
      "$ErrorActionPreference='Stop'",
      "$script:HostPin='DESKTOP-8Q4GFC8'",
      "$script:Account='NOVELIGHT-GateB'",
      "$script:TaskName='NOVELIGHT-GateB-Independent-Recovery'",
      "$script:Sid='S-1-5-21-7777777'",
      "$script:Stage='TEST'",
      'function Assert-PinnedRoot {',
      "  if(-not $Root.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw 'NOT_TEMP'}",
      '}',
      'function Get-LocalUser { [CmdletBinding()]param([string]$Name) return [pscustomobject]@{SID=[pscustomobject]@{Value=$script:Sid};Enabled=$false} }',
      'function Get-CimInstance {',
      '  [CmdletBinding()]param([Parameter(Position=0)][string]$ClassName,[string]$Filter)',
      '  switch($ClassName){',
      "    'Win32_UserAccount' {return [pscustomobject]@{SID=$script:Sid}}",
      "    'Win32_UserProfile' {return}",
      "    'Win32_Process' {return [pscustomobject]@{ProcessId=777}}",
      "    default {throw 'UNEXPECTED_CIM'}",
      '  }',
      '}',
      'function Get-CimAssociatedInstance { [CmdletBinding()]param($InputObject,[string]$Association,[string]$ResultClassName) }',
      "function Invoke-CimMethod { [CmdletBinding()]param($InputObject,[string]$MethodName) return [pscustomobject]@{ReturnValue=2;Sid=''} }",
      'function Get-Process {',
      '  [CmdletBinding()]param([int]$Id)',
      "  if($script:Case -eq 'dead'){throw 'MISSING_PARENT'}",
      '  return [pscustomobject]@{StartTime=$script:ParentStart}',
      '}',
      ...parts,
      "foreach($case in @('expired','dead','alive','corrupt')){",
      '  $script:Case=$case',
      "  $script:Root=Join-Path ([IO.Path]::GetTempPath()) ('gateb-attempt4-'+[guid]::NewGuid().ToString('N'))",
      '  $null=[IO.Directory]::CreateDirectory($Root)',
      "  $script:State=Join-Path $Root 'state.json'",
      "  $script:Original=Join-Path $Root 'state.json.dpapi-attempt4-original'",
      "  $script:Manifest=Join-Path $Root 'gateb-dpapi-attempt4-arm-manifest.json'",
      "  $script:Marker=Join-Path $Root 'gateb-dpapi-attempt4-once-consumed.marker'",
      '  $script:ParentStart=[datetime]::UtcNow.AddMinutes(-2)',
      "  $startUtc=$ParentStart.ToString('o')",
      "  $deadline=if($case -in @('expired','corrupt')){[datetime]::UtcNow.AddMinutes(-1).ToString('o')}else{[datetime]::UtcNow.AddMinutes(1).ToString('o')}",
      "  $saved=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;phase='GUARD_ONLY';deadlineUtc=$null;parentPid=0;parentStartUtc=$null}",
      "  $guard=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;phase='GUARDED_TEST';deadlineUtc=$deadline;parentPid=777;parentStartUtc=$startUtc}",
      '  [IO.File]::WriteAllText($Original,($saved|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      '  [IO.File]::WriteAllText($State,($guard|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      '  $originalSha=(Get-FileHash $Original -Algorithm SHA256).Hash.ToLowerInvariant()',
      '  $guardSha=(Get-FileHash $State -Algorithm SHA256).Hash.ToLowerInvariant()',
      '  $m=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;originalSha256=$originalSha;guardedSha256=$guardSha;parentPid=777;parentStartUtc=$startUtc;deadlineUtc=$deadline}',
      '  [IO.File]::WriteAllText($Manifest,($m|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      "  [IO.File]::WriteAllText($Marker,'SPENT',[Text.Encoding]::UTF8)",
      "  if($case -eq 'corrupt'){[IO.File]::AppendAllText($State,' ')}",
      '  try {',
      '    Invoke-IndependentSystemGuardRestore',
      "    Write-RescueHeartbeat 'RESTORED_GUARD_ONLY'",
      "    Write-RescueHeartbeat 'IDLE_DISABLED'",
      "    if((Get-FileHash $State -Algorithm SHA256).Hash.ToLowerInvariant() -cne $originalSha){throw 'SHA_NOT_RESTORED'}",
      "    if(-not [IO.File]::Exists((Join-Path $Root 'state.json.dpapi-attempt4-rescue-backup'))){throw 'BACKUP_MISSING'}",
      "    if(-not [IO.File]::Exists((Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.previous.json'))){throw 'HEARTBEAT_BACKUP_MISSING'}",
      "    if([IO.File]::ReadAllText($Marker) -cne 'SPENT'){throw 'MARKER_CHANGED'}",
      "    'RESULT:'+$case+':PASS'",
      '  }catch{',
      "    if((ConvertFrom-Json ([IO.File]::ReadAllText($State))).phase -cne 'GUARDED_TEST'){throw 'INVALID_FAILURE_STATE'}",
      "    if([IO.File]::ReadAllText($Marker) -cne 'SPENT'){throw 'INVALID_FAILURE_MARKER'}",
      "    'RESULT:'+$case+':'+$_.Exception.Message",
      '  }finally{',
      '    [IO.Directory]::Delete($Root,$true)',
      '  }',
      '}'
    ];
    const encoded = Buffer.from(program.join('\n'), 'utf16le').toString(
      'base64'
    );
    const x = spawnSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(x.status, 0, x.stderr);
    assert.deepEqual(x.stdout.trim().split(/\r?\n/u).filter(Boolean), [
      'RESULT:expired:PASS',
      'RESULT:dead:PASS',
      'RESULT:alive:PARENT_ALIVE_NO_RESTORE',
      'RESULT:corrupt:UNKNOWN_STATE_NO_OVERWRITE'
    ]);
  }
);
