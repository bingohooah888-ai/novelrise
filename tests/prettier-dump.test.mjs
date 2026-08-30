import { readFile } from 'node:fs/promises';
import prettier from 'prettier';

const path = 'tests/beta-p0-release.test.mjs';
const source = await readFile(path, 'utf8');
const config = (await prettier.resolveConfig(path)) ?? {};
const formatted = await prettier.format(source, { ...config, filepath: path });
const start = formatted.indexOf("test('publish path requires");
const end = formatted.indexOf("test('moderation route", start);
console.log('PRETTIER_TARGET_START');
console.log(formatted.slice(start, end));
console.log('PRETTIER_TARGET_END');
