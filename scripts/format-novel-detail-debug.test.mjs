import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import prettier from 'prettier';

test('dump formatted E2E regression source for reproducible CI', async () => {
  const target = fileURLToPath(new URL('../tests/e2e/specs/novel-owner-detail-render.spec.js', import.meta.url));
  const source = readFileSync(target, 'utf8');
  const options = (await prettier.resolveConfig(target)) || {};
  const formatted = await prettier.format(source, { ...options, filepath: target });
  console.log('NOVELIGHT_FORMAT_BEGIN');
  console.log(Buffer.from(formatted).toString('base64'));
  console.log('NOVELIGHT_FORMAT_END');
});
