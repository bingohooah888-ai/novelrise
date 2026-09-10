import fs from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import prettier from 'prettier';

const paths = [
  'api/admin-beta-authors.js',
  'tests/e2e/specs/beta-author-preregistration.spec.js'
];

test('dump preregistration prettier output with repository config', async () => {
  for (const path of paths) {
    const source = fs.readFileSync(path, 'utf8');
    const config = (await prettier.resolveConfig(path)) ?? {};
    const formatted = await prettier.format(source, {
      ...config,
      filepath: path
    });
    console.log(`PRETTIER_REPO_GZIP_START:${path}`);
    console.log(gzipSync(Buffer.from(formatted, 'utf8')).toString('base64'));
    console.log(`PRETTIER_REPO_GZIP_END:${path}`);
  }
});
