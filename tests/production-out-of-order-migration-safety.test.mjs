import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const preflight = await readFile(
  '.github/workflows/production-migration-preflight.yml',
  'utf8'
);
const approvedDeploy = await readFile(
  '.github/workflows/production-migration-approved-dispatch.yml',
  'utf8'
);

test('read-only Production preflight includes migrations older than the latest remote version', () => {
  assert.match(
    preflight,
    /supabase db push --linked --dry-run --include-all/
  );
  assert.doesNotMatch(preflight, /supabase db push --linked --yes/);
});

test('chat-approved Production deploy permits out-of-order migrations only after exact pending-scope verification', () => {
  const verifyIndex = approvedDeploy.indexOf(
    'Require approved pending migrations at Production boundary'
  );
  const dryRunIndex = approvedDeploy.indexOf(
    'supabase db push --linked --dry-run --include-all'
  );
  const mutationIndex = approvedDeploy.indexOf(
    'supabase db push --linked --yes --include-all'
  );

  assert.ok(verifyIndex >= 0);
  assert.ok(dryRunIndex > verifyIndex);
  assert.ok(mutationIndex > dryRunIndex);
  assert.match(approvedDeploy, /bash scripts\/verify-supabase-pending\.sh/);
  assert.equal(
    approvedDeploy.match(/--include-all/g)?.length,
    2
  );
});
