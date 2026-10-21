const test = require('node:test');
const { readFileSync } = require('node:fs');

test('temporary prettier output for inquiry71', async () => {
  const prettier = await import('prettier');
  const path = 'tests/e2e/specs/inquiry71-author-profile.js';
  const config = (await prettier.resolveConfig(path)) || {};
  const code = readFileSync(path, 'utf8');
  const result = await prettier.format(code, { ...config, filepath: path });
  console.log('INQUIRY71_PRETTIER_BASE64=' + Buffer.from(result, 'utf8').toString('base64'));
});
