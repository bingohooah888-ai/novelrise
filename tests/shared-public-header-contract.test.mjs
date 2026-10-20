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

test('workspace headers share the approved Home logo at first paint', () => {
  const logo = read('shared/header/public-header.html').match(
    /<a class="logo"[^>]*>[\s\S]*?<\/a>/u
  )?.[0];
  assert.ok(logo);
  assert.equal(manifest.workspaceManaged.length, 20);
  for (const page of manifest.workspaceManaged) {
    const html = read(page);
    const header = html.match(
      /<header>\s*<div class="header-inner">[\s\S]*?<\/div>\s*<\/header>/u
    )?.[0];
    assert.ok(header, page);
    assert.ok(header.includes(logo), page);
    assert.match(header, /<a\b[^>]*class="back"[^>]*>/u, page);
  }
});

test('workspace managed pages cannot overlap dedicated layouts', () => {
  const workspace = new Set(manifest.workspaceManaged);
  for (const page of manifest.managed) {
    assert.ok(!workspace.has(page), page);
  }
  for (const page of Object.keys(manifest.custom)) {
    assert.ok(!workspace.has(page), page);
  }
  for (const pages of Object.values(manifest.separateLayouts)) {
    for (const page of pages) {
      assert.ok(!workspace.has(page), page);
    }
  }
  assert.ok(!workspace.has('scout-lv10-campaign.html'));
  assert.ok(!workspace.has('mypage.html'));
  assert.ok(!workspace.has('admin.html'));
});

test('specialist brand pages are tracked and keep local links', () => {
  const groups = manifest.brandManaged;
  assert.equal(groups.admin.length, 14);
  assert.equal(groups.reader.length, 1);
  assert.equal(groups.help.length, 1);
  assert.equal(groups.studio.length, 1);
  for (const page of groups.admin) {
    assert.match(read(page), /class="nl-admin-brand-link"/u);
  }
  assert.match(read('admin.html'), /href="admin-analytics\.html"/u);
  assert.match(read('reading-history.html'), /href="favorites\.html"/u);
  assert.match(read('help.html'), /nl-help-page-back/u);
});
