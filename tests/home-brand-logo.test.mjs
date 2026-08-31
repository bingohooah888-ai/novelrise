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

test('homepage logo has responsive header sizing', () => {
  assert.match(home, /height:44px/u);
  assert.match(home, /height:34px/u);
  assert.match(home, /max-width:42vw/u);
});
