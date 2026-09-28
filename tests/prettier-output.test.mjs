import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('capture provenance test formatting', async () => {
  const path = 'tests/e2e/production-auth/novel-document-provenance.spec.js';
  const input = await readFile(path, 'utf8');
  const config = await resolveConfig(path);
  const output = await format(input, { ...config, filepath: path });
  console.error(`\n---PRETTIER_OUTPUT---\n${output}---END_PRETTIER_OUTPUT---`);
});
