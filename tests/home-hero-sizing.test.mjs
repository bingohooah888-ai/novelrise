import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const heroCss = fs.readFileSync(
  path.join(repoRoot, 'novelight-home-hero.css'),
  'utf8'
);
const headerCss = fs.readFileSync(
  path.join(repoRoot, 'novelight-header-light.css'),
  'utf8'
);

test('desktop home hero actions match the shared Home header action sizing', () => {
  assert.ok(
    headerCss.includes(
      'html body.novelight-public-dark header.site-header .btn {\n  font-size: 19px !important;'
    )
  );
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark .hero-primary,\nhtml body.novelight-page-index.novelight-public-dark .hero-secondary {\n  min-height: 46px;\n  padding: 10px 19px;\n  font-size: 19px;\n  font-weight: 700;'
    )
  );
});

test('desktop home hero supporting copy uses the enlarged type scale', () => {
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark .hero .eyebrow {\n  font-size: 16px;'
    )
  );
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark .hero p {\n  max-width: 510px;\n  font-size: 20px;'
    )
  );
});
