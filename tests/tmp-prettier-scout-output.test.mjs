import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format } from 'prettier';

test('print exact formatted SCOUT session test', async () => {
  const source = readFileSync(
    'tests/scout-record-session-stabilizer.test.mjs',
    'utf8'
  );
  const formatted = await format(source, {
    filepath: 'tests/scout-record-session-stabilizer.test.mjs',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none',
    endOfLine: 'auto'
  });
  console.log('PRETTIER_SCOUT_BEGIN');
  console.log(formatted);
  console.log('PRETTIER_SCOUT_END');
});