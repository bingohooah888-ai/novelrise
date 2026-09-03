import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(join(root, 'novelight-client.js'), 'utf8');
const themeCss = readFileSync(join(root, 'novelight-theme.css'), 'utf8');
const legalCss = readFileSync(join(root, 'legal.css'), 'utf8');
const lightCss = readFileSync(join(root, 'novelight-header-light.css'), 'utf8');
const planCss = readFileSync(join(root, 'novelight-plan-badges.css'), 'utf8');
const logoPath = join(root, 'assets', 'novelight-header-logo.webp');
const htmlFiles = readdirSync(root).filter((name) => name.endsWith('.html'));
const legacyLogo = /<(a|div|span|strong)\b[^>]*>\s*NOVELIGHT\s*<\/\1>/u;

test('shared app branding uses the official logo asset at the enlarged sitewide size', () => {
  assert.match(client, /BRAND_LOGO_PATH/u);
  assert.match(client, /novelight-header-logo\.webp/u);
  assert.match(client, /installBrandLogo/u);
  assert.match(client, /novelight-brand-logo-image/u);
  assert.match(client, /height:75\.6px!important/u);
  assert.match(client, /height:61\.2px!important/u);
  assert.match(client, /height:104\.4px!important/u);
  assert.match(client, /height:90px!important/u);
  assert.match(client, /height:82\.8px!important/u);
  assert.match(client, /height:72px!important/u);
  assert.match(client, /filter:none!important/u);
  assert.match(client, /mix-blend-mode:normal!important/u);
});

test('public headers share the expanded pricing-style desktop composition', () => {
  assert.match(
    client,
    /grid-template-columns:auto minmax\(520px,1fr\) auto!important/u
  );
  assert.match(client, /gap:clamp\(24px,2\.4vw,48px\)!important/u);
  assert.match(client, /site-nav a\{font-size:18px!important/u);
  assert.match(client, /header-actions\{gap:18px!important/u);
  assert.match(client, /min-height:52px!important/u);
  assert.match(client, /font-size:17px!important/u);
});

test('public headers use the light treatment and larger action text', () => {
  assert.match(planCss, /novelight-header-light\.css/u);
  assert.match(
    lightCss,
    /background:\s*rgba\(250,\s*249,\s*246,\s*0\.98\)\s*!important/u
  );
  assert.match(lightCss, /color:\s*#28364a\s*!important/u);
  assert.match(
    lightCss,
    /header\.site-header \.btn \{\s*font-size:\s*19px\s*!important/u
  );
  assert.match(lightCss, /font-size:\s*17px\s*!important/u);
  assert.match(lightCss, /font-size:\s*16px\s*!important/u);
  assert.match(
    lightCss,
    /mobile-menu > nav a \{\s*font-size:\s*16px\s*!important/u
  );
});

test('selected public navigation relies on highlighted text without a second underline', () => {
  assert.match(
    client,
    /site-nav a\[aria-current="page"\]::after\{display:none!important;content:none!important\}/u
  );
});

test('legacy app headers use the refreshed responsive action reading floor', () => {
  assert.match(client, /min-height:96px!important;gap:32px!important/u);
  assert.match(
    themeCss,
    /html body\.novelight-theme:not\(\.novelight-public-dark\) header \.right > a \{[\s\S]*?font-size:\s*19px\s*!important/u
  );
  assert.match(
    themeCss,
    /html body\.novelight-theme:not\(\.novelight-public-dark\) header \.logout \{[\s\S]*?min-height:\s*52px;[\s\S]*?font-size:\s*19px\s*!important/u
  );
  assert.match(
    themeCss,
    /@media \(min-width: 641px\) and \(max-width: 1180px\)[\s\S]*?header \.right > a \{[\s\S]*?font-size:\s*17px\s*!important/u
  );
  assert.match(
    themeCss,
    /@media \(max-width: 640px\)[\s\S]*?header \.right > a \{[\s\S]*?font-size:\s*16px\s*!important/u
  );
  assert.match(
    themeCss,
    /@media \(max-width: 640px\)[\s\S]*?header \.logout \{[\s\S]*?font-size:\s*16px\s*!important/u
  );
});

test('legal pages use the same official logo asset at the enlarged size', () => {
  assert.match(legalCss, /novelight-header-logo\.webp/u);
  assert.match(legalCss, /width:\s*340\.2px/u);
  assert.match(legalCss, /height:\s*79\.2px/u);
  assert.match(legalCss, /width:\s*262\.8px/u);
  assert.match(legalCss, /height:\s*61\.2px/u);
  assert.match(legalCss, /height:\s*104px/u);
  assert.match(legalCss, /\.site-back \{[\s\S]*?font-size:\s*19px/u);
  assert.match(
    legalCss,
    /@media \(min-width: 641px\) and \(max-width: 1180px\)[\s\S]*?\.site-back \{\s*font-size:\s*17px/u
  );
  assert.match(
    legalCss,
    /@media \(max-width: 640px\)[\s\S]*?\.site-back \{\s*font-size:\s*16px/u
  );
});

test('legacy header wordmarks are covered by shared branding', () => {
  const uncovered = [];

  for (const name of htmlFiles) {
    const source = readFileSync(join(root, name), 'utf8');
    if (!legacyLogo.test(source)) continue;

    const usesClient = source.includes('src="novelight-client.js"');
    const usesLegalCss = source.includes('href="legal.css"');
    if (!usesClient && !usesLegalCss) uncovered.push(name);
  }

  assert.deepEqual(uncovered, []);
});

test('official site logo asset remains present and non-empty', () => {
  assert.ok(existsSync(logoPath));
  assert.ok(statSync(logoPath).size > 1_000);
});
