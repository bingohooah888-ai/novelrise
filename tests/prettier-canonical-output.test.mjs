import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

for (const path of [
  'tests/execution-turn-card-gate.test.mjs',
  'tests/work-execution-preflight.test.mjs'
]) {
  test(`print canonical prettier output for ${path}`, async () => {
    const source = await readFile(path, 'utf8');
    const config = (await prettier.resolveConfig(path)) ?? {};
    const formatted = await prettier.format(source, { ...config, filepath: path });
    console.log(`PRETTIER_BEGIN:${path}`);
    console.log(Buffer.from(formatted, 'utf8').toString('base64'));
    console.log(`PRETTIER_END:${path}`);
  });
}
