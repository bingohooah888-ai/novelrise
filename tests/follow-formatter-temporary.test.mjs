import { readFileSync } from 'node:fs';
import { format } from 'prettier';
import test from 'node:test';

test('temporary formatter proof for following browser test', async () => {
  const path = 'tests/e2e/specs/following-ux.js';
  const actual = readFileSync(path, 'utf8');
  const formatted = await format(actual, { filepath: path });
  const encoded = Buffer.from(formatted, 'utf8').toString('base64');
  console.log('FOLLOW_UX_FORMAT_BASE64=' + encoded);
});
