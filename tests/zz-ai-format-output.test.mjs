import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('AI-only CI formatter diagnostic (temporary)', async () => {
  const paths = [
    'api/_lib/ai/context.js',
    'api/_lib/ai/providers.js',
    'api/_lib/ai/router.js',
    'tests/ai-foundation.test.mjs'
  ];
  for (const path of paths) {
    const options = (await resolveConfig(path)) || {};
    const current = readFileSync(path, 'utf8');
    const formatted = await format(current, { ...options, filepath: path });
    console.log(`NOVELIGHT_AI_FORMAT:${path}:${Buffer.from(formatted).toString('base64')}`);
  }
});
