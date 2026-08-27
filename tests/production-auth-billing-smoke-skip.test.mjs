import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const billingSmokePath = 'tests/e2e/production-auth/billing-smoke.spec.js';

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('production auth smoke can skip staging-only billing setup', async () => {
  const source = await text(billingSmokePath);

  assert.ok(
    source.includes(
      "const completeBilling = process.env.E2E_COMPLETE_BILLING === 'true';"
    )
  );
  assert.ok(source.includes('test.skip(\n  !completeBilling,'));
  assert.ok(
    source.includes(
      'const stagingSupabase = completeBilling\n  ? resolveStagingSupabaseOverride()\n  : null;'
    )
  );
  assert.ok(
    !source.includes(
      'const stagingSupabase = resolveStagingSupabaseOverride();'
    )
  );
});
