import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

test('prints repository-formatted staging billing reconcile test', async () => {
  const targetUrl = new URL(
    './staging-billing-reconcile-api.test.js',
    import.meta.url
  );
  const source = await readFile(targetUrl, 'utf8');
  const formatted = await prettier.format(source, {
    filepath: targetUrl.pathname
  });

  console.log('PRETTIER_PROBE_BEGIN');
  console.log(formatted);
  console.log('PRETTIER_PROBE_END');
});
