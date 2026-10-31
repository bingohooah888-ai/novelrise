import { readFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import test from 'node:test';

test('temporary formatter capture for pinned staging tests', async () => {
  const filepath = 'tests/staging-follow-list-pinned.test.mjs';
  const original = readFileSync(filepath, 'utf8');
  const options = await resolveConfig(filepath);
  const formatted = await format(original, { ...options, filepath });
  console.log('FOLLOW_STAGING_FORMAT_BASE64=' +
    Buffer.from(formatted, 'utf8').toString('base64'));
});
