import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const featureCss = fs.readFileSync(
  path.join(repoRoot, 'novelight-home-feature-icons.css'),
  'utf8'
);

test('Home feature descriptions use balanced desktop wrapping with mobile fallback', () => {
  assert.ok(
    featureCss.includes(
      'html body.novelight-page-index.novelight-public-dark #features .feature > p {\n  min-height: 3.5em;\n  line-height: 1.75;\n  text-wrap: balance;'
    )
  );
  assert.ok(
    featureCss.includes(
      'html body.novelight-page-index.novelight-public-dark #features .feature > p {\n    min-height: 0;\n    text-wrap: pretty;'
    )
  );
});

test('The first two Home feature descriptions prefer Japanese phrase boundaries', () => {
  assert.ok(
    featureCss.includes(
      'html body.novelight-page-index.novelight-public-dark #features .feature:nth-child(1) > p,\nhtml body.novelight-page-index.novelight-public-dark #features .feature:nth-child(2) > p {'
    )
  );
  assert.ok(featureCss.includes('word-break: auto-phrase;'));
  assert.ok(featureCss.includes('line-break: strict;'));
});
