import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CODEX_BYPASS_CATEGORIES,
  CODEX_EVIDENCE_SOURCES,
  parseCodexRoutingEvidence
} from '../scripts/runtime-gate-entry.mjs';

const NOW = Date.parse('2026-08-31T00:10:00.000Z');
const FRESH = '2026-08-31T00:00:00.000Z';

function args(values) {
  return Object.entries(values).map(([key, value]) => `--${key}=${value}`);
}

test('non-implementation phases do not require Codex routing evidence', () => {
  const routing = parseCodexRoutingEvidence('read-only', [], {}, NOW);
  assert.deepEqual(routing, {
    required: false,
    route: 'not-applicable',
    evidenceSource: 'phase-not-implementation',
    evidence: '',
    checkedAt: null,
    bypassCategory: null,
    bypassReason: null
  });
});

test('implementation phase fails closed without Codex routing evidence', () => {
  assert.throws(
    () => parseCodexRoutingEvidence('implementation', [], {}, NOW),
    /requires Codex-first routing evidence/
  );
});

test('fresh Codex-used evidence passes', () => {
  const routing = parseCodexRoutingEvidence(
    'implementation',
    args({
      'codex-route': 'used',
      'codex-evidence-source': 'github-codex-connector',
      'codex-evidence': 'Issue #252 Codex task completed on current request',
      'codex-checked-at': FRESH
    }),
    {},
    NOW
  );

  assert.equal(routing.required, true);
  assert.equal(routing.route, 'used');
  assert.equal(routing.evidenceSource, 'github-codex-connector');
  assert.equal(routing.checkedAt, FRESH);
  assert.equal(routing.bypassCategory, null);
});

test('only enumerated Codex evidence sources are accepted', () => {
  assert.deepEqual(
    [...CODEX_EVIDENCE_SOURCES],
    ['github-codex-connector', 'codex-work', 'codex-cli']
  );

  assert.throws(
    () =>
      parseCodexRoutingEvidence(
        'implementation',
        args({
          'codex-route': 'used',
          'codex-evidence-source': 'assistant-self-assertion',
          'codex-evidence': 'I decided that Codex was used for this task',
          'codex-checked-at': FRESH
        }),
        {},
        NOW
      ),
    /evidence source must be one of/
  );
});

test('fresh usage-limit bypass with external evidence passes', () => {
  const routing = parseCodexRoutingEvidence(
    'implementation',
    args({
      'codex-route': 'bypass',
      'codex-bypass-category': 'usage-limit',
      'codex-evidence-source': 'github-codex-connector',
      'codex-evidence': 'Issue #252 comment 5469570431 reports Codex usage limit',
      'codex-bypass-reason':
        'The fresh GitHub Codex Connector execution request was rejected because the account usage limit was reached.',
      'codex-checked-at': FRESH
    }),
    {},
    NOW
  );

  assert.equal(routing.route, 'bypass');
  assert.equal(routing.bypassCategory, 'usage-limit');
  assert.match(routing.bypassReason, /usage limit/);
});

test('only enumerated bypass categories are accepted', () => {
  assert.deepEqual(
    [...CODEX_BYPASS_CATEGORIES],
    [
      'usage-limit',
      'service-outage',
      'auth-permission-network',
      'unsupported-operation'
    ]
  );

  assert.throws(
    () =>
      parseCodexRoutingEvidence(
        'implementation',
        args({
          'codex-route': 'bypass',
          'codex-bypass-category': 'small-change',
          'codex-evidence-source': 'github-codex-connector',
          'codex-evidence': 'Current request reached the connector successfully',
          'codex-bypass-reason':
            'The change is small and would be quicker to implement manually.',
          'codex-checked-at': FRESH
        }),
        {},
        NOW
      ),
    /bypass category must be one of/
  );
});

test('convenience rationales cannot justify a valid-category bypass', () => {
  assert.throws(
    () =>
      parseCodexRoutingEvidence(
        'implementation',
        args({
          'codex-route': 'bypass',
          'codex-bypass-category': 'unsupported-operation',
          'codex-evidence-source': 'codex-work',
          'codex-evidence': 'Codex Work task reference current-request-12345',
          'codex-bypass-reason':
            'This is a small-change and manual-faster, so there is no need to use Codex.',
          'codex-checked-at': FRESH
        }),
        {},
        NOW
      ),
    /convenience rationale/
  );
});

test('stale Codex availability evidence fails closed', () => {
  assert.throws(
    () =>
      parseCodexRoutingEvidence(
        'implementation',
        args({
          'codex-route': 'used',
          'codex-evidence-source': 'codex-cli',
          'codex-evidence': 'Codex CLI completed the implementation task successfully',
          'codex-checked-at': '2026-08-30T23:00:00.000Z'
        }),
        {},
        NOW
      ),
    /evidence is stale/
  );
});

test('routing evidence rejects credential-like material', () => {
  assert.throws(
    () =>
      parseCodexRoutingEvidence(
        'implementation',
        args({
          'codex-route': 'used',
          'codex-evidence-source': 'codex-cli',
          'codex-evidence': 'Bearer abcdefghijklmnopqrstuvwxyz current task',
          'codex-checked-at': FRESH
        }),
        {},
        NOW
      ),
    /secret or credential/
  );
});

test(
  'repository contract routes runtime gate through Codex-first wrapper',
  async () => {
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
    assert.match(
      gateDoc,
      /Codexを「推奨」ではなく最初の実装経路として必須/
    );
    assert.match(gateDoc, /manual-faster/);
    assert.match(wrapper, /state\.codexRouting = codexRouting/);
  }
);
