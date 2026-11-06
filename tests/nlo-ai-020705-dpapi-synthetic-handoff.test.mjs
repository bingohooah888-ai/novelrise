import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runGateBDpapiSyntheticHandoff,
  gateBProtectedCredentialHandoff
} from '../scripts/nlo-ai-020705-dpapi-synthetic-handoff.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('default invocation cannot store, transfer or read real credentials', () => {
  const r = runGateBDpapiSyntheticHandoff();
  assert.equal(r.status, 'BLOCK_SYNTHETIC_OPT_IN_REQUIRED');
  assert.equal(r.patAccepted, false);
  assert.equal(r.realCredentialRead, false);
  assert.equal(r.realCredentialHandoff, false);
  assert.equal(r.realHostAttested, false);
  assert.equal(r.authorizesLiveGateB, false);
  assert.equal(r.cloudMutations, 0);
});

test('unknown modes and supplied credentials are refused without secret exposure', () => {
  for (const input of [
    null,
    {},
    { mode: 'LIVE' },
    { mode: 'REAL_PAT' },
    { mode: 'OFFLINE_SYNTHETIC_ONLY', token: 'MOCK_DO_NOT_READ' },
    { mode: 'OFFLINE_SYNTHETIC_ONLY', command: 'cmd' },
    { mode: 'OFFLINE_SYNTHETIC_ONLY', cwd: '/tmp' },
    { mode: 'OFFLINE_SYNTHETIC_ONLY', url: 'https://example.org' }
  ]) {
    const r = runGateBDpapiSyntheticHandoff(input);
    assert.equal(r.status, 'BLOCK_SYNTHETIC_OPT_IN_REQUIRED');
    assert.equal(r.realCredentialHandoff, false);
    assert.doesNotMatch(JSON.stringify(r), /MOCK_DO_NOT_READ|example.org/u);
  }
});

test('the live handoff entrypoint is permanently fail-closed', () => {
  const r = gateBProtectedCredentialHandoff();
  assert.equal(
    r.status,
    'BLOCK_LIVE_GATE_B_CREDENTIAL_HANDOFF_NOT_IMPLEMENTED'
  );
  assert.equal(r.authorizesLiveGateB, false);
  assert.equal(r.cloudMutations, 0);
});

test('PowerShell script has fixed synthetic-only entrypoint and no external I/O', () => {
  const src = readFileSync(
    join(
      root,
      'tools',
      'novelight-commander',
      'gateb-dpapi-synthetic-handoff.ps1'
    ),
    'utf8'
  );
  assert.match(src, /ConvertFrom-SecureString/u);
  assert.match(src, /ConvertTo-SecureString/u);
  assert.match(src, /SetAccessRuleProtection\(\$true, \$false\)/u);
  assert.match(src, /Remove-Item -LiteralPath \$folder/u);
  assert.match(src, /GATEB_DPAPI_SYNTHETIC_HANDOFF_PASS/u);
  assert.doesNotMatch(
    src,
    /Invoke-WebRequest|Invoke-RestMethod|curl\.exe|Get-Clipboard|Read-Host|SUPABASE_ACCESS_TOKEN|github\.com|api\.supabase\.com/iu
  );
});

test(
  'Windows executes isolated local synthetic encrypt/decrypt/handoff; never a live PAT',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const r = runGateBDpapiSyntheticHandoff({
      mode: 'OFFLINE_SYNTHETIC_ONLY'
    });
    assert.equal(r.status, 'OFFLINE_DPAPI_SYNTHETIC_HANDOFF_PASS');
    assert.equal(r.realCredentialRead, false);
    assert.equal(r.realCredentialHandoff, false);
    assert.equal(r.realHostAttested, false);
    assert.equal(r.patAccepted, false);
    assert.equal(r.cloudMutations, 0);
  }
);
