import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('emit exact formatted review test for temporary style inspection', async () => {
  const file = 'tests/community-reviewed-main-integration.test.mjs';
  const config = await prettier.resolveConfig(file);
  const formatted = await prettier.format(readFileSync(file, 'utf8'), {
    ...config,
    filepath: file
  });
  console.log('REVIEW_FORMAT_START ' + JSON.stringify(formatted) + ' REVIEW_FORMAT_END');
});
