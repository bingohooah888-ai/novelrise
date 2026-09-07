import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['api', 'scripts'];
const extensions = new Set(['.js', '.mjs']);

function collectFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) return extensions.has(extname(path)) ? [path] : [];

  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => collectFiles(join(path, entry.name)))
    .sort();
}

const rootFiles = readdirSync('.', { withFileTypes: true })
  .filter((entry) => entry.isFile() && extensions.has(extname(entry.name)))
  .map((entry) => entry.name)
  .sort();
const files = [...rootFiles, ...roots.flatMap(collectFiles)].sort();
if (files.length === 0) {
  throw new Error('No JavaScript files were found for syntax checking.');
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
