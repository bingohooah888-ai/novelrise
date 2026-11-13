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
    'gateb-dpapi-one-shot-coordinator-candidate.ps1'
  ),
  'utf8'
);

test('Plan denies live work; Apply requires protected installed owner permit', () => {
  assert.match(src, /\[ValidateSet\('Plan','Apply'\)\]/u);
  assert.match(src, /GATEB_DPAPI_ONE_SHOT_OFFLINE_CONTRACT_ONLY/u);
  assert.match(src, /Assert-GateBDpapiOwnerPermit/u);
  assert.match(src, /function Invoke-ApprovedOneShotTrial/u);
  assert.equal((src.match(/Invoke-ApprovedOneShotTrial/gu) ?? []).length, 2);
  assert.match(src, /GATEB_DPAPI_ONE_SHOT_NO_GO_NO_RETRY/u);
});
test('only fixed host, user, watchdog and old installed worker hash', () => {
  for (const v of [
    'DESKTOP-8Q4GFC8',
    'NOVELIGHT-GateB',
    'NOVELIGHT-GateB-Independent-Recovery',
    '78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
  ])
    assert.ok(src.includes(v), v);
  assert.match(src, /GUARD_ONLY/u);
  assert.match(src, /GUARDED_TEST/u);
});
test('one-shot ledger CreateNew and immutable old markers not removed', () => {
  assert.match(src, /function Consume-OneShotLedger/u);
  assert.match(src, /FileMode\]::CreateNew/u);
  assert.match(src, /ATTEMPT2_ALREADY_CONSUMED_OR_PARTIAL/u);
  assert.match(src, /gateb-dpapi-attempt2-once-consumed\.marker/u);
  assert.match(src, /PRIOR_CONSUMED_TRIAL_EVIDENCE_CHANGED/u);
  assert.match(src, /gateb-dpapi-one-shot-consumed\.marker/u);
  assert.match(
    src,
    /gateb-dpapi-missing-manifest-restore-once-consumed\.marker/u
  );
  assert.doesNotMatch(src, /Remove-Item|Delete-Item|File\]::Delete/u);
});
test('password generated in-memory via CSPRNG and never as full plaintext string', () => {
  assert.match(
    src,
    /Security\.Cryptography\.RandomNumberGenerator\]::Create\(\)/u
  );
  assert.match(src, /SecureString\]::new\(\)/u);
  assert.match(src, /AppendChar/u);
  assert.match(src, /Set-LocalUser -SID/u);
  assert.match(src, /PSCredential\]::new/u);
  assert.doesNotMatch(
    src,
    /ConvertTo-SecureString|Get-Credential|Read-Host|Get-Clipboard/u
  );
});
test('atomic guarded state writes require parent PID plus UTC birth', () => {
  assert.match(src, /function Arm-GuardAtomically/u);
  assert.match(src, /PARENT_CHANGED/u);
  assert.match(src, /parentStartUtc=\$ParentStartUtc/u);
  assert.match(src, /File\]::Replace\(\$temp,\$State/u);
  assert.match(src, /GUARDED_TEST/u);
  assert.match(src, /MaxGuardSeconds=300/u);
});
test('independent SYSTEM heartbeat must observe PARENT_ALIVE before enable', () => {
  assert.match(src, /function Wait-IndependentArmedHeartbeat/u);
  assert.match(src, /reasonCode -ceq 'PARENT_ALIVE'/u);
  const body = src.slice(src.indexOf('function Invoke-ApprovedOneShotTrial'));
  assert.ok(
    body.indexOf('Wait-IndependentArmedHeartbeat') <
      body.indexOf('Enable-LocalUser')
  );
  assert.match(src, /INDEPENDENT_ARMED_WATCHDOG_NOT_ATTESTED/u);
});
test('two target logon processes use loaded profile and marker proof', () => {
  assert.match(src, /-Credential \$Cred -LoadUserProfile -PassThru/u);
  assert.match(src, /TargetCreate/u);
  assert.match(src, /TargetVerify/u);
  assert.match(src, /GATEB_DPAPI_TARGET_CURRENTUSER_CREATE_PASS/u);
  assert.match(src, /GATEB_DPAPI_TARGET_SECOND_PROCESS_PASS/u);
});
test('disable account before cross-SID cryptographic refusal', () => {
  const body = src.slice(src.indexOf('function Invoke-ApprovedOneShotTrial'));
  assert.ok(
    body.indexOf('Disable-TargetOnce') < body.indexOf('Invoke-CrossSidProbe')
  );
  assert.match(src, /GATEB_DPAPI_DIFFERENT_SID_DENIED_PASS/u);
});
test('process and session census both required before restore', () => {
  assert.match(src, /TARGET_CHILD_REMAINS/u);
  assert.match(src, /TARGET_PROFILE_LOADED_OR_UNVERIFIED/u);
  assert.match(rescue, /TARGET_PROFILE_LOADED_OR_UNVERIFIED/u);
  assert.match(rescue, /LOGON_SESSION_RESIDUE/u);
  assert.match(src, /Win32_LogonSession/u);
  assert.match(src, /LOGON_SESSION_REMAINS/u);
  assert.match(src, /function Restore-GuardAtomicallyAfterProof/u);
  assert.match(src, /Assert-ProcessAndSessionZero/u);
});
test('no live cloud, task registration, PAT or logging private values', () => {
  assert.doesNotMatch(
    src,
    /Invoke-WebRequest|Invoke-RestMethod|curl\.exe|api\.supabase|vercel\.com|SUPABASE_ACCESS_TOKEN|Register-ScheduledTask|Unregister-ScheduledTask|Set-ScheduledTask|Write-Host \$(?:password|cred)/iu
  );
});
test('guard expiry and startup are not mistaken for autonomous recovery', () => {
  assert.match(src, /INDEPENDENT_RESCUE_AND_NEW_OWNER_PERMIT_REQUIRED/u);
  assert.match(src, /INDEPENDENT_RESCUE_AND_NEW_OWNER_PERMIT_REQUIRED/u);
  assert.match(src, /MaxEnabledSeconds=240/u);
  assert.match(src, /ACCOUNT_ENABLED_LEASE_EXPIRED/u);
});

