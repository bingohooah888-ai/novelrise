import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authenticatedSmoke = readFileSync(
  new URL('./e2e/production-auth/authenticated-smoke.spec.js', import.meta.url),
  'utf8'
);

test('Production Auth Smoke follows the beta billing contract', () => {
  assert.match(
    authenticatedSmoke,
    /page\.request\.post\('\/api\/activate-beta-standard'/
  );
  assert.match(
    authenticatedSmoke,
    /assertBetaStandardActivation\(authorPage\)/
  );
  assert.match(
    authenticatedSmoke,
    /assertCheckoutSession\(readerPage, 'premium'\)/
  );
  assert.doesNotMatch(
    authenticatedSmoke,
    /assertCheckoutSession\([^)]*,\s*'standard'\)/
  );
});
