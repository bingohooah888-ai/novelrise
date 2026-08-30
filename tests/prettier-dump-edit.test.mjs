import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('dump formatted edit browser coverage', async () => {
  const source = await readFile(
    'tests/e2e/specs/edit-existing-content.js',
    'utf8'
  );
  const formatted = await prettier.format(source, {
    parser: 'babel',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  console.log('PRETTIER_EDIT_DUMP_START');
  console.log(formatted);
  console.log('PRETTIER_EDIT_DUMP_END');
});
