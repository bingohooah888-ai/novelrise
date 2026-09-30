import { readFile } from 'node:fs/promises';
import { format } from 'prettier';

const source = await readFile(
  'api/_lib/thumbnail-finalize-cleanup.js',
  'utf8'
);
const formatted = await format(source, {
  filepath: 'api/_lib/thumbnail-finalize-cleanup.js',
  singleQuote: true,
  semi: true,
  tabWidth: 2,
  trailingComma: 'none',
  endOfLine: 'auto'
});
console.log('FORMAT_AUTH_CLEANUP_BEGIN');
console.log(Buffer.from(formatted, 'utf8').toString('base64'));
console.log('FORMAT_AUTH_CLEANUP_END');
