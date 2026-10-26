import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateMasterText } from '../tools/novelight-commander/src/master-sync.js';

test('NLO sync validates the canonical MASTER', async () => {
  const masterUrl = new URL('../docs/NOVELIGHT-MASTER.md', import.meta.url);
  const master = await readFile(masterUrl, 'utf8');
  const checks = validateMasterText(master);
  assert.ok(Object.values(checks).every(Boolean));
});

test('NLO sync accepts Tool Optimization Policy', () => {
  const text = [
    '# NOVELIGHT MASTER',
    '最終更新：2026年10月26日',
    '### ツール選択最適化方針 / Tool Optimization Policy',
    'NLO = NOVELIGHT Commander',
    'NLOは一般のRemote Desktop Commanderとは別物である。',
    'DCのonline/offlineをNLOの稼働状態と混同しない。',
    'x'.repeat(11000),
  ].join('\n');
  assert.ok(Object.values(validateMasterText(text)).every(Boolean));
});

test('NLO sync rejects missing identity or DC separation', () => {
  const base = [
    '# NOVELIGHT MASTER',
    '最終更新：2026年10月26日',
    '### ツール選択最適化方針 / Tool Optimization Policy',
    'NLOは一般のRemote Desktop Commanderとは別物である。',
    'DCのonline/offlineをNLOの稼働状態と混同しない。',
    'x'.repeat(11000),
  ].join('\n');
  assert.throws(() => validateMasterText(base), /hasNloIdentity/);
  const noBoundary = base.replace('DCのonline/offlineをNLOの稼働状態と混同しない。', '');
  assert.throws(() => validateMasterText(noBoundary), /hasDcOfflineBoundary/);
});
