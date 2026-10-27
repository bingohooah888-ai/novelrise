import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('Temporary NOVELIGHT AI formatting capture (remove before final CI)', async () => {
  for (const path of [
    'api/_lib/ai/supabase-store.js',
    'tests/ai-supabase-store.test.mjs'
  ]) {
    const options = (await resolveConfig(path)) || {};
    const source = readFileSync(path, 'utf8');
    const result = await format(source, { ...options, filepath: path });
    console.log(`NOVELIGHT_AI_FORMAT:${path}:${Buffer.from(result).toString('base64')}`);
  }
});
