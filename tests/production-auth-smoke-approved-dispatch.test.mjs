import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridge = await readFile(
  '.github/workflows/production-auth-smoke-approved-dispatch.yml',
  'utf8'
);
const smoke = await readFile(
  '.github/workflows/production-authenticated-smoke.yml',
  'utf8'
);

test('Auth Smoke dispatch bridge accepts only the Issue 165 owner approval record', () => {
  assert.match(bridge, /issue_comment:/);
  assert.doesNotMatch(bridge, /workflow_dispatch:/);
  assert.match(bridge, /github\.event\.issue\.number == 165/);
  assert.match(bridge, /github\.event\.issue\.pull_request == null/);
  assert.match(
    bridge,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(bridge, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(
    bridge,
    /NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCH_APPROVE/
  );
});

test('Auth Smoke dispatch approval is exact-scope, SHA-bound, and one-time', () => {
  assert.match(bridge, /production-authenticated-smoke/);
  assert.match(bridge, /test\("\^\[0-9a-f\]\{40\}\$"\)/);
  assert.match(bridge, /test\("\^\[A-F0-9\]\{8\}\$"\)/);
  assert.match(bridge, /\["challenge", "mainSha", "operation"\]/);
  assert.match(
    bridge,
    /main changed after the user approved this Production Auth Smoke dispatch/
  );
  assert.match(
    bridge,
    /main changed before Production Auth Smoke dispatch claim/
  );
  assert.match(
    bridge,
    /main changed before Production Auth Smoke request dispatch/
  );
  assert.match(bridge, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCH_CLAIMED/);
  assert.match(bridge, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCHED/);
  assert.match(bridge, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCH_FAILED/);
  assert.match(
    bridge,
    /this Production Auth Smoke dispatch approval was already used/
  );
  assert.match(
    bridge,
    /Production Approval Ledger exceeded the bounded comment contract/
  );
});

test('bridge dispatches only the fixed request workflow on main', () => {
  assert.match(bridge, /TARGET_WORKFLOW: production-authenticated-smoke\.yml/);
  assert.match(
    bridge,
    /actions\/workflows\/\$TARGET_WORKFLOW\/dispatches/
  );
  assert.match(bridge, /-d '\{"ref":"main"\}'/);
  assert.doesNotMatch(bridge, /environment: Production/);
  assert.doesNotMatch(bridge, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(bridge, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(bridge, /STRIPE_LIVE_SECRET_KEY/);
  assert.doesNotMatch(bridge, /production-auth-smoke-fixture\.mjs setup/);
});

test('existing Auth Smoke keeps final owner approval and cleanup boundary', () => {
  assert.match(
    smoke,
    /github\.event\.issue\.user\.login == 'github-actions\[bot\]'/
  );
  assert.match(
    smoke,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(smoke, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE/);
  assert.match(smoke, /Production Authenticated Smoke approval request expired/);
  assert.match(smoke, /Create ephemeral production smoke users/);
  assert.match(smoke, /Clean ephemeral production smoke data/);
  assert.match(smoke, /production-auth-smoke-fixture\.mjs cleanup/);
  assert.doesNotMatch(smoke, /STRIPE_LIVE_SECRET_KEY/);
});
