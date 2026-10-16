import test from 'node:test';
import { readFileSync } from 'node:fs';
import prettier from 'prettier';

test('temporary community-admin formatting probe', async () => {
  const url = new URL('./e2e/specs/community-admin-ui.js', import.meta.url);
  const raw = readFileSync(url, 'utf8');
  const config = (await prettier.resolveConfig(url.pathname)) || {};
  const formatted = await prettier.format(raw, {
    ...config,
    filepath: url.pathname
  });
  console.log('NL_FORMAT_PROBE_BEGIN');
  console.log(formatted);
  console.log('NL_FORMAT_PROBE_END');
});
