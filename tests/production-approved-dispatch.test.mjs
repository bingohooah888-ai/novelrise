import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridge = await readFile(
  '.github/workflows/production-approved-dispatch.yml',
  'utf8'
);
const manual = await readFile(
  '.github/workflows/supabase-production.yml',
  'utf8'
);

test('Production execution bridge accepts only the owner approval ledger event', () => {
  assert.match(bridge, /issue_comment:/);
  assert.doesNotMatch(bridge, /workflow_dispatch:/);
  assert.match(bridge, /github\.event\.issue\.number == 165/);
  assert.match(bridge, /github\.event\.issue\.pull_request == null/);
  assert.match(
    bridge,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(bridge, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(bridge, /NOVELIGHT_PRODUCTION_DISPATCH_APPROVE/);
});

test('chat approval is exact-scope, SHA-bound, and one-time', () => {
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
    /main changed after the user approved this Production action/
  );
  assert.match(bridge, /main changed before Production approval claim/);
  assert.match(bridge, /NOVELIGHT_PRODUCTION_DISPATCH_CLAIMED/);
  assert.match(bridge, /NOVELIGHT_PRODUCTION_EXECUTED/);
  assert.match(bridge, /this Production approval was already used/);
});

test('manual fallback keeps GitHub Environment human approval', () => {
  assert.match(manual, /environment: production-approval/);
  assert.match(manual, /PRODUCTION_APPROVAL_GATE_READY/);
  assert.match(manual, /confirmation must be exactly REPAIR/);
  assert.match(manual, /confirmation must be exactly DEPLOY/);
});

test('chat-approved bridge can execute only the fixed baseline repair', () => {
  assert.match(bridge, /environment: production/);
  assert.match(bridge, /SUPABASE_PROJECT_ID: fiepaguycecrredwrcwx/);
  assert.match(bridge, /REPAIR_VERSION: '20260815000000'/);
  assert.match(bridge, /20260815000000_initial_schema_baseline\.sql/);
  assert.match(bridge, /verify-production-initial-baseline-state\.sh/);
  assert.match(
    bridge,
    /supabase migration repair --status applied "\$REPAIR_VERSION"/
  );
  assert.doesNotMatch(bridge, /supabase db push --linked --yes/);
  assert.doesNotMatch(bridge, /mode:\s*deploy/);
});

test('Production boundary re-validates the exact claimed chat approval', () => {
  assert.match(
    bridge,
    /Re-validate claimed chat approval at Production boundary/
  );
  assert.match(bridge, /main changed before the Production boundary/);
  assert.match(bridge, /bridgeRunId == \$bridgeRunId/);
  assert.match(
    bridge,
    /exact claimed chat approval was not found at the Production boundary/
  );
  assert.match(bridge, /Checkout approved main/);
  assert.match(
    bridge,
    /test "\$\(git rev-parse HEAD\)" = "\$APPROVED_MAIN_SHA"/
  );
});

test('bridge cancels only one stale bot-dispatched manual run and blocks human overlap', () => {
  assert.match(bridge, /actor\.login != "github-actions\[bot\]"/);
  assert.match(
    bridge,
    /a human-started Supabase Production workflow is still active/
  );
  assert.match(bridge, /bot_active_count" -gt 1/);
  assert.match(bridge, /stale_head_sha" = "\$MAIN_SHA/);
  assert.match(bridge, /actions\/runs\/\$stale_run_id\/cancel/);
  assert.match(bridge, /run_conclusion" = 'cancelled'/);
});

test('chat-approved repair shares the Production migration concurrency lock', () => {
  assert.match(bridge, /group: supabase-production-migration/);
  assert.match(manual, /group: supabase-production-migration/);
});

test('chat-approved execution preserves post-mutation verification', () => {
  assert.match(bridge, /Verify production migration status after repair/);
  assert.match(bridge, /Verify production beta observability/);
  assert.match(bridge, /production-beta-verification/);
  assert.match(bridge, /Production beta observability verification failed/);
});
