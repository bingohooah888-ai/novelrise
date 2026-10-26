import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('NLO MASTER preparation preserves UTF-8 content across chunks', () => {
  const filename = fileURLToPath(
    new URL('../tools/novelight-commander/checks/master-sync.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, ['--test', filename], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
