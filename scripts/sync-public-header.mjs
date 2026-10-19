#!/usr/bin/env node
/* NOVELIGHT canonical public-header materializer.
 * Keep final markup in initial HTML to prevent post-load layout shifts. */
import { readFileSync, writeFileSync, existsSync, watch } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'shared/header/manifest.json'), 'utf8'));
const canonical = readFileSync(join(root, manifest.template), 'utf8').trimEnd();
const headerPattern = /<header class="site-header">[\s\S]*?<\/header>/u;
const watching = process.argv.includes('--watch');
const write = watching || process.argv.includes('--write');

export function renderHeader(page) {
  const config = manifest.overrides[page] || {};
  let header = canonical;
  if (config.logoLabel) {
    header = header.replace('aria-label="NOVELIGHT トップへ"', 'aria-label="' + config.logoLabel + '"');
  }
  if (config.active) {
    const anchor = 'href="' + config.active + '"';
    const segments = [
      ['<nav aria-label="モバイルナビ">', '</nav>'],
      ['<nav class="site-nav desktop-nav"', '</nav>']
    ];
    for (const [open, close] of segments) {
      const start = header.indexOf(open);
      const end = header.indexOf(close, start);
      if (start < 0 || end < 0) throw new Error('Header navigation missing');
      const nav = header.slice(start, end);
      if (!nav.includes(anchor)) throw new Error(page + ': bad current page');
      header = header.slice(0, start) + nav.replace(anchor, anchor + ' aria-current="page"') + header.slice(end);
    }
  }
  if (config.mobileAuthClasses || config.mobileSignup) {
    const start = header.indexOf('<nav aria-label="モバイルナビ">');
    const end = header.indexOf('</nav>', start);
    if (start < 0 || end < 0) throw new Error('No mobile navigation');
    let nav = header.slice(start, end);
    if (config.mobileAuthClasses) {
      nav = nav.replace('<a href="login.html">ログイン</a>', '<a class="mobile-login-action" href="login.html">ログイン</a>');
    }
    if (config.mobileSignup) {
      const classes = config.mobileAuthClasses ? ' class="mobile-signup-action"' : '';
      nav += '<a' + classes + ' href="signup.html">会員登録</a>';
    }
    header = header.slice(0, start) + nav + header.slice(end);
  }
  return header;
}
export function synchronizeHtml(html, page) {
  if (!headerPattern.test(html)) throw new Error('Missing managed header in ' + page);
  const shell = html.replace(headerPattern, renderHeader(page));
  const link = '<link rel="stylesheet" href="' + manifest.style + '" data-novelight-shared-header="true">';
  if (shell.includes(link)) return shell;
  if (!shell.includes('</head>')) throw new Error('Missing head in ' + page);
  return shell.replace('</head>', link + '\n</head>');
}

if (new Set(manifest.managed).size !== manifest.managed.length) throw new Error('Duplicate managed page');
const drift = [];
for (const page of manifest.managed) {
  if (!/^(?:[a-z0-9-]+\.html|api\/seo\/templates\/(?:novel|episode)\.html)$/u.test(page) || manifest.custom[page]) throw new Error('Invalid managed page: ' + page);
  const path = join(root, page);
  if (!existsSync(path)) throw new Error('Missing managed page: ' + page);
  const before = readFileSync(path, 'utf8');
  const after = synchronizeHtml(before, page);
  if (before !== after) {
    drift.push(page);
    if (write) writeFileSync(path, after);
  }
}
if (!write && drift.length) {
  console.error('Header markup drift detected: ' + drift.join(', ') + '. Run npm run header:sync.');
  process.exitCode = 1;
}
console.log('Shared public header: ' + manifest.managed.length + ' pages, ' + drift.length + ' different (' + (write ? 'synced' : 'checked') + ').');

// Optional local development mode: materialize the source of truth whenever
// its template or page-variant manifest changes. Do not watch generated HTML:
// doing so would create an infinite sync loop.
if (watching) {
  let pending;
  const directory = join(root, 'shared/header');
  watch(directory, (_event, filename) => {
    const name = filename ? String(filename) : '';
    if (name && name !== 'public-header.html' && name !== 'manifest.json') {
      return;
    }
    clearTimeout(pending);
    pending = setTimeout(() => {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), '--write'],
        { stdio: 'inherit' }
      );
      if (result.status !== 0) {
        console.error('Header auto-sync failed. Fix the template or manifest.');
      }
    }, 150);
  });
  console.log('Watching shared/header/ for source changes. Ctrl+C to stop.');
}