const rescue = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'tools',
    'novelight-commander',
    'gateb-dpapi-system-rescue-candidate.ps1'
  ),
  'utf8'
);
test('parent kill rescue is a distinct SYSTEM-only SHA-pinned path', () => {
  assert.match(rescue, /\[ValidateSet\('Inspect','Recover'\)\]/u);
  assert.match(rescue, /SYSTEM_HOST_REQUIRED/u);
  assert.match(rescue, /ARM_MANIFEST_INVALID/u);
  assert.match(rescue, /UNKNOWN_STATE_NO_OVERWRITE/u);
  assert.match(rescue, /Confirm-ScopeExpiredOrParentDead/u);
  assert.match(rescue, /Disable-LocalUser -SID \$u\.SID/u);
  assert.match(rescue, /CHILD_PROCESS_REMAINS/u);
  assert.match(rescue, /LOGON_SESSION_RESIDUE/u);
  assert.match(rescue, /File\]::Replace\(\$temp,\$State/u);
  assert.match(rescue, /GATEB_DPAPI_SYSTEM_RESCUE_NO_GO_/u);
  assert.match(rescue, /function Invoke-AuthorizedSystemRecovery/u);
});
test('guard manifest path is not shadowed and is read back before GUARD activation', () => {
  const begin = src.indexOf('function Arm-GuardAtomically(');
  const end = src.indexOf('function Wait-IndependentArmedHeartbeat(', begin);
  assert.ok(begin >= 0 && end > begin);
  const arming = src.slice(begin, end);
  // PowerShell variables are case-insensitive: $manifest would shadow $Manifest
  // and silently write an OrderedDictionary-named file in the working folder.
  assert.doesNotMatch(arming, /^\s*\$manifest\s*=/imu);
  assert.match(arming, /\$armManifestData=\[ordered\]@/u);
  assert.match(
    arming,
    /\$manifestPath=Join-Path \$Root 'gateb-dpapi-attempt2-arm-manifest\.json'/u
  );
  assert.match(
    arming,
    /\[IO\.File\]::Open\(\$manifestPath,\[IO\.FileMode\]::CreateNew/u
  );
  assert.match(arming, /Assert-Leaf \$manifestPath/u);
  assert.match(arming, /\$persisted=ConvertFrom-Json/u);
  assert.match(arming, /PERSISTED_ARM_MANIFEST_NOT_ATTESTED/u);
  assert.match(
    arming,
    /originalSha256=\$originalSha;guardedSha256=\$armedSha/u
  );
  assert.ok(
    arming.indexOf('PERSISTED_ARM_MANIFEST_NOT_ATTESTED') <
      arming.indexOf('[IO.File]::Replace($temp,$State'),
    'state must not be armed until the pinned manifest is read back and verified'
  );
  assert.match(src, /state\.json\.dpapi-attempt2-original/u);
  assert.match(rescue, /state\.json\.dpapi-attempt2-original/u);
  assert.match(rescue, /gateb-dpapi-attempt2-arm-manifest\.json/u);
  assert.match(rescue, /gateb-dpapi-attempt2-once-consumed\.marker/u);
});
test('receipts are written by SID to Vault, not protected SYSTEM directory', () => {
  assert.match(src, /Join-Path \$Vault 'gateb-dpapi-target-create\.receipt'/u);
  assert.match(src, /Join-Path \$Vault 'gateb-dpapi-target-verify\.receipt'/u);
  assert.doesNotMatch(src, /-RedirectStandardOutput/u);
  assert.match(src, /TARGET_CHILD_TIMEOUT_NO_GO/u);
  assert.match(src, /CHILD_PID_REUSED_DO_NOT_STOP/u);
  assert.match(src, /CHILD_SID_CHANGED_DO_NOT_STOP/u);
  assert.match(src, /Wait-Process -Id \$p.Id -Timeout 55/u);
});
test('unhandled control error tries exactly one local disable and clears password', () => {
  const controller = src.slice(
    src.indexOf('function Invoke-ApprovedOneShotTrial')
  );
  assert.match(controller, /try \{/u);
  assert.match(controller, /\} finally \{/u);
  assert.match(controller, /try \{ Disable-TargetOnce \}/u);
  assert.match(controller, /\$cred\.Password\.Dispose\(\)/u);
  assert.match(controller, /EMERGENCY_DISABLE_NOT_CONFIRMED/u);
});

test('normal GUARD_ONLY restore verifies both pinned state hashes', () => {
  assert.match(src, /UNTRUSTED_ARM_MANIFEST/u);
  assert.match(src, /UNKNOWN_GUARD_STATE_NO_OVERWRITE/u);
  assert.match(src, /\$currentHash -cne \$manifest.guardedSha256/u);
  assert.match(src, /\$originalHash -cne \$manifest.originalSha256/u);
});

test('attempt 2 uses fresh names while validating immutable spent attempt-1 evidence', () => {
  const required = [
    'gateb-dpapi-attempt2-once-consumed.marker',
    'state.json.dpapi-attempt2-original',
    'gateb-dpapi-attempt2-arm-manifest.json'
  ];
  for (const name of required) {
    assert.ok(src.includes(name), 'coordinator missing ' + name);
    assert.ok(rescue.includes(name), 'SYSTEM rescue missing ' + name);
  }
  for (const oldName of [
    'gateb-dpapi-one-shot-consumed.marker',
    'state.json.dpapi-original',
    'state.json.dpapi-arm-backup',
    'gateb-dpapi-missing-manifest-restore-once-consumed.marker',
    'state.json.dpapi-missing-manifest-guarded-backup'
  ]) {
    assert.ok(src.includes(oldName), 'old immutable proof missing ' + oldName);
  }
  assert.match(src, /function Assert-PriorTrialEvidenceIntact/u);
  assert.match(src, /PRIOR_CONSUMED_TRIAL_EVIDENCE_CHANGED/u);
  assert.match(src, /ATTEMPT2_ALREADY_CONSUMED_OR_PARTIAL/u);
  const guardPath = src.slice(src.indexOf('function Arm-GuardAtomically'));
  assert.match(guardPath, /state\.json\.dpapi-attempt2-arm-stage/u);
  assert.match(guardPath, /state\.json\.dpapi-attempt2-arm-backup/u);
  assert.match(guardPath, /state\.json\.dpapi-attempt2-restore-stage/u);
  assert.match(rescue, /state\.json\.dpapi-attempt2-rescue-stage/u);
  assert.doesNotMatch([src, rescue].join('\n'), /Remove-Item|File\]::Delete/u);
});

test('coordinator exposes bounded NO-GO stage and code without logging secrets', () => {
  assert.match(src, /GATEB_DPAPI_ONE_SHOT_NO_GO_STAGE=/u);
  assert.match(src, /GATEB_DPAPI_ONE_SHOT_NO_GO_CODE=/u);
  assert.match(src, /UNCLASSIFIED_COORDINATOR_ERROR/u);
  assert.match(src, /WAIT_INDEPENDENT_SYSTEM_RESCUE_ARMED/u);
  assert.match(src, /CREDENTIAL_RESET/u);
  assert.match(src, /ARM_GUARDED_TEST/u);
  assert.match(src, /WAIT_BOTH_SYSTEM_RESTORED_HEARTBEATS/u);
  const ending = src.slice(src.lastIndexOf('} catch {'));
  assert.doesNotMatch(
    ending,
    /(?:ScriptStackTrace|Write-Error|Write-Output \$_.Exception)/u
  );
});

// Execute the REAL census functions with isolated PowerShell CIM stubs.
// No Windows user, task, guard file or credential is accessed by these cases.
test(
  'isolated Windows rescue/coordinator census accepts unreadable OS owner only with target proofs',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const extract = (source, begin, end) =>
      source.slice(
        source.indexOf(begin),
        source.indexOf(end, source.indexOf(begin))
      );
    const rescueBody = extract(
      rescue,
      'function Assert-NoLiveTargetResources {',
      'function Invoke-IndependentSystemGuardRestore {'
    );
    const coordinatorBody = extract(
      src,
      'function Assert-ProcessAndSessionZero {',
      'function Read-PinnedGuard('
    );
    const prelude = [
      'Set-StrictMode -Version Latest',
      "$ErrorActionPreference='Stop'",
      "$script:Sid='S-1-5-21-7777777'",
      "$script:Account='NOVELIGHT-GateB'",
      "$script:AccountName='NOVELIGHT-GateB'",
      "$script:Stage='TEST'",
      "function Assert-PinnedLocalUser { param([bool]$Disabled) if($script:Scenario -eq 'enabled'){throw 'ACCOUNT_NOT_DISABLED'} }",
      "function Get-LocalUser { [CmdletBinding()]param([string]$Name) return [pscustomobject]@{SID=[pscustomobject]@{Value=$script:Sid};Enabled=($script:Scenario -eq 'enabled')} }",
      'function Get-CimInstance {',
      '  [CmdletBinding()]param([Parameter(Position=0)][string]$ClassName,[string]$Filter)',
      '  switch($ClassName) {',
      "    'Win32_UserAccount' { return [pscustomobject]@{SID=$script:Sid} }",
      "    'Win32_UserProfile' { if($script:Scenario -eq 'profile'){return [pscustomobject]@{Loaded=$true}}; return }",
      "    'Win32_Process' { return [pscustomobject]@{ProcessId=777} }",
      "    default { throw 'UNEXPECTED_CIM_CLASS' }",
      '  }',
      '}',
      'function Get-CimAssociatedInstance {',
      '  [CmdletBinding()]param($InputObject,[string]$Association,[string]$ResultClassName)',
      "  if($script:Scenario -eq 'session'){return [pscustomobject]@{LogonId='123'}}",
      '}',
      'function Invoke-CimMethod {',
      '  [CmdletBinding()]param($InputObject,[string]$MethodName)',
      "  if($script:Scenario -eq 'target'){return [pscustomobject]@{ReturnValue=0;Sid=$script:Sid}}",
      "  return [pscustomobject]@{ReturnValue=2;Sid=''}",
      '}'
    ];
    const cases = ['unknown', 'target', 'session', 'profile', 'enabled'];
    const lines = [
      ...prelude,
      rescueBody,
      ...cases.map(
        (s) =>
          "$script:Scenario='" +
          s +
          "'; try{ Assert-NoLiveTargetResources; 'RESCUE:" +
          s +
          ":PASS' }catch{ 'RESCUE:" +
          s +
          ":'+$_.Exception.Message }"
      ),
      coordinatorBody,
      ...cases.map(
        (s) =>
          "$script:Scenario='" +
          s +
          "'; try{ Assert-ProcessAndSessionZero; 'COORD:" +
          s +
          ":PASS' }catch{ 'COORD:" +
          s +
          ":'+$_.Exception.Message }"
      )
    ];
    const command = Buffer.from(lines.join('\n'), 'utf16le').toString('base64');
    const proc = spawnSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command],
      { encoding: 'utf8', timeout: 20000 }
    );
    assert.equal(proc.status, 0, proc.stderr);
    const results = proc.stdout.trim().split(/\r?\n/u).filter(Boolean);
    assert.deepEqual(results, [
      'RESCUE:unknown:PASS',
      'RESCUE:target:CHILD_PROCESS_REMAINS',
      'RESCUE:session:LOGON_SESSION_RESIDUE',
      'RESCUE:profile:TARGET_PROFILE_LOADED_OR_UNVERIFIED',
      'RESCUE:enabled:TARGET_NOT_DISABLED',
      'COORD:unknown:PASS',
      'COORD:target:TARGET_CHILD_REMAINS',
      'COORD:session:LOGON_SESSION_REMAINS',
      'COORD:profile:TARGET_PROFILE_LOADED_OR_UNVERIFIED',
      'COORD:enabled:ACCOUNT_NOT_DISABLED'
    ]);
  }
);

