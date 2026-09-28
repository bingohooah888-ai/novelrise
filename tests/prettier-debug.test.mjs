import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

const paths = [
  'api/_lib/thumbnail-render.js',
  'tests/e2e/repair-production-thumbnail-renders.mjs',
  'tests/thumbnail-render-resilience.test.mjs'
];

test('emit exact Prettier output for thumbnail resilience files', async () => {
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    const formatted = await prettier.format(source, {
      filepath: path,
      singleQuote: true,
      semi: true,
      tabWidth: 2,
      trailingComma: 'none',
      endOfLine: 'auto'
    });
    console.log(`PRETTIER_BEGIN:${path}`);
    console.log(Buffer.from(formatted, 'utf8').toString('base64'));
    console.log(`PRETTIER_END:${path}`);
  }
});
