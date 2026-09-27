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

test('MASTER validation requires NLO/DC separation rules', () => {
  const text = [
    '# NOVELIGHT MASTER',
    '最終更新：2026年9月26日',
    '34. NLO / DC 絶対分離ルール',
    'NLO = NOVELIGHT Commander',
    'DC = Remote Desktop Commander / Desktop Commander',
    'x'.repeat(11000)
  ].join('\n');
  const result = validateMasterText(text);
  assert.equal(result.hasNloDcSection, true);
  assert.equal(result.hasNloIdentity, true);
  assert.equal(result.hasDcIdentity, true);
});

test('MASTER validation rejects content without the NLO/DC section', () => {
  const text = [
    '# NOVELIGHT MASTER',
    '最終更新：2026年9月26日',
    'NLO = NOVELIGHT Commander',
    'DC = Remote Desktop Commander / Desktop Commander',
    'x'.repeat(11000)
  ].join('\n');
  assert.throws(() => validateMasterText(text), /hasNloDcSection/);
});
