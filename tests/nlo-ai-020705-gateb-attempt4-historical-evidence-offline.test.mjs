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
const coord = readFileSync(
  join(dir, 'gateb-dpapi-attempt4-one-shot-coordinator-candidate.ps1'),
  'utf8'
);
const installer = readFileSync(
  join(dir, 'gateb-dpapi-attempt4-protected-upgrade-candidate.ps1'),
  'utf8'
);
const begin = coord.indexOf('function Assert-PriorTrialEvidenceIntact {');
const end = coord.indexOf('function Assert-Preflight {', begin);
assert.ok(begin >= 0 && end > begin);
const evidenceFn = coord.slice(begin, end);

const prior3 = {
  'gateb-dpapi-attempt3-once-consumed.marker':
    '70056cc9690d12bbf87dbab363d3a1865ba89d444eaaf1d675c3fcd98c7c229e',
  'gateb-dpapi-attempt3-protected-upgrade-once-consumed.marker':
    'c466f9eb87c95172c5e4ebce836356107d456aba7883e9d62bb4f971dbd38488',
  'gateb-dpapi-attempt3-emergency-restore-once-consumed.marker':
    '102a9ce35fd30dcd615647cad10909922e9afed8b89c022361098182aba8738a',
  'gateb-dpapi-attempt3-arm-manifest.json':
    '3b2133232d04b238cffea4cc7ddd34939e66db09748279ac000d1bc4fe03060c',
  'state.json.dpapi-attempt3-original':
    '1b6d10aa5365fb9dc355a2a04ea3da0e97f07ca933fd35bd4d947b758893744c',
  'state.json.dpapi-attempt3-emergency-restore-backup':
    '31ac3cece05d0d7cea0f115000f54e3aa2c872a4656768a2120ea9eabda26146',
  'gateb-dpapi-attempt3-system-rescue-first-failure.json':
    'f919c239656a7a2d88cdb564f98604147ec4900117168424c21402c9b9a4670b'
};

const previous3 = {
  'gateb-dpapi-one-shot-coordinator.ps1.attempt3-previous':
    '1dcbccbe09de3019dce3793f92934b09ccfb7503e58e08db7c623039895a3fb0',
  'gateb-dpapi-system-rescue.ps1.attempt3-previous':
    '6c0dbf432324c19cf89c70d50b816b3cfaa621d8ecf4b8e0d06bc37e624252dd',
  'gateb-dpapi-approval-contract.ps1.attempt3-previous':
    'cc078e2a7e428ae48c9d74d2573bc6e02642f6375ac7055b858a4b88c94a6501'
};

