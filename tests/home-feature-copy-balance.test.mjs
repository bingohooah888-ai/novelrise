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
