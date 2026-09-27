import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentMasterFileName,
  isMasterCandidateFileName,
  validateMasterText
} from '../src/master-sync.js';

test('MASTER filename matcher only accepts NOVELIGHT MASTER candidates', () => {
  assert.equal(isMasterCandidateFileName('NOVELIGHT-MASTER.txt'), true);
  assert.equal(isMasterCandidateFileName('NOVELIGHT-MASTER-CURRENT-abcd.md'), true);
  assert.equal(isMasterCandidateFileName('novelight-master_old.txt'), true);
  assert.equal(isMasterCandidateFileName('README.md'), false);
  assert.equal(isMasterCandidateFileName('MY-NOVELIGHT-MASTER.txt'), false);
});

test('current MASTER filename pins both main SHA and content SHA', () => {
  const mainSha = 'a'.repeat(40);
  const contentSha = 'b'.repeat(64);
  assert.equal(
    currentMasterFileName(mainSha, contentSha),
    'NOVELIGHT-MASTER-CURRENT-aaaaaaaaaaaa-bbbbbbbbbbbb.md'
  );
});

test('MASTER validation accepts the canonical NLO First Policy wording', () => {
  const text = [
    '# NOVELIGHT MASTER',
    '最終更新：2026年9月26日',
    '### ツール利用優先順位 / NLO First Policy',
    'NLOは、従来「NOVELIGHT Commander」と呼んでいたNOVELIGHT専用ツールの正式名称とする。',
    'NLOは一般のRemote Desktop Commanderとは別物であり、両者を混同しない。',
    'Remote Desktop Commanderのdeviceが `offline` であっても、それだけを理由にNLOを `offline`、未接続、使用不能と判定してはならない。',
    'x'.repeat(11000)
  ].join('\n');
  const result = validateMasterText(text);
  assert.equal(result.hasNloDcSection, true);
  assert.equal(result.hasNloIdentity, true);
  assert.equal(result.hasDcIdentity, true);
  assert.equal(result.hasDcOfflineBoundary, true);
});

test('MASTER validation remains compatible with the explicit NLO/DC separation wording', () => {
  const text = [
    '# NOVELIGHT MASTER',
    '最終更新：2026年9月26日',
    'NLO / DC 絶対分離ルール',
    'NLO = NOVELIGHT Commander',
    'DC = Remote Desktop Commander / Desktop Commander',
    '- DCのオンライン / オフライン',
    'x'.repeat(11000)
  ].join('\n');
  const result = validateMasterText(text);
  assert.equal(result.hasNloDcSection, true);
  assert.equal(result.hasNloIdentity, true);
  assert.equal(result.hasDcIdentity, true);
  assert.equal(result.hasDcOfflineBoundary, true);
});

test('MASTER validation rejects content without an NLO/DC separation policy', () => {
  const text = [
    '# NOVELIGHT MASTER',
    '最終更新：2026年9月26日',
    'NLO is a tool.',
    'x'.repeat(11000)
  ].join('\n');
  assert.throws(() => validateMasterText(text), /hasNloDcSection/);
});
