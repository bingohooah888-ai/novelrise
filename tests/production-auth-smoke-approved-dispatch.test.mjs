import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridge = await readFile(
  '.github/workflows/production-auth-smoke-approved-dispatch.yml',
  'utf8'
);
const handler = await readFile(
  '.github/workflows/production-authenticated-smoke.yml',
  'utf8'
);
const request = await readFile(
  '.github/workflows/production-auth-smoke-request.yml',
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

test('bridge targets the credential-free approval handler', () => {
  assert.match(bridge, /TARGET_WORKFLOW: production-authenticated-smoke\.yml/);
  assert.match(bridge, /actions\/workflows\/\$TARGET_WORKFLOW\/dispatches/);
  assert.match(bridge, /-d '\{"ref":"main"\}'/);
  assert.doesNotMatch(bridge, /environment: Production/);
  assert.doesNotMatch(bridge, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(bridge, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(bridge, /STRIPE_LIVE_SECRET_KEY/);
  assert.doesNotMatch(bridge, /production-auth-smoke-fixture\.mjs setup/);
});

test('workflow dispatch only forwards to the separately named request workflow', () => {
  assert.match(handler, /^name: NOVELIGHT Production Auth Smoke Approval Handler/m);
  assert.match(handler, /workflow_dispatch:/);
  assert.match(handler, /name: Dispatch scoped Auth Smoke request workflow/);
  assert.match(handler, /production-auth-smoke-request\.yml\/dispatches/);
  assert.match(request, /^name: NOVELIGHT Production Auth Smoke Request/m);
  assert.match(request, /name: Create scoped chat approval request/);
  assert.doesNotMatch(request, /environment: Production/);
  assert.doesNotMatch(request, /Run authenticated production smoke/);
});

test('actual verification keeps final approval and cleanup', () => {
  assert.match(handler, /github-actions\[bot\]/);
  assert.match(handler, /comment\.user\.login == 'bingohooah888-ai'/);
  assert.match(handler, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE/);
  assert.match(handler, /approval request expired/);
  assert.match(handler, /name: Verify authenticated beta-critical production flows/);
  assert.match(handler, /Create ephemeral production smoke users/);
  assert.match(handler, /Clean ephemeral production smoke data/);
  assert.match(handler, /production-auth-smoke-fixture\.mjs cleanup/);
  assert.match(handler, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED/);
  assert.doesNotMatch(handler, /STRIPE_LIVE_SECRET_KEY/);
});
