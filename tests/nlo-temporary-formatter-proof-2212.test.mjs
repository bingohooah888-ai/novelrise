import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

test('NLO one-time formatter proof for PR 2212', async () => {
  const target = new URL('novelight-pr-auto-sync.test.mjs', import.meta.url);
  const source = await readFile(target, 'utf8');
  const config = await prettier.resolveConfig(target.pathname);
  const formatted = await prettier.format(source, {
    ...config,
    filepath: target.pathname
  });
  console.log('NLO_FORMAT_PROOF_2212:' + JSON.stringify(formatted));
});
