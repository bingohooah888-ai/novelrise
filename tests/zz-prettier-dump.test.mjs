import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('dump prettier output for reader-growth files', async () => {
  for (const file of [
    'api/admin-analytics.js',
    'tests/reader-growth-attribution-contract.test.mjs',
    'tests/sitemap.test.mjs'
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const config = (await resolveConfig(file)) || {};
    const parser = file.endsWith('.mjs') ? 'babel' : 'babel';
    const output = await format(source, { ...config, parser });
    console.log(`PRETTIER_DUMP_START:${file}`);
    console.log(output);
    console.log(`PRETTIER_DUMP_END:${file}`);
  }
});
