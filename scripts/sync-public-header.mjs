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
const workspaceTemplate = readFileSync(join(root, manifest.workspaceTemplate), 'utf8').trimEnd();
const logo = canonical.match(/<a class="logo"[^>]*>[\s\S]*?<\/a>/u)?.[0];
if (!logo || !logo.includes('<img')) throw new Error('Canonical Home logo missing');
const workspacePattern = /<header(?:\s[^>]*)?>\s*<div class="header-inner">[\s\S]*?<\/div>\s*<\/header>/u;
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

export function synchronizeWorkspaceHtml(html, page) {
  const existing = html.match(workspacePattern)?.[0];
  if (!existing) throw new Error(page + ': workspace header not found');
  const back = existing.match(/<a\b[^>]*\bclass="back"[^>]*>[\s\S]*?<\/a>/u)?.[0];
  if (!back) throw new Error(page + ': workspace return link not found');
  const rendered = workspaceTemplate.replace('{{HOME_LOGO}}', logo).replace('{{PAGE_BACK}}', back);
  if (rendered.includes('{{')) throw new Error('Unresolved workspace template');
  return html.replace(workspacePattern, rendered);
}

if (new Set(manifest.managed).size !== manifest.managed.length) throw new Error('Duplicate managed page');
if (new Set([...manifest.managed, ...manifest.workspaceManaged]).size !==
    manifest.managed.length + manifest.workspaceManaged.length) {
  throw new Error('Overlapping managed header page');
}

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
for (const page of manifest.workspaceManaged) {
  if (!/^[a-z0-9-]+\.html$/u.test(page) || manifest.custom[page]) {
    throw new Error('Invalid workspace page: ' + page);
  }
  const path = join(root, page);
  if (!existsSync(path)) throw new Error('Missing workspace page: ' + page);
  const before = readFileSync(path, 'utf8');
  const after = synchronizeWorkspaceHtml(before, page);
  if (before !== after) {
    drift.push(page);
    if (write) writeFileSync(path, after);
  }
}

/* Specialist pages retain their original navigation and permissions.
   Materialize only their brand artwork before first paint. */
