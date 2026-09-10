import fs from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

const paths = [
  'api/admin-beta-authors.js',
  'tests/e2e/specs/beta-author-preregistration.spec.js'
];

test('dump preregistration prettier output', async () => {
  for (const path of paths) {
    const source = fs.readFileSync(path, 'utf8');
    const formatted = await prettier.format(source, { parser: 'babel' });
    console.log(`PRETTIER_DUMP_START:${path}`);
    console.log(Buffer.from(formatted, 'utf8').toString('base64'));
    console.log(`PRETTIER_DUMP_END:${path}`);
  }
});
