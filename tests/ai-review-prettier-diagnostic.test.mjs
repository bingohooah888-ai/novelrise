import test from 'node:test';
import { readFile } from 'node:fs/promises';
import prettier from 'prettier';

test('temporary CI formatter diagnostic', async () => {
  const file = new URL('./ai-review-migration-canonical-source.test.mjs', import.meta.url);
  const original = await readFile(file, 'utf8');
  const options = await prettier.resolveConfig(file.pathname);
  const formatted = await prettier.format(original, { ...options, filepath: file.pathname });
  if (formatted !== original) {
    console.log('AI_FORMAT_DIAGNOSTIC_BEGIN');
    console.log(formatted);
    console.log('AI_FORMAT_DIAGNOSTIC_END');
  }
});