test('attempt-4 coordinator and upgrade pin all spent attempt-3 evidence', () => {
  for (const [name, sha] of Object.entries({ ...prior3, ...previous3 })) {
    assert.ok(
      coord.includes(name) && installer.includes(name),
      'missing historic name ' + name
    );
    assert.ok(
      coord.includes(sha) && installer.includes(sha),
      'missing historic sha ' + name
    );
  }
  for (const source of [coord, installer]) {
    assert.match(source, /ATTEMPT3_CONSUMED_EVIDENCE_DRIFT/u);
    assert.match(
      source,
      /state\.json\.dpapi-attempt3-emergency-restore-backup/u
    );
    assert.match(
      source,
      /gateb-dpapi-attempt4-emergency-restore-once-consumed\.marker/u
    );
  }
  assert.match(installer, /oldOwner\.version -eq 3/u);
  assert.match(installer, /ownerV4=\[ordered\]@\{/u);
  assert.match(
    installer,
    /version=4;approvalId='GATEB_DPAPI_ATTEMPT4_OWNER_APPROVED'/u
  );
  assert.match(installer, /ATTEMPT3_INSTALLED_SOURCE_DRIFT/u);
});

test(
  'real prior-trial gate rejects corrupted and replayed evidence in an isolated TEMP fixture',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const known = {
      ...prior3,
      ...previous3,
      'state.json': prior3['state.json.dpapi-attempt3-original'],
      'state.json.dpapi-original': prior3['state.json.dpapi-attempt3-original'],
      'state.json.dpapi-arm-backup':
        prior3['state.json.dpapi-attempt3-original'],
      'state.json.dpapi-missing-manifest-guarded-backup':
        '15cef1cb625648d6430c9fc14e872ce4cb401b9688feeb3216b97e65031ebda3',
      'state.json.dpapi-attempt2-original':
        prior3['state.json.dpapi-attempt3-original']
    };
    const script = [
      'Set-StrictMode -Version Latest',
      "$ErrorActionPreference='Stop'",
      'Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop',
      "$script:Root=Join-Path ([IO.Path]::GetTempPath()) ('gb4-evidence-'+[guid]::NewGuid().ToString('N'))",
      '$null=[IO.Directory]::CreateDirectory($Root)',
      "$script:HostPin='DESKTOP-8Q4GFC8'",
      "$script:Sid='S-1-5-21-7777777'",
      "$script:TaskName='NOVELIGHT-GateB-Independent-Recovery'",
      "$script:PriorOriginalSha='" + known['state.json'] + "'",
      "$script:PriorGuardedSha='" +
        known['state.json.dpapi-missing-manifest-guarded-backup'] +
        "'",
      '$script:Known=@{}',
      ...Object.entries(known).map(
        ([name, sha]) => "$script:Known['" + name + "']='" + sha + "'"
      ),
      'function Assert-Leaf([string]$Path){',
      " if(-not $Path.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($Path)){throw 'MISSING_PRIOR_FILE'}",
      '}',
      'function Get-FileHash {',
      ' [CmdletBinding()]param([string]$LiteralPath,[string]$Path,[string]$Algorithm)',
      ' $p=if($LiteralPath){$LiteralPath}else{$Path}',
      ' $name=[IO.Path]::GetFileName($p)',
      " if(-not $script:Known.ContainsKey($name)){throw 'UNEXPECTED_HASH_FILE'}",
      ' return [pscustomobject]@{Hash=$script:Known[$name]}',
      '}',
      evidenceFn,
      "$script:PriorMarker=Join-Path $Root 'gateb-dpapi-one-shot-consumed.marker'",
      "$script:PriorOriginal=Join-Path $Root 'state.json.dpapi-original'",
      "$script:PriorArmBackup=Join-Path $Root 'state.json.dpapi-arm-backup'",
      "$script:PriorRestoreMarker=Join-Path $Root 'gateb-dpapi-missing-manifest-restore-once-consumed.marker'",
      "$script:PriorGuardedBackup=Join-Path $Root 'state.json.dpapi-missing-manifest-guarded-backup'",
      "$script:State=Join-Path $Root 'state.json'",
      "$script:Marker=Join-Path $Root 'gateb-dpapi-attempt4-once-consumed.marker'",
      "$script:Original=Join-Path $Root 'state.json.dpapi-attempt4-original'",
      "$script:Manifest=Join-Path $Root 'gateb-dpapi-attempt4-arm-manifest.json'",
      "foreach($name in @('state.json','state.json.dpapi-original','state.json.dpapi-arm-backup','state.json.dpapi-missing-manifest-guarded-backup','gateb-dpapi-one-shot-consumed.marker','gateb-dpapi-missing-manifest-restore-once-consumed.marker','gateb-dpapi-attempt2-once-consumed.marker','state.json.dpapi-attempt2-original')){",
      " [IO.File]::WriteAllText((Join-Path $Root $name),'old')",
      '}',
      ...Object.keys({ ...prior3, ...previous3 })
        .filter((x) => x !== 'gateb-dpapi-attempt3-arm-manifest.json')
        .map(
          (name) =>
            "[IO.File]::WriteAllText((Join-Path $Root '" + name + "'),'spent')"
        ),
      " [IO.File]::WriteAllText((Join-Path $Root 'gateb-dpapi-owner-permit.json.attempt3-previous'),'old-permit')",
      " [IO.File]::WriteAllText((Join-Path $Root 'gateb-dpapi-sid-proof-arm.json.attempt3-previous'),'old-proof')",
      "$m2=@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;originalSha256=$PriorOriginalSha;guardedSha256=('a'*64)}",
      "$m3=@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;originalSha256=$PriorOriginalSha;guardedSha256='" +
        prior3['state.json.dpapi-attempt3-emergency-restore-backup'] +
        "'}",
      " [IO.File]::WriteAllText((Join-Path $Root 'gateb-dpapi-attempt2-arm-manifest.json'),($m2|ConvertTo-Json -Compress))",
      " [IO.File]::WriteAllText((Join-Path $Root 'gateb-dpapi-attempt3-arm-manifest.json'),($m3|ConvertTo-Json -Compress))",
      'try{',
      ' Assert-PriorTrialEvidenceIntact',
      " 'RESULT:clean:PASS'",
      " $script:Known['gateb-dpapi-attempt3-once-consumed.marker']='0000'",
      " try{Assert-PriorTrialEvidenceIntact;'RESULT:drift:UNEXPECTED_PASS'}catch{'RESULT:drift:'+$_.Exception.Message}",
      " $script:Known['gateb-dpapi-attempt3-once-consumed.marker']='" +
        prior3['gateb-dpapi-attempt3-once-consumed.marker'] +
        "'",
      " [IO.File]::Delete((Join-Path $Root 'gateb-dpapi-attempt3-system-rescue-first-failure.json'))",
      " try{Assert-PriorTrialEvidenceIntact;'RESULT:missing:UNEXPECTED_PASS'}catch{'RESULT:missing:'+$_.Exception.Message}",
      " [IO.File]::WriteAllText((Join-Path $Root 'gateb-dpapi-attempt3-system-rescue-first-failure.json'),'spent')",
      " [IO.File]::WriteAllText($Marker,'SPENT')",
      " try{Assert-PriorTrialEvidenceIntact;'RESULT:replay:UNEXPECTED_PASS'}catch{'RESULT:replay:'+$_.Exception.Message}",
      '}finally{[IO.Directory]::Delete($Root,$true)}'
    ];
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script.join('\n'), 'utf16le').toString('base64')
      ],
      { encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(
      result.stdout
        .trim()
        .split(/\r?\n/u)
        .filter((x) => x.startsWith('RESULT:')),
      [
        'RESULT:clean:PASS',
        'RESULT:drift:ATTEMPT3_CONSUMED_EVIDENCE_DRIFT',
        'RESULT:missing:MISSING_PRIOR_FILE',
        'RESULT:replay:ATTEMPT4_ALREADY_CONSUMED_OR_PARTIAL'
      ]
    );
  }
);
