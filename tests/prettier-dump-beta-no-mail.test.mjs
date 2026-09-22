import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

const targets = [
  'tests/e2e/specs/async-ui-core.js',
  'tests/production-auth-beta-email-mode.test.mjs',
  'production-approval-ledger.json',
  '.github/workflows/production-auth-beta-email-mode.yml'
];

test('dump Prettier output for beta no-mail remediation', async () => {
  for (const path of targets) {
    const source = await readFile(path, 'utf8');
    const formatted = await prettier.format(source, { filepath: path });
    const encoded = Buffer.from(formatted, 'utf8').toString('base64');
    console.log(`PRETTIER_DUMP_START ${path}`);
    for (let offset = 0; offset < encoded.length; offset += 6000) {
      console.log(encoded.slice(offset, offset + 6000));
    }
    console.log(`PRETTIER_DUMP_END ${path}`);
  }
});
