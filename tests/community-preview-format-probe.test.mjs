import test from 'node:test';
import { readFile } from 'node:fs/promises';
import prettier from 'prettier';

test('temporary exact Prettier inspection for the community preview test', async () => {
  const path = 'tests/community-preview-admission.test.mjs';
  const source = await readFile(path, 'utf8');
  const expected = await prettier.format(source, {
    filepath: path,
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  console.log('COMMUNITY_FORMAT_EXPECTED_BASE64 ' + Buffer.from(expected).toString('base64'));
});
