import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { minimalChildEnvironment, runWorkspaceBatch, validateBatch } from '../src/workspace-operation-batch.js';

test('batch validates all operations before executing anything', async () => {
  let invoked = 0;
  await assert.rejects(runWorkspaceBatch({
    repoRoot: path.resolve('.'),
    steps: [{ op: 'process.node' }, { op: 'powershell.version', command: 'arbitrary' }],
    run: async () => { invoked++; return { success: true, stdout: 'v20.0.0' }; }
  }), /NLO_BATCH_DENIED/);
  assert.equal(invoked, 0);
  for (const steps of [
    [], Array.from({ length: 9 }, () => ({ op: 'git.head' })),
    [{ op: 'git.object', sha: '--help' }], [{ op: 'runtime.match', module: '../secret', sha256: 'a'.repeat(64) }],
    [{ op: 'browser.available', url: 'https://example.invalid' }],
    [{ op: 'shell.exec' }], [{ op: 'file.write' }]
  ]) assert.throws(() => validateBatch(steps), /NLO_BATCH_DENIED/);
});

test('minimal child environment does not inherit credentials or code injection settings', () => {
  const source = { PATH: 'trusted-path', TEMP: 'tmp', HOME: 'home',
    NOVELIGHT_BRIDGE_GITHUB_TOKEN: 'synthetic', SUPABASE_ACCESS_TOKEN: 'synthetic',
    VERCEL_TOKEN: 'synthetic', NODE_OPTIONS: '--require=bad', GIT_CONFIG_COUNT: '1',
    HTTP_PROXY: 'synthetic', NPM_CONFIG_USERCONFIG: 'synthetic' };
  const result = minimalChildEnvironment(source);
  assert.equal(result.PATH, 'trusted-path');
  for (const k of Object.keys(source).filter(k => k !== 'PATH' && k !== 'TEMP'))
    assert.equal(Object.hasOwn(result, k), false);
  assert.equal(result.GIT_NO_LAZY_FETCH, '1');
});

test('one batch returns only bounded metadata, not unexpected command output', async () => {
  const h = 'a'.repeat(40);
  const result = await runWorkspaceBatch({
    repoRoot: path.resolve('.'),
    steps: [{ op: 'git.object', sha: h }, { op: 'git.head' },
      { op: 'process.node' }, { op: 'browser.available' }],
    run: async (file, args) => ({ success: true,
      stdout: args.includes('cat-file') ? 'commit' :
        args.includes('rev-parse') ? h : 'unexpected local data' }),
    browser: async () => ({ available: true })
  });
  assert.deepEqual(result.results, [{ op: 'git.object', exists: true },
    { op: 'git.head', available: true, head: h },
    { op: 'process.node', available: false }, { op: 'browser.available', available: true }]);
  assert.equal(result.mutationPerformed, false);
});
