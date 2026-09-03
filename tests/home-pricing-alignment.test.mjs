import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const planCss = readFileSync(join(root, 'novelight-plan-badges.css'), 'utf8');

test('desktop Home pricing keeps badge and price rows aligned', () => {
  assert.match(
    planCss,
    /html body\.novelight-page-index\.novelight-public-dark \.plans > \.plan \{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*225px 44px 30px 26px 64px minmax\(150px, 1fr\) minmax\(66px, auto\) 48px/u
  );
  assert.match(
    planCss,
    /\.plans > \.plan::before \{[\s\S]*?grid-row:\s*1/u
  );
  assert.match(planCss, /\.plan-name \{[\s\S]*?grid-row:\s*2/u);
  assert.match(planCss, /\.beta-price \{[\s\S]*?grid-row:\s*3/u);
  assert.match(planCss, /\.old-price \{[\s\S]*?grid-row:\s*4/u);
  assert.match(planCss, /\.price \{[\s\S]*?grid-row:\s*5/u);
  assert.match(planCss, /\.plan-cta \{[\s\S]*?grid-row:\s*8/u);
  assert.match(
    planCss,
    /\.plans > \.plan\.recommended,[\s\S]*?\.plans > \.plan\.recommended:hover \{\s*transform:\s*none;/u
  );
});
