import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const homeHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const heroCss = fs.readFileSync(
  path.join(repoRoot, 'novelight-home-hero.css'),
  'utf8'
);

test('desktop Home hero supporting copy splits at the sentence boundary', () => {
  assert.ok(
    homeHtml.includes(
      '<p><span class="hero-copy-line">ランキングだけでは出会えない物語がここにある。</span><span class="hero-copy-line">あなたの発見が、まだ知られていない作品を次の読者へつなぎます。</span></p>'
    )
  );
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark .hero-copy-line {\n  display: block;'
    )
  );
  assert.ok(
    heroCss.includes(
      'html body.novelight-page-index.novelight-public-dark .hero-copy-line {\n    display: inline;'
    )
  );
});
