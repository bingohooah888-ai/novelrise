import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  currentMasterFileName,
  isMasterCandidateFileName,
  validateMasterText,
  prepareLatestMaster
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

test('prepared MASTER preserves exact UTF-8 bytes and stable SHA-256', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-master-utf8-'));
  try {
    const repo = path.join(root, 'repo');
    const remote = path.join(root, 'remote.git');
    const data = path.join(root, 'data');
    await fs.mkdir(repo, { recursive: true });
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
    git(root, 'init', '--bare', remote);
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.name', 'NLO Test');
    git(repo, 'config', 'user.email', 'nlo-test@example.invalid');
    await fs.mkdir(path.join(repo, 'docs'));
    const text = [
      '# NOVELIGHT MASTER',
      '最終更新：2026年10月27日',
      '### ツール選択最適化方針 / Tool Optimization Policy',
      'NLO = NOVELIGHT Commander',
      'NLOは一般のRemote Desktop Commanderとは別物である。',
      'DCのonline/offlineをNLOの稼働状態と混同しない。',
      '日本語を含むUTF-8の読み込み境界を検証する。'.repeat(20000),
      ''
    ].join('\n');
    await fs.writeFile(path.join(repo, 'docs', 'NOVELIGHT-MASTER.md'), text, 'utf8');
    git(repo, 'add', 'docs/NOVELIGHT-MASTER.md');
    git(repo, 'commit', '-m', 'Add test MASTER');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', 'origin', 'main');
    const expected = createHash('sha256').update(text, 'utf8').digest('hex');
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const prepared = await prepareLatestMaster({ repoRoot: repo, dataRoot: data });
      assert.equal(prepared.contentSha256, expected);
      assert.equal(await fs.readFile(prepared.file, 'utf8'), text);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
