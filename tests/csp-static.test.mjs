import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import {
  buildContentSecurityPolicy,
  collectInlineScriptHashes
} from '../scripts/csp-script-hashes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectedCsp = buildContentSecurityPolicy(root);
const htmlFiles = readdirSync(root)
  .filter((name) => extname(name) === '.html')
  .sort();
const rootJavaScriptFiles = readdirSync(root)
  .filter((name) => ['.js', '.mjs'].includes(extname(name)))
  .sort();

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('Vercel CSP removes script unsafe-inline without weakening other directives', () => {
  const config = JSON.parse(read('vercel.json'));
  const headers = config.headers?.[0]?.headers || [];
  const csp = headers.find(
    ({ key }) => key.toLowerCase() === 'content-security-policy'
  )?.value;

  assert.equal(csp, expectedCsp);
  assert.match(csp, /(?:^|; )script-src 'self' 'sha256-/u);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/u);
  assert.doesNotMatch(csp, /'unsafe-eval'/u);
  assert.doesNotMatch(csp, /'unsafe-hashes'/u);
  assert.doesNotMatch(csp, /(?:^|; )default-src[^;]*\*/u);
});

test('every static inline script has an exact SHA-256 allowlist entry', () => {
  const hashes = collectInlineScriptHashes(root);
  assert.equal(hashes.length, 51);
  for (const hash of hashes) assert.ok(expectedCsp.includes(hash));
});

test('deployable HTML has no inline event handler or javascript URL', () => {
  for (const file of htmlFiles) {
    const html = read(file);
    assert.doesNotMatch(
      html,
      /\son[a-z][a-z0-9_-]*\s*=/iu,
      `${file} contains an inline event handler`
    );
    assert.doesNotMatch(
      html,
      /\b(?:href|src|action)\s*=\s*["']\s*javascript\s*:/iu,
      `${file} contains a javascript URL`
    );
  }
});

test('page runtime references are self-hosted and resolvable', () => {
  for (const file of htmlFiles) {
    const html = read(file);
    const scriptSources = [
      ...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu)
    ].map((match) => match[1]);

    for (const source of scriptSources) {
      assert.doesNotMatch(
        source,
        /^(?:https?:)?\/\//iu,
        `${file} loads a third-party script: ${source}`
      );
      const localPath = source.replace(/^\//u, '').split(/[?#]/u, 1)[0];
      assert.doesNotThrow(
        () => read(localPath),
        `${file} references missing script ${source}`
      );
    }
  }
});

test('dynamic script loaders only attach self-hosted external scripts', () => {
  for (const file of rootJavaScriptFiles) {
    const source = read(file);
    const declarations = [
      ...source.matchAll(
        /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$.]+\.)?createElement\(\s*["']script["']\s*\)/gu
      )
    ];

    for (const match of declarations) {
      const variable = match[1];
      const tail = source.slice(match.index, match.index + 1200);
      assert.match(
        tail,
        new RegExp(`${variable}\\.src\\s*=`),
        `${file} creates ${variable} without an external src`
      );
      assert.doesNotMatch(
        tail,
        new RegExp(`${variable}\\.(?:text|textContent|innerHTML)\\s*=`),
        `${file} inserts inline script content through ${variable}`
      );
    }
  }
});
