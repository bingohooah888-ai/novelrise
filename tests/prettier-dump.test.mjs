import { readFile } from 'node:fs/promises';
import prettier from 'prettier';

const path = 'tests/beta-p0-release.test.mjs';
const source = await readFile(path, 'utf8');
const config = (await prettier.resolveConfig(path)) ?? {};
const formatted = await prettier.format(source, { ...config, filepath: path });
console.log(`PRETTIER_OUTPUT_BASE64=${Buffer.from(formatted).toString('base64')}`);
