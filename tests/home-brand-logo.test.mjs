import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const homePath = join(root, 'index.html');
const logoPath = join(root, 'assets', 'novelight-header-logo.webp');
const home = readFileSync(homePath, 'utf8');

test('homepage header uses the official NOVELIGHT logo asset', () => {
  assert.match(
    home,
    /<a class="logo" href="index\.html" aria-label="NOVELIGHT トップへ"><img src="assets\/novelight-header-logo\.webp" alt="NOVELIGHT" width="500" height="117"><\/a>/
  );
  assert.ok(existsSync(logoPath), 'official header logo asset must exist');
  assert.ok(
    statSync(logoPath).size > 1_000,
    'official header logo asset must not be empty'
  );
});

test('homepage logo stays within the desktop and mobile header', () => {
  assert.match(
    home,
    /\.logo img\{[^}]*height:44px[^}]*max-width:42vw[^}]*\}/
  );
  assert.match(
    home,
    /@media\(max-width:860px\)\{[^}]*[\s\S]*?\.logo img\{height:34px\}/
  );
});