const homeImage = logo.match(/<img\b[^>]*>/u)?.[0];
const imageSrc = homeImage?.match(/\bsrc="([^"]+)"/u)?.[1];
const imageAlt = homeImage?.match(/\balt="([^"]+)"/u)?.[1];
if (!imageSrc || !imageAlt) throw new Error('Invalid Home brand image');
const adminStyle = '<link rel="stylesheet" href="/shared/header/brand-variants.css" data-novelight-brand-variants="true">';
const groups = manifest.brandManaged || {};
const brandPages = Object.values(groups).flat();
const unique = [...manifest.managed, ...manifest.workspaceManaged, ...brandPages];
if (new Set(unique).size !== unique.length) throw new Error('Header management page overlap');
function logoImage(tag) {
  if (!/\bsrc="[^"]*"/u.test(tag) || !/\balt="[^"]*"/u.test(tag)) throw new Error('Invalid specialist image');
  return tag.replace(/\bsrc="[^"]*"/u, 'src="' + imageSrc + '"')
    .replace(/\balt="[^"]*"/u, 'alt="' + imageAlt + '"');
}
function adminLogo() {
  return '<a class="nl-admin-brand-link" href="index.html" aria-label="NOVELIGHT ホーム"><img src="' +
    imageSrc + '" alt="' + imageAlt + '" width="154" height="40"></a>';
}
export function synchronizeBrandHtml(html, page, group) {
  if (group === 'authorShell') {
    if (!html.includes('novelight-author-studio-shell.js')) {
      throw new Error(page + ': author shell script missing');
    }
    return html.includes(adminStyle) ? html : html.replace('</head>', adminStyle + '\n</head>');
  }
  if (group === 'standaloneAuthor') {
    const render = '<header class="nl-author-standalone-header"><a class="nl-author-standalone-brand" href="index.html" aria-label="NOVELIGHT ホーム"><img src="' + imageSrc + '" alt="' + imageAlt + '" width="154" height="40"></a><a class="nl-author-standalone-back" href="mypage.html">← 創作室へ戻る</a></header>';
    let output;
    if (html.includes('<header></header>')) {
      output = html.replace('<header></header>', render);
    } else if (/<header class="nl-author-standalone-header">[\s\S]*?<\/header>/u.test(html)) {
      output = html.replace(/<header class="nl-author-standalone-header">[\s\S]*?<\/header>/u, render);
    } else throw new Error(page + ': standalone header not found');
    return output.includes(adminStyle) ? output : output.replace('</head>', adminStyle + '\n</head>');
  }
  if (group !== 'admin') {
    const cls = {reader:'logo',help:'nl-help-page-brand',studio:'studio-brand'}[group];
    if (!cls) throw new Error('Unknown brand group: ' + group);
    const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gu)];
    const matches = anchors.filter(([a]) => {
      const opening = a.slice(0, a.indexOf('>'));
      const value = opening.match(/\bclass="([^"]+)"/u)?.[1] || '';
      return value.split(/\s+/u).includes(cls);
    });
    if (matches.length !== 1) throw new Error(page + ': missing/duplicated specialist brand anchor');
    const anchor = matches[0][0];
    if (!/<img\b[^>]*>/u.test(anchor)) throw new Error(page + ': brand image missing');
    let output = html.replace(anchor, anchor.replace(/<img\b[^>]*>/u, logoImage));
    if (group === 'studio' && !output.includes(adminStyle)) {
      output = output.replace('</head>', adminStyle + '\n</head>');
    }
    return output;
  }
  const match = html.match(/<header(?:\s[^>]*)?>[\s\S]*?<\/header>/u);
  if (!match) throw new Error(page + ': missing admin header');
  const before = match[0];
  const brand = adminLogo();
  let after;
  if (before.includes('class="nl-admin-brand-link"')) {
    after = before.replace(/<a class="nl-admin-brand-link"[^>]*>[\s\S]*?<\/a>/u, brand);
  } else if (before.includes('<div class="logo">NOVELIGHT</div>')) {
    after = before.replace('<div class="logo">NOVELIGHT</div>', brand);
  } else if (before.includes('<div class="brand">NOVELIGHT')) {
    after = before.replace('<div class="brand">NOVELIGHT', '<div class="brand">' + brand);
  } else if (before.includes('<strong>NOVELIGHT')) {
    after = before.replace('<strong>NOVELIGHT', '<strong>' + brand);
  } else throw new Error(page + ': unknown admin logo structure');
  if (!after.includes('class="nl-admin-brand-link"')) throw new Error(page + ': admin brand missing');
  let output = html.replace(before, after);
  if (!output.includes(adminStyle)) {
    if (!output.includes('</head>')) throw new Error(page + ': missing head');
    output = output.replace('</head>', adminStyle + '\n</head>');
  }
  return output;
}
for (const [group, pages] of Object.entries(groups)) {
  for (const page of pages) {
    if (!/^[a-z0-9-]+\.html$/u.test(page) || !existsSync(join(root, page))) throw new Error('Invalid brand page: ' + page);
    const path = join(root, page);
    const before = readFileSync(path, 'utf8');
    const after = synchronizeBrandHtml(before, page, group);
    if (before !== after) {
      drift.push(page);
      if (write) writeFileSync(path, after);
    }
  }
}

// Legacy Author Studio shell still renders its sidebar in JS; keep that
// exact source logo URL in sync while protecting account/logout behavior.
const authorShellPath = join(root, 'novelight-author-studio-shell.js');
const authorShellBefore = readFileSync(authorShellPath, 'utf8');
const authorShellPattern = /brandImage\.src = '[^']*';/u;
if (!authorShellPattern.test(authorShellBefore)) throw new Error('Author shell brand source missing');
const authorShellAfter = authorShellBefore.replace(
  authorShellPattern, "brandImage.src = '" + imageSrc + "';"
);
if (authorShellBefore !== authorShellAfter) {
  drift.push('novelight-author-studio-shell.js');
  if (write) writeFileSync(authorShellPath, authorShellAfter);
}

if (!write && drift.length) {
  console.error('Header markup drift detected: ' + drift.join(', ') + '. Run npm run header:sync.');
  process.exitCode = 1;
}
console.log('Shared headers: ' + (manifest.managed.length + manifest.workspaceManaged.length + brandPages.length) + ' pages, ' + drift.length + ' different (' + (write ? 'synced' : 'checked') + ').');

// Optional local development mode: materialize the source of truth whenever
// its template or page-variant manifest changes. Do not watch generated HTML:
// doing so would create an infinite sync loop.
if (watching) {
  let pending;
  const directory = join(root, 'shared/header');
  watch(directory, (_event, filename) => {
    const name = filename ? String(filename) : '';
    if (name && name !== 'public-header.html' && name !== 'workspace-header.html' && name !== 'manifest.json') {
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
