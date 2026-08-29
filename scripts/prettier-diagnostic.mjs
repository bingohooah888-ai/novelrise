import { readFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';

const target = 'tests/production-migration-stale-run-cleanup.test.mjs';
const source = await readFile(target, 'utf8');
const config = (await resolveConfig(target)) ?? {};
const formatted = await format(source, { ...config, filepath: target });

console.log('PRETTIER_FORMAT_BEGIN');
console.log(formatted);
console.log('PRETTIER_FORMAT_END');
