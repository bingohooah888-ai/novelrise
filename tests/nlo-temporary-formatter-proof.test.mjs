import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import * as prettier from 'prettier';

test('Temporary exact Prettier proof for PR-sync contracts', async () => {
  for (const filepath of [
    'tests/novelight-pr-auto-sync.test.mjs',
    'tests/novelight-pr-sync-dispatch-guard.test.mjs'
  ]) {
    const contents = readFileSync(new URL('../' + filepath, import.meta.url), 'utf8');
    const options = { ...(await prettier.resolveConfig(filepath)), filepath };
    const formatted = await prettier.format(contents, options);
    console.log('NLO_FORMAT_PROOF:' + filepath + ':' + JSON.stringify(formatted));
  }
});
