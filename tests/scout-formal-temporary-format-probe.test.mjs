import test from 'node:test';
import { readFileSync } from 'node:fs';
import prettier from 'prettier';

test('temporary formatter output for Scout XP formal integration', async () => {
  for (const path of [
    'api/_lib/reader-reward/formal-usage-offline-repository.js',
    'tests/reader-reward-formal-cutover-offline.test.mjs'
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
