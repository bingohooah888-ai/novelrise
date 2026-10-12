import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('diagnose Prettier formatting for build guard test', async () => {
  const path = new URL('./vercel-ignore-build.test.mjs', import.meta.url);
  const source = readFileSync(path, 'utf8');
  const formatted = await prettier.format(source, {
    filepath: 'tests/vercel-ignore-build.test.mjs'
  });
  console.log('NOVELIGHT_PRETTIER_FORMAT_BEGIN');
  console.log(formatted);
  console.log('NOVELIGHT_PRETTIER_FORMAT_END');
});
