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
const automatic = await readFile(
  '.github/workflows/supabase-production-auto-deploy.yml',
  'utf8'
);
const cleanup = await readFile(
  'scripts/cleanup-stale-production-migration-run.mjs',
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
  assert.match(bridge, /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE/);
});

test('chat migration deploy approval is exact-scope, SHA-bound, and one-time', () => {
  assert.match(bridge, /supabase-migration-deploy/);
  assert.match(bridge, /test\("\^\[0-9a-f\]\{40\}\$"\)/);
  assert.match(bridge, /test\("\^\[A-F0-9\]\{8\}\$"\)/);
  assert.match(bridge, /\["challenge", "mainSha", "migrations", "operation"\]/);
  assert.match(bridge, /migrations \| unique \| length/);
  assert.match(bridge, /migrations == \(\.migrations \| sort\)/);
  assert.match(bridge, /index\(\$repairVersion\)\) == null/);
  assert.match(
    bridge,
    /main changed after the user approved this Production migration deploy/
  );
  assert.match(
    bridge,
    /main changed before Production migration approval claim/
  );
  assert.match(bridge, /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_CLAIMED/);
  assert.match(bridge, /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_EXECUTED/);
  assert.match(bridge, /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_FAILED/);
  assert.match(
    bridge,
    /this Production migration deploy approval was already used/
  );
});

test('chat-approved migration deploy executes directly without Environment double approval', () => {
  assert.match(
    bridge,
    /Execute fixed chat-approved Production migration deploy/
  );
  assert.match(bridge, /environment: production/);
  assert.doesNotMatch(bridge, /environment: production-approval/);
  assert.doesNotMatch(
    bridge,
    /actions\/workflows\/\$TARGET_WORKFLOW\/dispatches/
  );
  assert.match(bridge, /supabase db push --linked --dry-run/);
  assert.match(bridge, /id: migration_mutation/);
  assert.match(bridge, /supabase db push --linked --yes/);
  assert.match(bridge, /Verify production migration status after deploy/);
  assert.match(bridge, /Verify production beta observability/);
});

test('Production boundary re-validates exact claimed migration approval and scope', () => {
  assert.match(
    bridge,
    /Re-validate claimed chat approval at Production boundary/
  );
  assert.match(bridge, /main changed before the Production migration boundary/);
  assert.match(bridge, /bridgeRunId == \$bridgeRunId/);
  assert.match(
    bridge,
    /exact claimed chat migration approval was not found at the Production boundary/
  );
  assert.match(bridge, /Checkout approved main/);
  assert.match(
    bridge,
    /test "\$\(git rev-parse HEAD\)" = "\$APPROVED_MAIN_SHA"/
  );
  assert.match(
    bridge,
    /Require approved pending migrations at Production boundary/
  );
  assert.match(
    bridge,
    /Dry-run approved pending migrations at Production boundary/
  );
  assert.match(bridge, /bash scripts\/verify-supabase-pending\.sh/);
});

test('bridge uses the shared stale waiting-run cleanup contract before claim', () => {
  assert.match(bridge, /Checkout approved main for shared cleanup contract/);
  assert.match(bridge, /Verify cleanup contract checkout/);
  assert.match(
    bridge,
    /node scripts\/cleanup-stale-production-migration-run\.mjs/
  );
  assert.doesNotMatch(bridge, /actions\/runs\/\$stale_run_id\/cancel/);

  assert.match(cleanup, /a human-started Supabase Production workflow is still active/);
  assert.match(
    cleanup,
    /multiple stale bot-dispatched Production migration runs require manual investigation/
  );
  assert.match(cleanup, /status !== 'waiting'/);
  assert.match(cleanup, /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_DISPATCHED/);
  assert.match(cleanup, /active bot Production migration run is not uniquely backed by the prior bridge ledger/);
  assert.match(cleanup, /\/actions\/runs\/\$\{staleRun\.id\}\/cancel/);
  assert.match(cleanup, /run\.conclusion === 'cancelled'/);
});

test('manual mutation fallback keeps GitHub Environment approval', () => {
  assert.match(manual, /environment: production-approval/);
  assert.match(manual, /PRODUCTION_APPROVAL_GATE_READY/);
  assert.match(manual, /confirmation must be exactly REPAIR/);
  assert.match(manual, /confirmation must be exactly DEPLOY/);
});

test('automatic main-push workflow is read-only and hands off mutation to chat approval', () => {
  assert.match(automatic, /name: NOVELIGHT Supabase Production Migration Plan/);
  assert.match(
    automatic,
    /Require pending migrations to match this push exactly/
  );
  assert.match(automatic, /supabase db push --linked --dry-run/);
  assert.match(automatic, /Record chat-approval handoff/);
  assert.match(automatic, /No Production database mutation was performed/);
  assert.doesNotMatch(automatic, /environment: production-approval/);
  assert.doesNotMatch(automatic, /supabase db push --linked --yes/);
});

test('deploy route cannot route the fixed baseline repair through normal deploy', () => {
  assert.match(bridge, /REPAIR_VERSION: '20260815000000'/);
  assert.match(
    bridge,
    /baseline history repair version cannot be deployed through this route/
  );
  assert.doesNotMatch(
    bridge,
    /supabase migration repair --status applied "\$REPAIR_VERSION"/
  );
});

test('ledger distinguishes mutation result from postcheck result', () => {
  assert.match(
    bridge,
    /mutation_result: \$\{\{ steps\.execution_phase\.outputs\.mutation_result \}\}/
  );
  assert.match(
    bridge,
    /postcheck_result: \$\{\{ steps\.execution_phase\.outputs\.postcheck_result \}\}/
  );
  assert.match(
    bridge,
    /failure_phase: \$\{\{ steps\.execution_phase\.outputs\.failure_phase \}\}/
  );
  assert.match(bridge, /failure_phase='pre-mutation'/);
  assert.match(bridge, /failure_phase='mutation'/);
  assert.match(bridge, /failure_phase='postcheck:migration-status'/);
  assert.match(bridge, /failure_phase='postcheck:integrity'/);
  assert.match(bridge, /failure_phase='none'/);
});
