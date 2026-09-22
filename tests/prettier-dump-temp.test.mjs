import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'api/admin-beta-author-invites.js',
  'tests/beta-admin-lifecycle-status-guard.test.mjs',
  'tests/secure-beta-author-invite-contract.test.mjs'
];

test('TEMP exact Prettier diffs', async () => {
  let output = '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novelight-prettier-'));

  for (const target of targets) {
    const absolute = path.join(root, target);
    const source = fs.readFileSync(absolute, 'utf8');
    const config = (await prettier.resolveConfig(absolute)) ?? {};
    const formatted = await prettier.format(source, {
      ...config,
      filepath: absolute
    });
    if (source === formatted) continue;

    const before = path.join(dir, 'before');
    const after = path.join(dir, 'after');
    fs.writeFileSync(before, source);
    fs.writeFileSync(after, formatted);

    try {
      execFileSync('diff', [
        '-u',
        '--label',
        target,
        before,
        '--label',
        `${target} (prettier)`,
        after
      ]);
    } catch (error) {
      output += `\n===== ${target} =====\n${String(error.stdout)}\n`;
    }
  }

  assert.equal(output, '', output);
});
