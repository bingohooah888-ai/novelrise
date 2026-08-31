import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(join(root, 'novelight-client.js'), 'utf8');
const themePath = join(root, 'novelight-theme.css');
const theme = readFileSync(themePath, 'utf8');
const legal = readFileSync(join(root, 'legal.css'), 'utf8');

test('shared client installs the sitewide NOVELIGHT theme', () => {
  assert.match(client, /THEME_STYLESHEET_PATH/u);
  assert.match(client, /novelight-theme\.css/u);
  assert.match(client, /installThemeStyles/u);
  assert.match(client, /novelight-page-/u);
  assert.match(client, /data-novelight-theme/u);
});

test('theme defines the approved night, gold, ivory, and paper design tokens', () => {
  assert.match(theme, /--novelight-night:\s*#081426/u);
  assert.match(theme, /--novelight-navy:\s*#0e1d35/u);
  assert.match(theme, /--novelight-gold:\s*#d6a447/u);
  assert.match(theme, /--novelight-gold-light:\s*#eac46a/u);
  assert.match(theme, /--novelight-ivory:\s*#f7f4ed/u);
  assert.match(theme, /--novelight-paper:\s*#fffdf8/u);
});

test('homepage, search, and author dashboard receive dedicated layouts', () => {
  assert.match(theme, /novelight-page-index \.hero/u);
  assert.match(theme, /TODAY'S LIGHT/u);
  assert.match(theme, /novelight-page-search main/u);
  assert.match(theme, /grid-template-areas/u);
  assert.match(theme, /novelight-page-mypage main\.novelight-author-shell/u);
  assert.match(client, /installAuthorDashboardShell/u);
  assert.match(client, /AUTHOR STUDIO/u);
  assert.match(client, /LIGHT ANALYTICS/u);
});

test('reading surfaces keep their low-decoration readability treatment', () => {
  assert.match(theme, /novelight-page-episode/u);
  assert.match(theme, /background:\s*#faf8f2/u);
  assert.match(theme, /color:\s*#272727/u);
});

test('legal pages use the same navy, gold, ivory palette', () => {
  assert.match(legal, /#081426/u);
  assert.match(legal, /#d6a447/u);
  assert.match(legal, /#f7f4ed/u);
  assert.match(legal, /novelight-header-logo\.webp/u);
});

test('site theme stylesheet remains present and non-empty', () => {
  assert.ok(existsSync(themePath));
  assert.ok(statSync(themePath).size > 5_000);
});
