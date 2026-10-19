import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (file) =>
  readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const manifest = JSON.parse(read('shared/header/manifest.json'));

test('shared header has no sync drift', () => {
  const run = spawnSync(
    process.execPath,
    ['scripts/sync-public-header.mjs', '--check'],
    { encoding: 'utf8' }
  );
  assert.equal(run.status, 0, run.stderr?.toString());
});

test('public pages have pre-rendered canonical headers', () => {
  assert.ok(manifest.managed.length >= 27);
  for (const file of manifest.managed) {
    const html = read(file);
    assert.match(html, /<header class="site-header">/u);
    assert.match(html, /data-novelight-shared-header="true"/u);
  }
});

test('special pages keep their independent headers', () => {
  assert.ok(manifest.custom['scout-lv10-campaign.html']);
  assert.ok(!manifest.managed.includes('scout-lv10-campaign.html'));
  assert.ok(manifest.custom['help.html']);
});

test('SEO templates remain identical to root shells', () => {
  for (const name of ['novel', 'episode']) {
    const root = read(name + '.html');
    const seo = read('api/seo/templates/' + name + '.html');
    assert.equal(root, seo);
  }
});

test('specific navigation labels survive synchronization', () => {
  for (const name of ['author-features', 'reader-features']) {
    const html = read(name + '.html');
    assert.match(html, /aria-label="NOVELIGHT ホーム"/u);
  }
});

test('Vercel keeps existing deployment configuration', () => {
  const deploy = JSON.parse(read('vercel.json'));
  assert.equal(deploy.buildCommand, undefined);
  assert.equal(deploy.outputDirectory, undefined);
});

test('local watcher refreshes generated HTML when the source changes', () => {
  const script = read('scripts/sync-public-header.mjs');
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(
    packageJson.scripts['header:watch'],
    'node scripts/sync-public-header.mjs --watch'
  );
  assert.match(script, /watch\(directory,/u);
  assert.match(script, /name !== 'public-header\.html'/u);
  assert.match(script, /name !== 'manifest\.json'/u);
  assert.match(script, /\[fileURLToPath\(import\.meta\.url\), '--write'\]/u);
});
