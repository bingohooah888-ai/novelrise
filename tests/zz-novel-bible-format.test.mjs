import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('temporary format exact Novel Bible files', async () => {
  for (const path of [
    'api/_lib/ai/novel-bible.js',
    'tests/ai-novel-bible.test.mjs'
  ]) {
    const options = (await resolveConfig(path)) || {};
    const formatted = await format(readFileSync(path, 'utf8'), {
      ...options,
      filepath: path
    });
    console.log(
      'NOVEL_BIBLE_PRETTIER:' + path + ':' + Buffer.from(formatted).toString('base64')
    );
  }
});
