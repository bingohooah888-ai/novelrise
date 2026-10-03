import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyAssetBatch, copyAssetExact, verifyAsset } from '../src/asset-pipeline.js';
import { resolveSpawnExecutable } from '../src/processes.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK3sAAAAASUVORK5CYII=',
  'base64'
);

function config(root) {
  return {
    primary: root,
    roots: [root],
    commands: new Set(['git', 'npm', 'gh', 'supabase', 'vercel']),
    commandTimeoutMs: 30000,
    allowShell: false,
    allowDestructive: false,
    allowProduction: false,
    auditFile: '.novelight-commander/audit.jsonl',
    cacheDir: '.novelight-commander/cache'
  };
}

test('asset verify and exact copy preserve PNG bytes and geometry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-asset-'));
  const source = path.join(root, 'source.png');
  await fs.writeFile(source, onePixelPng);
  const security = config(root);
  const sourceMeta = await verifyAsset('source.png', { width: 1, height: 1, format: 'png' }, security);
  const copied = await copyAssetExact('source.png', 'assets/copied.png', { expected: sourceMeta }, security);
  assert.equal(copied.preservedExactBytes, true);
  assert.equal(copied.sha256, sourceMeta.sha256);
  assert.deepEqual(await fs.readFile(path.join(root, 'assets/copied.png')), onePixelPng);
});

test('asset batch verifies every source before publishing exact copies', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-asset-batch-'));
  await fs.writeFile(path.join(root, 'a.png'), onePixelPng);
  await fs.writeFile(path.join(root, 'b.png'), onePixelPng);
  const security = config(root);
  const result = await copyAssetBatch([
    { source: 'a.png', destination: 'assets/a.png' },
    { source: 'b.png', destination: 'assets/b.png' }
  ], security);
  assert.equal(result.count, 2);
  assert.equal(result.verified, true);
});

test('asset verification blocks mismatched expected hash before copy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-asset-hash-'));
  await fs.writeFile(path.join(root, 'source.png'), onePixelPng);
  const security = config(root);
  await assert.rejects(
    copyAssetExact('source.png', 'assets/fail.png', { expected: { sha256: '0'.repeat(64) } }, security),
    /Asset verification failed/
  );
  await assert.rejects(fs.access(path.join(root, 'assets/fail.png')));
});

test('Windows command shim resolves npm and friends without shell mode', () => {
  assert.equal(resolveSpawnExecutable('npm', 'win32'), 'npm.cmd');
  assert.equal(resolveSpawnExecutable('npx', 'win32'), 'npx.cmd');
  assert.equal(resolveSpawnExecutable('gh', 'win32'), 'gh.cmd');
  assert.equal(resolveSpawnExecutable('git', 'win32'), 'git');
  assert.equal(resolveSpawnExecutable('npm', 'linux'), 'npm');
});
