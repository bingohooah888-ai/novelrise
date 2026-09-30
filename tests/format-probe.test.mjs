import { readFile } from 'node:fs/promises';
import { format } from 'prettier';

const source = await readFile('tests/thumbnail-finalize-cleanup.test.mjs', 'utf8');
const formatted = await format(source, {
  filepath: 'tests/thumbnail-finalize-cleanup.test.mjs',
  singleQuote: true,
  semi: true,
  tabWidth: 2,
  trailingComma: 'none',
  endOfLine: 'auto'
});
console.log('FORMAT_PROBE_BEGIN');
console.log(Buffer.from(formatted, 'utf8').toString('base64'));
console.log('FORMAT_PROBE_END');
