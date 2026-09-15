import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import prettier from 'prettier';

test('dump canonical Production Auth hook control test formatting', async () => {
  const target = new URL(
    './production-prereg-auth-hook-control-contract.test.mjs',
    import.meta.url
  );
  const source = fs.readFileSync(target, 'utf8');
  const config = await prettier.resolveConfig(target.pathname);
  const formatted = await prettier.format(source, {
    ...config,
    filepath: target.pathname
  });
  console.log('PRETTIER_DUMP_BEGIN');
  console.log(formatted);
  console.log('PRETTIER_DUMP_END');
});
