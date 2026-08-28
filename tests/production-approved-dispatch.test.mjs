import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridge = await readFile(
  '.github/workflows/production-approved-dispatch.yml',
  'utf8'
);
const target = await readFile(
  '.github/workflows/supabase-production.yml',
  'utf8'
);

test('Production dispatch bridge accepts only the owner approval ledger event', () => {
  assert.match(bridge, /issue_comment:/);
  assert.match(bridge, /github\.event\.issue\.number == 165/);
  assert.match(bridge, /github\.event\.issue\.pull_request == null/);
  assert.match(
    bridge,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(
    bridge,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(bridge, /NOVELIGHT_PRODUCTION_DISPATCH_APPROVE/);
});

test('Production dispatch approval is exact-scope, SHA-bound, and one-time', () => {
  assert.match(bridge, /supabase-baseline-history-repair/);
  assert.match(bridge, /REPAIR_VERSION: '20260815000000'/);
  assert.match(bridge, /test\("\^\[0-9a-f\]\{40\}\$"\)/);
  assert.match(bridge, /test\("\^\[A-F0-9\]\{8\}\$"\)/);
  assert.match(
    bridge,
    /\["challenge", "mainSha", "operation", "repairVersion"\]/
  );
  assert.match(
    bridge,
    /main changed after the user approved this Production dispatch/
  );
  assert.match(
    bridge,
    /main changed before Production workflow dispatch/
  );
  assert.match(bridge, /NOVELIGHT_PRODUCTION_DISPATCH_CLAIMED/);
  assert.match(bridge, /NOVELIGHT_PRODUCTION_DISPATCHED/);
  assert.match(
    bridge,
    /this Production dispatch approval was already used/
  );
});

test('bridge can dispatch only the fixed baseline repair target', () => {
  assert.match(bridge, /actions: write/);
  assert.match(bridge, /TARGET_WORKFLOW: supabase-production\.yml/);
  assert.match(bridge, /TARGET_REF: main/);
  assert.match(
    bridge,
    /actions\/workflows\/\$TARGET_WORKFLOW\/dispatches/
  );
  assert.match(
    bridge,
    /inputs:\{mode:"repair-history",confirmation:"REPAIR"\}/
  );
  assert.doesNotMatch(bridge, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(bridge, /PRODUCTION_DB_PASSWORD/);
  assert.doesNotMatch(bridge, /SUPABASE_PROJECT_ID/);
});

test('automatic dispatch does not bypass downstream Production approval or repair guards', () => {
  assert.match(target, /environment: production-approval/);
  assert.match(target, /PRODUCTION_APPROVAL_GATE_READY/);
  assert.match(target, /REPAIR_VERSION: '20260815000000'/);
  assert.match(target, /verify-production-initial-baseline-state\.sh/);
  assert.match(
    target,
    /supabase migration repair --status applied "\$REPAIR_VERSION"/
  );
  assert.match(target, /Verify production beta observability/);
});

test('bridge records dispatch failures instead of silently retrying', () => {
  assert.match(bridge, /NOVELIGHT_PRODUCTION_DISPATCH_FAILED/);
  assert.match(bridge, /if \[ "\$status" != '204' \];/);
  assert.doesNotMatch(bridge, /retry|rerun/i);
});
