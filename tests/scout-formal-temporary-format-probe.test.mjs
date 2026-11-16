import test from 'node:test';
import { readFileSync } from 'node:fs';
import prettier from 'prettier';

test('temporary owner-approved Lv100 formatting probe', async () => {
  for (const path of [
    'tests/reader-reward-formal-level100-owner-policy.test.mjs',
    'tests/reader-reward-formal-xp-cutover.test.mjs'
  ]) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const formatted = await prettier.format(source, {
      parser: 'babel',
      singleQuote: true,
      semi: true,
      tabWidth: 2,
      trailingComma: 'none',
      endOfLine: 'lf'
    });
    console.log('SCOUT_FORMAT_PROBE:' + JSON.stringify({ path, formatted }));
  }
});
