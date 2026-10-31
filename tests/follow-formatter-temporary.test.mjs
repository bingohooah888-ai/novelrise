import { readFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import test from 'node:test';

test('temporary following browser formatter proof', async () => {
  const filepath = 'tests/e2e/specs/following-ux.js';
  const original = readFileSync(filepath, 'utf8');
  const options = await resolveConfig(filepath);
  const formatted = await format(original, { ...options, filepath });
  console.log('FOLLOW_FORMAT_RESULT_BASE64=' +
    Buffer.from(formatted, 'utf8').toString('base64'));
});
