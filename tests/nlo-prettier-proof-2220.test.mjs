// TEMPORARY: print Prettier's exact output in CI; remove before final review.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('temporary NOVELIGHT formatter proof 2220', async () => {
  const source = readFileSync(new URL('./novelight-pr-auto-sync.test.mjs', import.meta.url), 'utf8');
  const formatted = await prettier.format(source, { filepath: 'tests/novelight-pr-auto-sync.test.mjs' });
  console.log('NLO_PRETTIER_2220_BEGIN:' + Buffer.from(formatted, 'utf8').toString('base64') + ':NLO_PRETTIER_2220_END');
});
