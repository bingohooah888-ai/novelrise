import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const heroCss = readFileSync(join(root, 'novelight-home-hero.css'), 'utf8');
const planCss = readFileSync(join(root, 'novelight-plan-badges.css'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const heroAsset = join(root, 'assets', 'novelight-home-hero.webp');

test(
  'Home loads the user-supplied hero artwork with phrase-safe copy placement',
  () => {
    assert.match(planCss, /^@import url\("novelight-home-hero\.css"\);/u);
    assert.match(heroCss, /url\("assets\/novelight-home-hero\.webp"\)/u);
    assert.match(heroCss, /min-height:\s*clamp\(540px,\s*35\.9375vw,\s*736px\)/u);
    assert.match(heroCss, /\.hero-copy \{[\s\S]*?width:\s*min\(560px,\s*42vw\)/u);
    assert.match(heroCss, /\.hero-art-slot \{\s*display:\s*none;/u);
    assert.match(
      heroCss,
      /@media \(max-width:\s*900px\)[\s\S]*?padding-top:\s*35\.9375vw/u,
    );
    assert.match(indexHtml, /<h1>まだ知られていない<br>物語に、<span>光を。<\/span><\/h1>/u);
    assert.equal(existsSync(heroAsset), true, 'Home hero artwork asset must exist');
    assert.ok(
      statSync(heroAsset).size > 10_000,
      'Home hero artwork should not be an empty placeholder',
    );
  },
);
