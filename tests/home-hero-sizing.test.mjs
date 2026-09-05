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
const themeCss = fs.readFileSync(
  path.join(repoRoot, 'novelight-theme.css'),
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

test('desktop home hero supporting copy uses the enlarged type scale and cleaner wrapping', () => {
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark .hero .eyebrow {\n  font-size: 16px;'
    )
  );
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark .hero p {\n  max-width: 560px;\n  font-size: 20px;\n  line-height: 1.8;\n  text-wrap: pretty;'
    )
  );
});

test('Home light sections use dark reading colors against their ivory backgrounds', () => {
  assert.ok(
    themeCss.includes(
      'body.novelight-page-index #discover {\n  background: var(--novelight-ivory);'
    )
  );
  assert.ok(
    themeCss.includes(
      'body.novelight-page-index #features {\n  background: #f2eee5;'
    )
  );
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark #discover .section-kicker,\nhtml body.novelight-page-index.novelight-public-dark #features .section-kicker {\n  color: #9a6815;'
    )
  );
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark #discover .shelf-head h2,\nhtml body.novelight-page-index.novelight-public-dark #features .section-head h2 {\n  color: #1f2d40;'
    )
  );
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark #discover .shelf-head p,\nhtml body.novelight-page-index.novelight-public-dark #features .section-head p {\n  color: #596576;'
    )
  );
});
