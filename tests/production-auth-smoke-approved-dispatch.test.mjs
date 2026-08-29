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

test('bridge requires the Issue 165 OWNER command', () => {
  assert.match(bridge, /issue_comment:/);
  assert.doesNotMatch(bridge, /workflow_dispatch:/);
  assert.match(bridge, /issue\.number == 165/);
  assert.match(bridge, /issue\.pull_request == null/);
  assert.match(bridge, /comment\.user\.login == 'bingohooah888-ai'/);
  assert.match(bridge, /author_association == 'OWNER'/);
  assert.match(bridge, /AUTH_SMOKE_DISPATCH_APPROVE/);
});

test('dispatch approval is SHA-bound and one-time', () => {
  assert.match(bridge, /production-authenticated-smoke/);
  assert.match(bridge, /test\("\^\[0-9a-f\]\{40\}\$"\)/);
  assert.match(bridge, /test\("\^\[A-F0-9\]\{8\}\$"\)/);
  assert.match(bridge, /\["challenge", "mainSha", "operation"\]/);
  assert.match(bridge, /main changed after the user approved/);
  assert.match(bridge, /before Production Auth Smoke dispatch claim/);
  assert.match(bridge, /before Production Auth Smoke request dispatch/);
  assert.match(bridge, /AUTH_SMOKE_DISPATCH_CLAIMED/);
  assert.match(bridge, /AUTH_SMOKE_DISPATCHED/);
  assert.match(bridge, /AUTH_SMOKE_DISPATCH_FAILED/);
  assert.match(bridge, /dispatch approval was already used/);
  assert.match(bridge, /Approval Ledger exceeded the bounded comment contract/);
});

test('bridge dispatch target is fixed and credential-free', () => {
  assert.match(bridge, /TARGET_WORKFLOW: production-authenticated-smoke\.yml/);
  assert.match(bridge, /actions\/workflows\/\$TARGET_WORKFLOW\/dispatches/);
  assert.match(bridge, /-d '\{"ref":"main"\}'/);
  assert.doesNotMatch(bridge, /environment: Production/);
  assert.doesNotMatch(bridge, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(bridge, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(bridge, /STRIPE_LIVE_SECRET_KEY/);
  assert.doesNotMatch(bridge, /production-auth-smoke-fixture\.mjs setup/);
});

test('existing smoke keeps final approval and cleanup', () => {
  assert.match(smoke, /github-actions\[bot\]/);
  assert.match(smoke, /comment\.user\.login == 'bingohooah888-ai'/);
  assert.match(smoke, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE/);
  assert.match(smoke, /approval request expired/);
  assert.match(smoke, /Create ephemeral production smoke users/);
  assert.match(smoke, /Clean ephemeral production smoke data/);
  assert.match(smoke, /production-auth-smoke-fixture\.mjs cleanup/);
  assert.doesNotMatch(smoke, /STRIPE_LIVE_SECRET_KEY/);
});
