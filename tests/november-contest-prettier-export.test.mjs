import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('temporary formatter capture for focused stage-06 CI', async () => {
  const files = [
    'tests/november-contest-guest-account-link.test.mjs',
    'tests/november-contest-reader-browser.test.mjs',
    'tests/november-contest-reader-http.test.mjs'
  ];
  for (const file of files) {
    const input = await readFile(file, 'utf8');
    const settings = (await prettier.resolveConfig(file)) || {};
    const formatted = await prettier.format(input, { ...settings, filepath: file });
    const parts = encodeURIComponent(formatted).match(/.{1,800}/gu) || [];
    for (let i = 0; i < parts.length; i += 1) {
      console.log('NOVELIGHT_FORMAT_CHUNK|' + file + '|' + i + '|' + parts[i]);
    }
    console.log('NOVELIGHT_FORMAT_END|' + file + '|' + parts.length);
  }
});
