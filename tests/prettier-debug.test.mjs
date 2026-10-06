import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { format } from 'prettier';

test('print formatted announcement improvement test for branch repair', async () => {
  const target = path.resolve(
    import.meta.dirname,
    'announcement-contact-improvements.test.mjs'
  );
  const source = fs.readFileSync(target, 'utf8');
  const formatted = await format(source, {
    filepath: target,
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none',
    endOfLine: 'lf'
  });
  console.log('PRETTIER_BASE64_START');
  console.log(Buffer.from(formatted, 'utf8').toString('base64'));
  console.log('PRETTIER_BASE64_END');
});
