const { readFile } = require('node:fs/promises');
const test = require('node:test');

test('dump exact Prettier output for star rating test', async () => {
  const prettier = await import('prettier');
  const input = await readFile('tests/tmp-star-rating-format-input.txt', 'utf8');
  const output = await prettier.format(input, {
    parser: 'babel',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  console.log('PRETTIER_OUTPUT_START');
  console.log(output);
  console.log('PRETTIER_OUTPUT_END');
});
