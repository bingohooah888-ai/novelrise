import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const iconCss = fs.readFileSync(
  path.join(repoRoot, 'novelight-home-feature-icons.css'),
  'utf8'
);
const heroCss = fs.readFileSync(
  path.join(repoRoot, 'novelight-home-hero.css'),
  'utf8'
);

const expectedAssets = [
  'assets/novelight-feature-discovery.png',
  'assets/novelight-feature-light-seed.png',
  'assets/novelight-feature-analytics.png'
];

test('Home feature icon artwork is loaded in the intended order', () => {
  assert.ok(
    heroCss.includes('@import url("novelight-home-feature-icons.css");')
  );

  for (const asset of expectedAssets) {
    assert.equal(fs.existsSync(path.join(repoRoot, asset)), true, asset);
    assert.ok(iconCss.includes(`url("${asset}")`), asset);
  }

  assert.ok(
    iconCss.indexOf(expectedAssets[0]) < iconCss.indexOf(expectedAssets[1])
  );
  assert.ok(
    iconCss.indexOf(expectedAssets[1]) < iconCss.indexOf(expectedAssets[2])
  );
});
