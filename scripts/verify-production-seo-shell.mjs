#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES = Object.freeze({
  'novel.html': {
    title: '作品詳細 | NOVELIGHT',
    description: 'NOVELIGHTの作品詳細ページです。',
    canonical: 'https://novelight.jp/novel.html'
  },
  'episode.html': {
    title: 'エピソード | NOVELIGHT',
    description: 'NOVELIGHTのエピソードページです。',
    canonical: 'https://novelight.jp/episode.html'
  }
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// When no ?id= is supplied, the SEO routes return the complete original
// template with only these deterministic head tags injected. This exact
// byte-for-byte comparison catches missing rewrites, stale templates, missing
// scripts, unexpected SSR, and any unauthorized body modification.
export function expectedSeoShell(route, template) {
  const config = ROUTES[route];
  assert.ok(config, 'unsupported SEO rewrite route');
  assert.equal(typeof template, 'string');
  assert.ok(template.includes('</head>'), 'template is missing head');
  assert.match(template, /<title>[\s\S]*?<\/title>/i);
  assert.ok(template.includes('</body>'), 'template is missing body');

  const tags = [
    `<meta name="description" content="${escapeHtml(config.description)}">`,
    `<link rel="canonical" href="${escapeHtml(config.canonical)}">`,
    '<meta name="robots" content="noindex, nofollow">'
  ];
  return template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(config.title)}</title>`)
    .replace('</head>', `${tags.join('\n')}\n</head>`);
}

export function verifySeoShell(route, source, template, live) {
  assert.equal(
    source,
    template,
    `${route}: public shell and SEO template differ`
  );
  const expected = expectedSeoShell(route, template);
  assert.ok(live && live.length > 0, `${route}: empty response`);
  assert.equal(
    live,
    expected,
    `${route}: Production SEO shell differs from approved template`
  );
  return true;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const [, , route, livePath] = process.argv;
  try {
    assert.ok(ROUTES[route], 'unsupported SEO rewrite route');
    assert.ok(livePath, 'live response file path required');
    const source = readFileSync(route, 'utf8');
    const template = readFileSync(`api/seo/templates/${route}`, 'utf8');
    const live = readFileSync(livePath, 'utf8');
    verifySeoShell(route, source, template, live);
    process.stdout.write(`Production SEO shell verified: ${route}\n`);
  } catch (error) {
    process.stderr.write(`Production SEO shell mismatch: ${error.message}\n`);
    process.exitCode = 1;
  }
}
