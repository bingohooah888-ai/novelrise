import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('temporary Staging gate Prettier formatter capture', async () => {
  const paths = [
    '.github/workflows/staging-candidate-db-rollback-check.yml',
    'tests/staging-candidate-db-gate.test.mjs'
  ];
  for (const path of paths) {
    const options = (await resolveConfig(path)) || {};
    const result = await format(readFileSync(path, 'utf8'), {
      ...options, filepath: path
    });
    console.log(`STAGING_PRETTIER:${path}:${Buffer.from(result).toString('base64')}`);
  }
});