// Real restore/file-replace/heartbeat code, against disposable TEMP fixtures only.
// SYSTEM identity, protected-root ACL and owner permit are not simulated as PASS.
test(
  'isolated Windows SYSTEM rescue restores pinned guard atomically or fails closed',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const extract = (source, begin, end) =>
      source.slice(
        source.indexOf(begin),
        source.indexOf(end, source.indexOf(begin))
      );
    const functions = [
      extract(
        rescue,
        'function Assert-PinnedLeaf(',
        'function Assert-PinnedRoot'
      ),
      // Replace ONLY the SYSTEM identity check, impossible in an unprivileged
      // disposable fixture. All actual manifest/SHA/state checks stay intact.
      extract(
        rescue,
        'function Get-RescueScope {',
        'function Confirm-ScopeExpiredOrParentDead('
      ).replace(
        /if\(\$env:COMPUTERNAME -cne \$HostPin -or\s+\[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.User\.Value -cne \$SystemSid\)\{\s+throw 'SYSTEM_HOST_REQUIRED'\s+\}/u,
        "if(-not $Root.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw 'FIXTURE_ONLY'}"
      ),
      extract(
        rescue,
        'function Confirm-ScopeExpiredOrParentDead(',
        'function Assert-NoLiveTargetResources {'
      ),
      extract(
        rescue,
        'function Assert-NoLiveTargetResources {',
        'function Invoke-IndependentSystemGuardRestore {'
      ),
      extract(
        rescue,
        'function Invoke-IndependentSystemGuardRestore {',
        'function Write-RescueHeartbeat('
      ),
      extract(
        rescue,
        'function Write-RescueHeartbeat(',
        'function Invoke-AuthorizedSystemRecovery {'
      )
    ];
    const fixture = [
      'Set-StrictMode -Version Latest',
      "$ErrorActionPreference='Stop'",
      "$script:HostPin='DESKTOP-8Q4GFC8'",
      "$script:TaskName='NOVELIGHT-GateB-Independent-Recovery'",
      "$script:Account='NOVELIGHT-GateB'",
      "$script:Sid='S-1-5-21-7777777'",
      "$script:Stage='ISOLATED'",
      'function Assert-PinnedRoot {',
      '  if(-not $script:Root.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw "UNSAFE_TEST_ROOT"}',
      '}',
      'function Get-LocalUser { [CmdletBinding()]param([string]$Name) return [pscustomobject]@{SID=[pscustomobject]@{Value=$script:Sid};Enabled=$false} }',
      'function Get-CimInstance {',
      '  [CmdletBinding()]param([Parameter(Position=0)][string]$ClassName,[string]$Filter)',
      '  switch($ClassName){',
      "    'Win32_UserAccount' { return [pscustomobject]@{SID=$script:Sid} }",
      "    'Win32_UserProfile' { return }",
      "    'Win32_Process' { return [pscustomobject]@{ProcessId=777} }",
      "    default { throw 'UNEXPECTED_CIM_CLASS' }",
      '  }',
      '}',
      'function Get-CimAssociatedInstance { [CmdletBinding()]param($InputObject,[string]$Association,[string]$ResultClassName) }',
      "function Invoke-CimMethod { [CmdletBinding()]param($InputObject,[string]$MethodName) return [pscustomobject]@{ReturnValue=0;Sid='S-1-5-18'} }",
      'function Get-Process {',
      '  [CmdletBinding()]param([int]$Id)',
      "  if($script:CaseName -eq 'parentgone'){throw 'PARENT_MISSING'}",
      '  return [pscustomobject]@{StartTime=$script:ParentDateTime}',
      '}',
      ...functions,
      'function New-Fixture([string]$CaseName) {',
      '  $script:CaseName=$CaseName',
      "  $script:Root=Join-Path ([IO.Path]::GetTempPath()) ('gateb-atomic-fixture-'+[guid]::NewGuid().ToString('N'))",
      '  $null=[IO.Directory]::CreateDirectory($script:Root)',
      "  $script:State=Join-Path $Root 'state.json'",
      "  $script:Original=Join-Path $Root 'state.json.dpapi-attempt2-original'",
      "  $script:Manifest=Join-Path $Root 'gateb-dpapi-attempt2-arm-manifest.json'",
      "  $script:Marker=Join-Path $Root 'gateb-dpapi-attempt2-once-consumed.marker'",
      '  $script:ParentDateTime=[datetime]::UtcNow.AddMinutes(-3)',
      "  $startUtc=$script:ParentDateTime.ToString('o')",
      "  $deadline=if($CaseName -eq 'expired' -or $CaseName -eq 'hashdrift') {[datetime]::UtcNow.AddMinutes(-2).ToString('o')} else {[datetime]::UtcNow.AddMinutes(2).ToString('o')}",
      "  $saved=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;phase='GUARD_ONLY';deadlineUtc=$null;parentPid=0;parentStartUtc=$null}",
      "  $guarded=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;phase='GUARDED_TEST';deadlineUtc=$deadline;parentPid=777;parentStartUtc=$startUtc}",
      '  [IO.File]::WriteAllText($Original,($saved|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      '  [IO.File]::WriteAllText($State,($guarded|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      '  $script:ExpectedOriginal=(Get-FileHash -LiteralPath $Original -Algorithm SHA256).Hash.ToLowerInvariant()',
      '  $originalSha=$script:ExpectedOriginal',
      '  $guardedSha=(Get-FileHash -LiteralPath $State -Algorithm SHA256).Hash.ToLowerInvariant()',
      '  $manifestData=[ordered]@{version=1;host=$HostPin;sid=$Sid;taskName=$TaskName;originalSha256=$originalSha;guardedSha256=$guardedSha;parentPid=777;parentStartUtc=$startUtc;deadlineUtc=$deadline}',
      '  [IO.File]::WriteAllText($Manifest,($manifestData|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)',
      "  [IO.File]::WriteAllText($Marker,'SYNTHETIC_SPENT',[Text.Encoding]::UTF8)",
      "  if($CaseName -eq 'hashdrift'){[IO.File]::AppendAllText($State,' ')}",
      '}',
      "foreach($case in @('expired','parentgone','parentalive','hashdrift')){",
      '  New-Fixture $case',
      '  try {',
      '    Invoke-IndependentSystemGuardRestore',
      "    Write-RescueHeartbeat 'RESTORED_GUARD_ONLY'",
      "    Write-RescueHeartbeat 'IDLE_DISABLED'",
      "    $back=Join-Path $Root 'state.json.dpapi-attempt2-rescue-backup'",
      "    $hb=Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.json'",
      "    $prev=Join-Path $Root 'gateb-dpapi-system-rescue-heartbeat.previous.json'",
      "    if(-not [IO.File]::Exists($back) -or -not [IO.File]::Exists($prev)){throw 'BACKUP_MISSING'}",
      "    if((Get-FileHash $State -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedOriginal){throw 'RESTORED_HASH_MISMATCH'}",
      '    $data=ConvertFrom-Json ([IO.File]::ReadAllText($hb))',
      "    if($data.status -cne 'IDLE_DISABLED' -or $data.sequence -ne 2){throw 'HEARTBEAT_MISMATCH'}",
      "    if([IO.File]::ReadAllText($Marker) -cne 'SYNTHETIC_SPENT'){throw 'SPENT_MARKER_CHANGED'}",
      "    'RESTORE:'+$case+':PASS'",
      '  }catch{',
      '    $phase=(ConvertFrom-Json ([IO.File]::ReadAllText($State))).phase',
      "    if($phase -cne 'GUARDED_TEST'){throw 'FAILURE_CHANGED_GUARD'}",
      "    if([IO.File]::ReadAllText($Marker) -cne 'SYNTHETIC_SPENT'){throw 'FAILURE_CHANGED_MARKER'}",
      "    'RESTORE:'+$case+':'+$_.Exception.Message",
      '  }finally{',
      '    if(-not $Root.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw "UNSAFE_FIXTURE_CLEANUP"}',
      '    [IO.Directory]::Delete($Root,$true)',
      '  }',
      '}'
    ];
    const command = Buffer.from(fixture.join('\n'), 'utf16le').toString(
      'base64'
    );
    const proc = spawnSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command],
      { encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(proc.status, 0, proc.stderr);
    assert.deepEqual(proc.stdout.trim().split(/\r?\n/u).filter(Boolean), [
      'RESTORE:expired:PASS',
      'RESTORE:parentgone:PASS',
      'RESTORE:parentalive:PARENT_ALIVE_NO_RESTORE',
      'RESTORE:hashdrift:UNKNOWN_STATE_NO_OVERWRITE'
    ]);
  }
);
