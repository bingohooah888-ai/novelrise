import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = readFileSync(join(root, 'index.html'), 'utf8');
const logoPath = join(root, 'assets', 'novelight-header-logo.webp');

test('homepage header uses the official NOVELIGHT logo asset', () => {
  assert.match(home, /assets\/novelight-header-logo\.webp/u);
  assert.match(home, /alt="NOVELIGHT"/u);
  assert.match(home, /aria-label="NOVELIGHT トップへ"/u);
  assert.ok(existsSync(logoPath));
  assert.ok(statSync(logoPath).size > 1_000);
});

test('homepage logo uses the shared sitewide responsive sizing override', () => {
  const css = readFileSync(
    join(root, 'novelight-header-first-paint.css'),
    'utf8'
  ).replace(/\s*([:;{},])\s*/gu, '$1');
  assert.match(css, /height:104\.4px!important/u);
  assert.match(css, /height:90px!important/u);
  assert.match(css, /height:82\.8px!important/u);
  assert.match(css, /height:72px!important/u);
});
