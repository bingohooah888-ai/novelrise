import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import prettier from 'prettier';

test('diagnose ADMIN operations Prettier delta', async () => {
  const fileUrl = new URL('../api/_lib/admin-operations.js', import.meta.url);
  const input = fs.readFileSync(fileUrl, 'utf8');
  const options = (await prettier.resolveConfig(fileUrl.pathname)) ?? {};
  const formatted = await prettier.format(input, {
    ...options,
    filepath: fileUrl.pathname
  });

  if (input === formatted) return;

  const actual = input.split('\n');
  const expected = formatted.split('\n');
  let first = 0;
  while (actual[first] === expected[first]) first += 1;
  const from = Math.max(0, first - 3);
  const to = Math.min(Math.max(actual.length, expected.length), first + 12);

  const detail = [];
  for (let index = from; index < to; index += 1) {
    detail.push(
      `${index + 1} ACTUAL  : ${actual[index] ?? '<EOF>'}`,
      `${index + 1} EXPECTED: ${expected[index] ?? '<EOF>'}`
    );
  }

  throw new Error(`Prettier first delta at line ${first + 1}\n${detail.join('\n')}`);
});
