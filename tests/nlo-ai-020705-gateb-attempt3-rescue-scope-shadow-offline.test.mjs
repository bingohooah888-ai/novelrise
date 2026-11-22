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
    'gateb-dpapi-attempt3-system-rescue-candidate.ps1'
  ),
  'utf8'
);
const take = (start, end) => {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'missing source function: ' + start);
  return src.slice(i, j);
};
const originalScope = take(
  'function Get-RescueScope {',
  'function Confirm-ScopeExpiredOrParentDead('
);
const fixtureScope = originalScope.replace(
  /if\(\$env:COMPUTERNAME -cne \$HostPin -or\s+\[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.User\.Value -cne \$SystemSid\)\{\s+throw 'SYSTEM_HOST_REQUIRED'\s+\}/u,
  "if(-not $script:Root.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw 'FIXTURE_ONLY'}"
);
assert.notEqual(
  originalScope,
  fixtureScope,
  'fixture must replace only SYSTEM identity gate'
);

test('SYSTEM rescue scope always uses script-pinned paths, not dynamic caller variables', () => {
  for (const name of ['State', 'Original', 'Manifest', 'Marker']) {
    assert.match(
      fixtureScope,
      new RegExp('\\$script:' + name + '\\b', 'u'),
      name + ' must be explicitly script-scoped'
    );
  }
  assert.match(src, /\$guardState=ConvertFrom-Json/u);
  assert.match(src, /\$scopeManifest=Get-RescueScope/u);
});

test(
  'real Get-RescueScope reads isolated guard with both $state and $manifest caller shadows',
  { skip: process.platform !== 'win32' },
  () => {
    const program = [
      'Set-StrictMode -Version Latest',
      "$ErrorActionPreference='Stop'",
      "$script:HostPin='DESKTOP-8Q4GFC8'",
      "$script:Account='NOVELIGHT-GateB'",
      "$script:TaskName='NOVELIGHT-GateB-Independent-Recovery'",
      "$script:Sid='S-1-5-21-7777777'",
      "$script:Stage='NONE'",
      'function Get-LocalUser {',
      '  [CmdletBinding()]param([string]$Name)',
      "  if($Name -cne 'NOVELIGHT-GateB'){throw 'WRONG_ACCOUNT'}",
      '  return [pscustomobject]@{SID=[pscustomobject]@{Value=$script:Sid};Enabled=$false}',
      '}',
      'function Assert-PinnedRoot {',
      "  if(-not $script:Root.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw 'NOT_TEMP'}",
      '}',
      take('function Assert-PinnedLeaf(', 'function Assert-PinnedRoot'),
      fixtureScope,
      'function Invoke-CallerStateShadow {',
      '  $state=ConvertFrom-Json ([IO.File]::ReadAllText($script:State))',
      '  return Get-RescueScope',
      '}',
      'function Invoke-CallerManifestShadow {',
      "  $manifest=[pscustomobject]@{meaning='not a path'}",
      '  return Get-RescueScope',
      '}',
      "$script:Root=Join-Path ([IO.Path]::GetTempPath()) ('gateb-a3-shadow-'+[guid]::NewGuid().ToString('N'))",
      '[IO.Directory]::CreateDirectory($script:Root) | Out-Null',
      'try {',
      "  $script:State=Join-Path $script:Root 'state.json'",
      "  $script:Original=Join-Path $script:Root 'state.json.dpapi-attempt3-original'",
      "  $script:Manifest=Join-Path $script:Root 'gateb-dpapi-attempt3-arm-manifest.json'",
      "  $script:Marker=Join-Path $script:Root 'gateb-dpapi-attempt3-once-consumed.marker'",
      "  $parentStart=[datetime]::UtcNow.AddMinutes(-2).ToString('o')",
      "  $deadline=[datetime]::UtcNow.AddMinutes(2).ToString('o')",
      "  $saved=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;phase='GUARD_ONLY';parentPid=0;parentStartUtc=$null;deadlineUtc=$null}",
      "  $guard=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;phase='GUARDED_TEST';parentPid=777;parentStartUtc=$parentStart;deadlineUtc=$deadline}",
      '  [IO.File]::WriteAllText($script:Original,($saved|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      '  [IO.File]::WriteAllText($script:State,($guard|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      '  $originalSha=(Get-FileHash $script:Original -Algorithm SHA256).Hash.ToLowerInvariant()',
      '  $guardedSha=(Get-FileHash $script:State -Algorithm SHA256).Hash.ToLowerInvariant()',
      '  $m=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;originalSha256=$originalSha;guardedSha256=$guardedSha;parentPid=777;parentStartUtc=$parentStart;deadlineUtc=$deadline}',
      '  [IO.File]::WriteAllText($script:Manifest,($m|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      "  [IO.File]::WriteAllText($script:Marker,'SPENT',[Text.Encoding]::UTF8)",
      '  foreach($kind in @("state","manifest")){',
      '    if($kind -eq "state"){$result=Invoke-CallerStateShadow}else{$result=Invoke-CallerManifestShadow}',
      "    if($result.originalSha256 -cne $originalSha -or $result.guardedSha256 -cne $guardedSha){throw 'MISMATCHED_SCOPE_HASHES'}",
      "    if($script:Stage -cne 'SCOPE_STATE_CONTENT'){throw 'DID_NOT_REACH_STATE_CONTENT'}",
      "    'RESULT:'+$kind+':PASS'",
      '  }',
      "  [IO.File]::AppendAllText($script:State,' ')",
      '  try{',
      '    $null=Invoke-CallerStateShadow',
      "    'RESULT:tampered:UNEXPECTED_SUCCESS'",
      "  }catch{'RESULT:tampered:'+$_.Exception.Message}",
      "  if([IO.File]::ReadAllText($script:Marker) -cne 'SPENT'){throw 'MARKER_WAS_CHANGED'}",
      '}finally{[IO.Directory]::Delete($script:Root,$true)}'
    ];
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(program.join('\n'), 'utf16le').toString('base64')
      ],
      { encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.stdout
        .trim()
        .split(/\r?\n/u)
        .filter((x) => x.startsWith('RESULT:')),
      [
        'RESULT:state:PASS',
        'RESULT:manifest:PASS',
        'RESULT:tampered:UNKNOWN_STATE_NO_OVERWRITE'
      ]
    );
  }
);
