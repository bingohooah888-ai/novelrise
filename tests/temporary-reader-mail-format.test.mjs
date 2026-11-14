import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';

test('temporary formatting evidence for proposed Staging mailbox proof', async () => {
  const files = [
    'tests/e2e/staging/reader-scout-confirmation-mailbox.mjs',
    'tests/reader-scout-onboarding-offline.test.mjs'
  ];
  for (let index = 0; index < files.length; index++) {
    const path = files[index];
    const opts = (await prettier.resolveConfig(path)) || {};
    const normalized = await prettier.format(readFileSync(path, 'utf8'), {
      ...opts,
      filepath: path
    });
    const encoded = Buffer.from(normalized).toString('base64');
    for (let pos = 0, chunk = 0; pos < encoded.length; pos += 1400, chunk++) {
      console.log('READER_MAIL_FMT|' + index + '|' + chunk + '|' + encoded.slice(pos, pos + 1400));
    }
  }
});
