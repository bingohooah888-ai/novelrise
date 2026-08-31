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
const legacyLogo = /<(a|div|span|strong)\b[^>]*>\s*NOVELIGHT\s*<\/\1>/u;

test('shared app branding uses the official logo asset', () => {
  assert.match(client, /BRAND_LOGO_PATH/u);
  assert.match(client, /novelight-header-logo\.webp/u);
  assert.match(client, /installBrandLogo/u);
  assert.match(client, /novelight-brand-logo-image/u);
  assert.match(client, /height:44px/u);
  assert.match(client, /height:34px/u);
});

test('legal pages use the same official logo asset', () => {
  assert.match(legalCss, /novelight-header-logo\.webp/u);
  assert.match(legalCss, /width:189px/u);
  assert.match(legalCss, /height:44px/u);
  assert.match(legalCss, /width:146px/u);
  assert.match(legalCss, /height:34px/u);
});

test('legacy header wordmarks are covered by shared branding', () => {
  const uncovered = [];

  for (const name of htmlFiles) {
    const source = readFileSync(join(root, name), 'utf8');
    if (!legacyLogo.test(source)) continue;

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
