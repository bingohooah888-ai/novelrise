#!/usr/bin/env node
/* New root HTML pages cannot silently fork the Home header or default to navy. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(join(root, file), 'utf8');
const { established } = JSON.parse(read('shared/page/preexisting-root-html.json'));
const manifest = JSON.parse(read('shared/header/manifest.json'));
const legacy = new Set(established);
const added = readdirSync(root).filter(name => name.endsWith('.html') && !legacy.has(name));
const separate = new Set([
  ...manifest.workspaceManaged,
  ...Object.values(manifest.brandManaged).flat(),
  ...Object.values(manifest.separateLayouts).flat()
]);
for (const page of added) {
  if (manifest.publicPageThemeExceptions[page]) continue;
  if (manifest.custom[page] || separate.has(page)) {
    throw new Error(page + ': document this new special layout in publicPageThemeExceptions');
  }
  if (!manifest.managed.includes(page)) {
    throw new Error(page + ': register new public page in shared/header/manifest.json');
  }
  const html = read(page);
  for (const required of [
    'novelight-public-header-page',
    'novelight-public-ivory',
    '/shared/page/public-ivory.css',
    'novelight-client.js',
    'data-novelight-shared-header="true"'
  ]) {
    if (!html.includes(required)) {
      throw new Error(page + ': missing common new-page requirement: ' + required);
    }
  }
  if (html.includes('novelight-public-dark')) {
    throw new Error(page + ': dark background needs an explicit documented exception');
  }
}
console.log('New public-page header and ivory standards checked: ' + added.length);
