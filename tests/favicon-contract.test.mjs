import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ensureFaviconHtml,
  SITE_FAVICON_LINK
} from '../shared/page/favicon.mjs';
import { sendHtml } from '../api/seo/public-page.js';
import test from 'node:test';
import { URL } from 'node:url';

const favicon = readFileSync(new URL('../favicon.ico', import.meta.url));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('NOVELIGHT serves the approved site-wide 16/32/48 favicon', () => {
  assert.equal(favicon.readUInt16LE(0), 0);
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.equal(favicon.readUInt16LE(4), 3);

  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    assert.equal(favicon[entry], size);
    assert.equal(favicon[entry + 1], size);
    const bytes = favicon.readUInt32LE(entry + 8);
    const offset = favicon.readUInt32LE(entry + 12);
    assert.ok(bytes > pngSignature.length);
    assert.ok(offset + bytes <= favicon.length);
    assert.ok(favicon.subarray(offset, offset + 8).equals(pngSignature));
  }
});

test('homepage uses versioned favicon path', () => {
  const path = new URL('../index.html', import.meta.url);
  const page = readFileSync(path, 'utf8');
  assert.ok(page.includes('rel="icon"'));
  assert.ok(page.includes('href="/favicon.ico?v=20261022"'));
});

test('all static HTML documents use the canonical favicon', () => {
  const root = new URL('../', import.meta.url);
  const names = [
    ...readdirSync(root).filter((name) => name.endsWith('.html')),
    'api/seo/templates/novel.html',
    'api/seo/templates/episode.html'
  ];
  for (const name of names) {
    const html = readFileSync(new URL(name, root), 'utf8');
    if (html.trim() === `google-site-verification: ${name}`) continue;
    assert.match(html, /<head(?:\s[^>]*)?>/iu, name);
    assert.ok(html.includes(SITE_FAVICON_LINK), name);
    assert.equal(
      [...html.matchAll(/<link\b[^>]*>/giu)].filter(([tag]) => {
        const rel = tag.match(/\brel\s*=\s*(["'])([^"']+)\1/iu)?.[2];
        return rel?.toLowerCase().split(/\s+/u).includes('icon');
      }).length,
      1,
      name
    );
  }
});

test('new pages receive one canonical favicon', () => {
  const plain =
    '<!doctype html><html><head><title>NEW</title></head><body></body></html>';
  const once = ensureFaviconHtml(plain);
  assert.match(once, /href="\/favicon\.ico\?v=20261022"/u);
  assert.equal(ensureFaviconHtml(once), once);
  const old =
    '<html><head><link rel="shortcut icon" href="/old.ico"><link rel="icon" href="/other.ico"><title>X</title></head></html>';
  const normalized = ensureFaviconHtml(old);
  assert.equal(normalized.match(/rel="icon"/gu)?.length, 1);
  assert.ok(!normalized.includes('/old.ico'));
  assert.ok(!normalized.includes('/other.ico'));
  assert.ok(normalized.includes('<title>X</title>'));
});

test('favicon sync does not alter non-HTML verification tokens', () => {
  const token = 'google-site-verification: google123.html\n';
  assert.equal(ensureFaviconHtml(token), token);
});

test('dynamic HTML responses receive canonical favicon', () => {
  let body;
  const headers = new Map();
  const req = { method: 'GET' };
  const res = {
    setHeader(name, value) {
      headers.set(name, value);
    },
    status(code) {
      assert.equal(code, 200);
      return this;
    },
    send(payload) {
      body = payload;
      return this;
    }
  };
  sendHtml(
    req,
    res,
    '<html><head><title>Contest</title></head><body></body></html>'
  );
  assert.ok(body.includes(SITE_FAVICON_LINK));
  assert.equal(headers.get('Content-Type'), 'text/html; charset=utf-8');
});
