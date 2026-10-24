// Build a byte-equivalent Home-only flattening of the existing theme CSS imports.
// Run node scripts/build-home-theme-bundle.mjs --write after changing theme CSS.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../index.html', import.meta.url)));
const target = resolve(root, 'novelight-home-theme-bundle.css');
const importPattern = /^@import url\("([^"]+)"\);[ \t]*\r?\n/gm;

export function buildHomeThemeBundle() {
  const active = new Set();
  const expand = (file) => {
    if (!/^[a-z0-9-]+\.css$/i.test(file))
      throw new Error('Unexpected CSS import: ' + file);
    if (active.has(file)) throw new Error('Circular CSS import: ' + file);
    active.add(file);
    const source = readFileSync(resolve(root, file), 'utf8');
    const flattened = source.replace(importPattern, (_, imported) => {
      return '/* bundled: ' + imported + ' */\n' + expand(imported) + '\n';
    });
    active.delete(file);
    return flattened;
  };
  return '/* GENERATED: node scripts/build-home-theme-bundle.mjs --write */\n' +
    expand('novelight-theme.css');
}

if (process.argv.includes('--write')) {
  writeFileSync(target, buildHomeThemeBundle());
} else if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== buildHomeThemeBundle()) {
    console.error('Home theme CSS bundle is out of date.');
    process.exitCode = 1;
  }
}
