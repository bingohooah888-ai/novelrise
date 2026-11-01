// NOVELIGHT AI 02-07-05 Gate A synthetic proof ONLY.
// Local filesystem atomicity is not a durable multi-host distributed claim.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const call = promisify(execFile);
const filename = fileURLToPath(import.meta.url);
const prefix = 'novelight-ai-020705-atomic-';
// prettier-ignore
const scope = Object.freeze({
  contract: 'NOVELIGHT_AI_020705_WATCHDOG_ONE_USE_V1',
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_synthetic123',
  controllerKeyId: 'synthetic-controller-key-01',
  nonce: 'A'.repeat(44),
  runId: 1001,
  approvalCommentId: 777,
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 41,
  episodeId: 11
});

// Test-only O_EXCL slot, no production or Staging service path.
// prettier-ignore
async function consume(dir, variant) {
  if (process.env.NOVELIGHT_AI_020705_OFFLINE_ONLY !== '1' ||
      !dir || typeof dir !== 'string') return false;
  try {
    const actualDir = resolve(dir);
    if (dirname(actualDir) !== await realpath(tmpdir()) ||
        actualDir !== await realpath(actualDir) ||
        !basename(actualDir).startsWith(prefix)) return false;
    const binding = {...scope, novelId: variant === 'second' ? 42 : 41};
    const digest = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
    const handle = await open(join(actualDir, digest + '.spent'), 'wx', 0o600);
    try {
      await handle.writeFile('SYNTHETIC_ONLY\n');
      await handle.sync();
    } catch {
      return false;
    } finally {
      await handle.close();
    }
    return true;
  } catch {
    return false;
  }
}

if (process.argv[2] === '--synthetic-child') {
  const consumed = await consume(process.argv[3], process.argv[4]);
  process.stdout.write(consumed ? 'CONSUMED\n' : 'DENIED\n');
} else {
  const env = { ...process.env, NOVELIGHT_AI_020705_OFFLINE_ONLY: '1' };
  // prettier-ignore
  const run = async (dir, variant = 'first') => {
    const {stdout} = await call(process.execPath, [filename, '--synthetic-child', dir, variant], {
      env, timeout: 7000
    });
    return stdout.trim();
  };

  // prettier-ignore
  test('16 external processes can consume a synthetic one-shot receipt only once',
    {timeout: 20000}, async () => {
      const dir = await mkdtemp(join(tmpdir(), prefix));
      try {
        const attempts = await Promise.all(Array.from({length: 16}, () => run(dir)));
        assert.equal(attempts.filter((x) => x === 'CONSUMED').length, 1);
        assert.equal(attempts.filter((x) => x === 'DENIED').length, 15);
        assert.equal((await readdir(dir)).length, 1);
      } finally {
        await rm(dir, {recursive: true, force: true});
      }
    });

  // prettier-ignore
  test('spent slot remains consumed after process exit; distinct scope is independent',
    {timeout: 15000}, async () => {
      const dir = await mkdtemp(join(tmpdir(), prefix));
      try {
        assert.equal(await run(dir), 'CONSUMED');
        assert.equal(await run(dir), 'DENIED');
        assert.equal(await run(dir, 'second'), 'CONSUMED');
        assert.equal(await run(dir, 'second'), 'DENIED');
        assert.equal((await readdir(dir)).length, 2);
      } finally {
        await rm(dir, {recursive: true, force: true});
      }
    });

  // prettier-ignore
  test('synthetic claim cannot escape dedicated temporary directory',
    {timeout: 12000}, async () => {
      const dir = await mkdtemp(join(tmpdir(), prefix));
      try {
        assert.equal(await run(tmpdir()), 'DENIED');
        assert.equal(await run(dir), 'CONSUMED');
      } finally {
        await rm(dir, {recursive: true, force: true});
      }
    });
}
