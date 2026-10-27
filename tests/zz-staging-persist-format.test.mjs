import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('temporary persistent Staging gate formatter output', async () => {
  const paths = ['tests/staging-candidate-persist.test.mjs'];
  for (const path of paths) {
    const options = (await resolveConfig(path)) || {};
    const content = await format(readFileSync(path, 'utf8'), {
      ...options, filepath: path
    });
    console.log('STAGING_PERSIST_FORMAT:' + path + ':' +
      Buffer.from(content).toString('base64'));
  }
});
