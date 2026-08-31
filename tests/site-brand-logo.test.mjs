import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(join(root, 'novelight-client.js'), 'utf8');
const legalCss = readFileSync(join(root, 'legal.css'), 'utf8');
const logoPath = join(root, 'assets', 'novelight-header-logo.webp');
const htmlFiles = readdirSync(root).filter((name) => name.endsWith('.html'));

function legacyWordmarkElements(source) {
  return [
    ...source.matchAll(
      /<(a|div|span|strong)\b[^>]*>\s*NOVELIGHT\s*<\/\1>/gu
    )
  ];
}

test('shared app branding replaces legacy NOVELIGHT wordmarks with the official asset', () => {
  assert.match(client, /const BRAND_LOGO_PATH = 'assets\/novelight-header-logo\.webp'/u);
  assert.match(client, /function installBrandLogo\(\)/u);
  assert.match(client, /querySelectorAll\('\.logo, \.site-logo'\)/u);
  assert.match(client, /novelight-brand-logo-image/u);
  assert.match(client, /height:44px/u);
  assert.match(client, /height:34px/u);
});

test('legal pages render the same official asset responsively', () => {
  assert.match(legalCss, /assets\/novelight-header-logo\.webp/u);
  assert.match(legalCss, /\.site-logo\{[^}]*width:189px[^}]*height:44px/u);
  assert.match(legalCss, /\.site-logo\{width:146px;height:34px\}/u);
});

test('every remaining legacy header wordmark is covered by shared branding', () => {
  const uncovered = [];

  for (const name of htmlFiles) {
    const source = readFileSync(join(root, name), 'utf8');
    const matches = legacyWordmarkElements(source);
    if (!matches.length) continue;

    const usesClient = source.includes('src="novelight-client.js"');
    const usesLegalCss = source.includes('href="legal.css"');
    if (!usesClient && !usesLegalCss) uncovered.push(name);
  }

  assert.deepEqual(uncovered, []);
});

test('official site logo asset remains present and non-empty', () => {
  assert.ok(existsSync(logoPath));
  assert.ok(statSync(logoPath).size > 1_000);
});
