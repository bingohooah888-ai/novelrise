import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('prints configured Prettier output for series contract', async () => {
  const filepath = 'tests/novel-series-contract.test.mjs';
  const source = await readFile(filepath, 'utf8');
  const config = (await prettier.resolveConfig(filepath)) || {};
  const formatted = await prettier.format(source, { ...config, filepath });
  console.log(`__PRETTIER_CONFIGURED_START__\n${formatted}__PRETTIER_CONFIGURED_END__`);
});
