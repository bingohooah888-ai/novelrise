import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  CODEX_BYPASS_CATEGORIES,
  CODEX_EVIDENCE_SOURCES,
  parseCodexRoutingEvidence
} from '../scripts/runtime-gate-entry.mjs';

const NOW = Date.parse('2026-08-31T00:10:00.000Z');
const FRESH = '2026-08-31T00:00:00.000Z';
const SOURCE = '--codex-evidence-source=github-codex-connector';
const EVIDENCE = '--codex-evidence=current Codex execution reference 123456';
const CHECKED = `--codex-checked-at=${FRESH}`;

function usedArgs() {
  return ['--codex-route=used', SOURCE, EVIDENCE, CHECKED];
}

function bypassArgs(category, reason) {
  return [
    '--codex-route=bypass',
    `--codex-bypass-category=${category}`,
    SOURCE,
    EVIDENCE,
    `--codex-bypass-reason=${reason}`,
    CHECKED
  ];
}

test('non-implementation phases are not applicable', () => {
  const route = parseCodexRoutingEvidence('read-only', [], {}, NOW);
  assert.equal(route.required, false);
  assert.equal(route.route, 'not-applicable');
});

test('implementation fails without Codex evidence', () => {
  assert.throws(
    () => parseCodexRoutingEvidence('implementation', [], {}, NOW),
    /requires Codex-first routing evidence/
  );
});

test('fresh Codex-used evidence passes', () => {
  const route = parseCodexRoutingEvidence(
    'implementation',
    usedArgs(),
    {},
    NOW
  );
  assert.equal(route.required, true);
  assert.equal(route.route, 'used');
  assert.equal(route.evidenceSource, 'github-codex-connector');
  assert.equal(route.checkedAt, FRESH);
  assert.equal(route.bypassCategory, null);
});

test('evidence sources are enumerated', () => {
  assert.deepEqual(
    [...CODEX_EVIDENCE_SOURCES],
    ['github-codex-connector', 'codex-work', 'codex-cli']
  );
  const args = usedArgs();
  args[1] = '--codex-evidence-source=assistant-self-assertion';
  assert.throws(
    () => parseCodexRoutingEvidence('implementation', args, {}, NOW),
    /evidence source must be one of/
  );
});

test('fresh usage-limit bypass passes', () => {
  const reason = 'Fresh Codex request was rejected by the usage limit.';
  const route = parseCodexRoutingEvidence(
    'implementation',
    bypassArgs('usage-limit', reason),
    {},
    NOW
  );
  assert.equal(route.route, 'bypass');
  assert.equal(route.bypassCategory, 'usage-limit');
});

test('bypass categories are enumerated', () => {
  assert.deepEqual(
    [...CODEX_BYPASS_CATEGORIES],
    [
      'usage-limit',
      'service-outage',
      'auth-permission-network',
      'unsupported-operation'
    ]
  );
  const reason = 'Current change is too small to require Codex execution.';
  assert.throws(
    () =>
      parseCodexRoutingEvidence(
        'implementation',
        bypassArgs('small-change', reason),
        {},
        NOW
      ),
    /bypass category must be one of/
  );
});

test('convenience bypass reasons fail', () => {
  const reason = 'This is a small-change and manual-faster for the assistant.';
  assert.throws(
    () =>
      parseCodexRoutingEvidence(
        'implementation',
        bypassArgs('unsupported-operation', reason),
        {},
        NOW
      ),
    /convenience rationale/
  );
});

test('stale Codex evidence fails', () => {
  const args = usedArgs();
  args[3] = '--codex-checked-at=2026-08-30T23:00:00.000Z';
  assert.throws(
    () => parseCodexRoutingEvidence('implementation', args, {}, NOW),
    /evidence is stale/
  );
});

test('credential-like evidence fails', () => {
  const args = usedArgs();
  args[2] = '--codex-evidence=Bearer abcdefghijklmnopqrstuvwxyz current task';
  assert.throws(
    () => parseCodexRoutingEvidence('implementation', args, {}, NOW),
    /secret or credential/
  );
});

test('repository uses the Codex-first wrapper', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  const gateDoc = await readFile(
    new URL('../docs/CODEX-FIRST-EXECUTION-GATE.md', import.meta.url),
    'utf8'
  );
  const wrapper = await readFile(
    new URL('../scripts/runtime-gate-entry.mjs', import.meta.url),
    'utf8'
  );
  assert.equal(
    packageJson.scripts['runtime:gate'],
    'node scripts/runtime-gate-entry.mjs'
  );
  assert.match(gateDoc, /Codexを「推奨」ではなく最初の実装経路として必須/);
  assert.match(gateDoc, /manual-faster/);
  assert.match(wrapper, /state\.codexRouting = codexRouting/);
});
