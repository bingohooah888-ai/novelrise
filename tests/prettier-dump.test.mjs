import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('dump formatted remediation endpoint', async () => {
  const source = await readFile('api/production-billing-remediate.js', 'utf8');
  const formatted = await prettier.format(source, { parser: 'babel', singleQuote: true });
  console.log('PRETTIER_DUMP_START');
  console.log(formatted);
  console.log('PRETTIER_DUMP_END');
});
