import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectGateBHostReadOnly,
  evaluateGateBSyntheticHandoff,
  createProtectedGateBRunner
} from '../scripts/nlo-ai-020705-gateb-host-handoff-offline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inspector = readFileSync(
  join(
    root,
    'tools',
    'novelight-commander',
    'gateb-host-readonly-inspection.ps1'
  ),
  'utf8'
);
const adapter = readFileSync(
  join(root, 'scripts', 'nlo-ai-020705-gateb-host-handoff-offline.mjs'),
  'utf8'
);
const perfectMock = Object.freeze({
  mode: 'OFFLINE_SYNTHETIC_ONLY',
  hostObservation: 'GATEB_HOST_READONLY_INSPECTION_PASS',
  dpapiObservation: 'OFFLINE_DPAPI_SYNTHETIC_HANDOFF_PASS',
  runnerObservation: 'DORMANT_NO_EXECUTOR',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
});

function isSafe(result) {
  assert.equal(result.mode, 'offline-synthetic-only');
  for (const field of [
    'ownerApprovalConsumed',
    'hostIdentityAuthenticated',
    'independentHostAttested',
    'realCredentialAccepted',
    'realPatIssued',
    'credentialsStored',
    'stagingAccessTested',
    'productionAccessTested',
    'runnerEnabled',
    'authorizesAccountEnable',
    'authorizesPasswordReset',
    'authorizesStaging',
    'authorizesProduction',
    'authorizesPaidAi'
  ])
    assert.equal(result[field], false, field);
  assert.equal(result.cloudMutations, 0);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(
    Object.keys(result).some((k) =>
      /^(?:token|password|secret|jwt|apiKey|credential)$/iu.test(k)
    ),
    false
  );
}

test('default host probe denies invocation without exact explicit opt-in', () => {
  isSafe(inspectGateBHostReadOnly());
  assert.equal(
    inspectGateBHostReadOnly().status,
    'BLOCK_EXACT_READONLY_OPT_IN_REQUIRED'
  );
});

test('unknown host probe keys and live mode are denied before execution', () => {
  for (const input of [
    { mode: 'LIVE' },
    { mode: 'OFFLINE_READONLY_INSPECT', token: 'dummy' },
    { mode: 'OFFLINE_READONLY_INSPECT', path: 'other.ps1' },
    { mode: 'OFFLINE_READONLY_INSPECT', command: 'Enable-LocalUser' },
    { mode: 'OFFLINE_READONLY_INSPECT', approval: true },
    { mode: 'OFFLINE_READONLY_INSPECT', environment: 'production' },
    null,
    [],
    Object.create(null)
  ]) {
    const result = inspectGateBHostReadOnly(input);
    isSafe(result);
    assert.equal(result.status, 'BLOCK_EXACT_READONLY_OPT_IN_REQUIRED');
  }
});

test('all mock proofs match: STILL NO-GO and no protected runner', () => {
  const result = evaluateGateBSyntheticHandoff(perfectMock);
  isSafe(result);
  assert.equal(result.status, 'OFFLINE_SYNTHETIC_CONTRACT_MATCH_NO_GO');
  assert.throws(
    createProtectedGateBRunner,
    /GATEB_LIVE_PROTECTED_RUNNER_DISABLED/u
  );
});

test('production project and other environments are hard denied', () => {
  for (const stagingProjectRef of [
    'fiepaguycecrredwrcwx',
    'other',
    '',
    null,
    undefined
  ]) {
    const r = evaluateGateBSyntheticHandoff({
      ...perfectMock,
      stagingProjectRef
    });
    isSafe(r);
    assert.equal(r.status, 'BLOCK_STAGING_SCOPE_MISMATCH');
  }
});

test('unknown synthetic input and credential-like payloads are denied', () => {
  for (const input of [
    {},
    null,
    [],
    { ...perfectMock, pat: 'synthetic-value' },
    { ...perfectMock, jwt: 'synthetic-value' },
    { ...perfectMock, token: 'synthetic-value' },
    { ...perfectMock, endpoint: 'https://example.com' },
    { ...perfectMock, password: 'synthetic-value' },
    { ...perfectMock, mode: 'LIVE' }
  ]) {
    const r = evaluateGateBSyntheticHandoff(input);
    isSafe(r);
    assert.equal(r.status, 'BLOCK_EXACT_SYNTHETIC_INPUT_REQUIRED');
  }
});

test('missing host, DPAPI or dormant runner evidence is denied', () => {
  for (const key of [
    'hostObservation',
    'dpapiObservation',
    'runnerObservation'
  ]) {
    const r = evaluateGateBSyntheticHandoff({
      ...perfectMock,
      [key]: 'UNVERIFIED'
    });
    isSafe(r);
    assert.equal(r.status, 'BLOCK_SYNTHETIC_HANDOFF_PROOFS_INCOMPLETE');
  }
});

test('read-only Windows script is scope-fixed and never mutates credentials', () => {
  assert.match(inspector, /DESKTOP-8Q4GFC8/u);
  assert.match(inspector, /NOVELIGHT-GateB/u);
  assert.match(inspector, /Get-LocalUser/u);
  assert.match(inspector, /Get-LocalGroupMember/u);
  assert.match(inspector, /GetAccessControl/u);
  assert.match(inspector, /AreAccessRulesProtected/u);
  assert.match(inspector, /GATEB_HOST_READONLY_INSPECTION_INCOMPLETE_NO_GO/u);
  assert.doesNotMatch(
    inspector,
    /New-LocalUser|Enable-LocalUser|Set-LocalUser|Remove-LocalUser|SetAccessControl|New-ScheduledTask|Register-ScheduledTask|Invoke-RestMethod|Invoke-WebRequest|ConvertFrom-SecureString|ConvertTo-SecureString|Get-Clipboard|Set-Clipboard|Read-Host|Start-Process|&\s*runas/iu
  );
});

test('Node adapter is pinned, minimal-environment and offline only', () => {
  assert.match(adapter, /INSPECTOR_SHA256/u);
  assert.match(adapter, /createHash\('sha256'\)/u);
  assert.match(adapter, /shell: false/u);
  assert.match(adapter, /GATEB_LIVE_PROTECTED_RUNNER_DISABLED/u);
  assert.doesNotMatch(
    adapter,
    /fetch\(|https:\/\/|http:\/\/|process\.env\.|Authorization|service_role|child\.stderr\s*\)|child\.stdout\s*\)|-Mode',\s*'Apply'/iu
  );
});

test(
  'Windows physical offline inspection does not activate the user',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const result = inspectGateBHostReadOnly({
      mode: 'OFFLINE_READONLY_INSPECT'
    });
    isSafe(result);
    // A privileged observer may see a PASS, but it NEVER authorizes execution.
    assert.ok(
      [
        'OFFLINE_HOST_READONLY_INSPECTION_PASS_NO_GO',
        'BLOCK_HOST_READONLY_INSPECTION_INCOMPLETE'
      ].includes(result.status)
    );
  }
);
