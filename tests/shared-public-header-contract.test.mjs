import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (name) =>
  readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const manifest = JSON.parse(read('shared/header/manifest.json'));
const header = read('shared/header/public-header.html');

test('single source-of-truth public header is materialized before first paint', () => {
  const result = spawnSync(process.execPath, ['scripts/sync-public-header.mjs', '--check'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(header, /<header class="site-header">/u);
  assert.match(header, /public-header-inner/u);
  assert.match(header, /class="header-actions"/u);
  assert.ok(manifest.managed.length >= 20);
});

test('page-level active navigation and accessibility labels survive sync', () => {
  assert.match(read('pricing.html'), /href="pricing\.html" aria-current="page"/u);
  assert.match(
    read('announcements.html'),
    /href="announcements\.html" aria-current="page"/u
  );
  assert.match(read('terms.html'), /aria-label="NOVELIGHT ホーム"/u);
});

test('campaign, SEO and standalone flows are explicit exceptions', () => {
  for (const path of [
    'scout-lv10-campaign.html',
    'novel.html',
    'episode.html',
    'author.html',
    'help.html'
  ]) {
    assert.ok(manifest.custom[path], path);
    assert.ok(!manifest.managed.includes(path), path);
  }
  assert.match(read('scout-lv10-campaign.html'), /data-campaign-member/u);
});

test('deployed HTML is generated in build rather than injected after paint', () => {
  const deploy = JSON.parse(read('vercel.json'));
  assert.equal(deploy.buildCommand, 'node scripts/sync-public-header.mjs --write');
  assert.equal(deploy.outputDirectory, '.');
  for (const path of manifest.managed) {
    const html = read(path);
    assert.match(html, /<header class="site-header">/u, path);
    assert.match(html, /class="header-inner public-header-inner"/u, path);
  }
});
