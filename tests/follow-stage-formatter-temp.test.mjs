import { readFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import test from 'node:test';

test('temporary follow stage code formatter reference', async () => {
  for (const filepath of [
    'tests/follow-stage-proof-admission.test.mjs',
    'tests/e2e/staging/follow-live-runner.mjs'
  ]) {
    const source = readFileSync(filepath, 'utf8');
    const options = await resolveConfig(filepath);
    const formatted = await format(source, { ...options, filepath });
    console.log('STAGE_FORMAT_RESULT ' + filepath + ' ' +
      Buffer.from(formatted, 'utf8').toString('base64'));
  }
});
