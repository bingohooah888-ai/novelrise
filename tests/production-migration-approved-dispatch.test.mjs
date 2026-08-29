import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridge = await readFile(
  '.github/workflows/production-migration-approved-dispatch.yml',
  'utf8'
);
const manual = await readFile(
  '.github/workflows/supabase-production.yml',
  'utf8'
);

test('migration deploy bridge accepts only the Issue 165 owner approval record', () => {
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
    /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE/
  );
});

test('chat migration deploy approval is exact-scope, SHA-bound, and one-time', () => {
  assert.match(bridge, /supabase-migration-deploy/);
  assert.match(bridge, /test\("\^\[0-9a-f\]\{40\}\$"\)/);
  assert.match(bridge, /test\("\^\[A-F0-9\]\{8\}\$"\)/);
  assert.match(
    bridge,
    /\["challenge", "mainSha", "migrations", "operation"\]/
  );
  assert.match(bridge, /migrations \| unique \| length/);
  assert.match(bridge, /migrations == \(\.migrations \| sort\)/);
  assert.match(bridge, /index\(\$repairVersion\)\) == null/);
  assert.match(
    bridge,
    /main changed after the user approved this Production migration deploy/
  );
  assert.match(
    bridge,
    /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_CLAIMED/
  );
  assert.match(
    bridge,
    /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_DISPATCHED/
  );
  assert.match(
    bridge,
    /this Production migration deploy approval was already used/
  );
});

test('bridge dispatches only the scoped deploy fallback inputs', () => {
  assert.match(bridge, /TARGET_WORKFLOW: supabase-production\.yml/);
  assert.match(bridge, /actions\/workflows\/\$TARGET_WORKFLOW\/dispatches/);
  assert.match(bridge, /mode:"deploy"/);
  assert.match(bridge, /confirmation:"DEPLOY"/);
  assert.match(bridge, /approval_source:"chat"/);
  assert.match(bridge, /approved_main_sha:\$mainSha/);
  assert.match(bridge, /approved_migrations:\$migrations/);
  assert.match(bridge, /approval_challenge:\$challenge/);
  assert.match(bridge, /approval_bridge_run_id:\$bridgeRunId/);

  assert.doesNotMatch(bridge, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(bridge, /PRODUCTION_DB_PASSWORD/);
  assert.doesNotMatch(bridge, /supabase db push/);
  assert.doesNotMatch(bridge, /supabase migration repair/);
});

test('deploy fallback binds exact scope before and after human approval', () => {
  assert.match(manual, /deploy_preflight:/);
  assert.match(manual, /environment: production/);
  assert.match(manual, /approved_main_sha/);
  assert.match(manual, /approved_migrations/);
  assert.match(manual, /approval_source/);
  assert.match(manual, /approval_challenge/);
  assert.match(manual, /approval_bridge_run_id/);
  assert.match(manual, /Bind deploy to current main/);
  assert.match(manual, /Verify claimed chat approval/);
  assert.match(
    manual,
    /Require approved pending migrations before human approval/
  );
  assert.match(
    manual,
    /Dry-run approved pending migrations before human approval/
  );
  assert.match(manual, /environment: production-approval/);
  assert.match(manual, /Re-bind approved deploy to current main/);
  assert.match(
    manual,
    /Re-confirm approved pending migrations after human approval/
  );
  assert.match(
    manual,
    /Dry-run approved pending migrations after human approval/
  );
  assert.match(manual, /Apply approved pending migrations/);
  assert.match(
    manual,
    /bash scripts\/verify-supabase-pending\.sh/
  );
});

test('deploy fallback cannot route the fixed baseline repair through normal deploy', () => {
  assert.match(manual, /REPAIR_VERSION: '20260815000000'/);
  assert.match(
    manual,
    /baseline history repair version cannot be deployed through this route/
  );
  assert.match(
    manual,
    /supabase migration repair --status applied "\$REPAIR_VERSION"/
  );
});
