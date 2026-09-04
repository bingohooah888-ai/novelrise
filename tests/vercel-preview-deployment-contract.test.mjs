import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../scripts/vercel-preview-deployment.mjs', import.meta.url),
  'utf8'
);

test('Vercel Preview creation stays fail-closed when target is omitted', () => {
  assert.match(
    source,
    /origin\.hostname === PRODUCTION_HOST/,
    'canonical Production host must remain explicitly forbidden'
  );
  assert.match(
    source,
    /observedSha !== expectedSha/,
    'exact current-main SHA must remain required'
  );
  assert.match(
    source,
    /observedRef !== expectedRef/,
    'dedicated staging ref must be present and exact'
  );
  assert.match(
    source,
    /payload\?\.target && payload\.target !== 'preview'/,
    'a reported non-preview target must fail closed'
  );
  assert.match(
    source,
    /deferring explicit Preview proof to deployed environment facts/,
    'an omitted target must explicitly defer final Preview proof'
  );
});
