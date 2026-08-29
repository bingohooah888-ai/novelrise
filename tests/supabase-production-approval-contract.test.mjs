import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/supabase-production.yml',
  'utf8'
);

test('production deploy verifies exact approved scope before human approval', () => {
  assert.match(
    workflow,
    /deploy_preflight:\n[\s\S]*?if: inputs\.mode == 'deploy'[\s\S]*?environment: production/
  );
  assert.match(
    workflow,
    /APPROVED_MAIN_SHA: \$\{\{ inputs\.approved_main_sha \}\}/
  );
  assert.match(
    workflow,
    /APPROVED_MIGRATIONS: \$\{\{ inputs\.approved_migrations \}\}/
  );
  assert.match(workflow, /Bind deploy to current main/);
  assert.match(workflow, /Verify claimed chat approval/);
  assert.match(
    workflow,
    /Require approved pending migrations before human approval/
  );
  assert.match(
    workflow,
    /Dry-run approved pending migrations before human approval/
  );
});

test('production mutations use exactly one production approval job', () => {
  assert.match(
    workflow,
    /approval:\n[\s\S]*?needs: deploy_preflight[\s\S]*?environment: production-approval/
  );
  assert.equal(
    workflow.match(/^\s+environment: production-approval$/gm)?.length,
    1
  );
  assert.match(
    workflow,
    /GATE_READY: \$\{\{ vars\.PRODUCTION_APPROVAL_GATE_READY \}\}/
  );
  assert.match(workflow, /\[ "\$GATE_READY" != 'true' \];/);
});

test('read-only modes bypass approval while mutations require its success', () => {
  assert.match(workflow, /inputs\.mode == 'status'/);
  assert.match(workflow, /inputs\.mode == 'dry-run'/);
  assert.match(
    workflow,
    /inputs\.mode == 'repair-history' && needs\.approval\.result == 'success'/
  );
  assert.match(workflow, /needs\.deploy_preflight\.result == 'success'/);
  assert.match(workflow, /needs\.approval\.result == 'success'/);
});

test('typed confirmations and mutation verification remain enforced', () => {
  assert.match(workflow, /\[ "\$CONFIRMATION" != 'REPAIR' \];/);
  assert.match(workflow, /\[ "\$CONFIRMATION" != 'DEPLOY' \];/);
  assert.match(workflow, /supabase db push --linked --dry-run/);
  assert.match(workflow, /supabase db push --linked --yes/);
  assert.match(workflow, /Verify production migration status after mutation/);
  assert.match(workflow, /Verify production beta observability/);
});

test('approved deploy scope is revalidated after Environment approval', () => {
  assert.match(workflow, /Re-bind approved deploy to current main/);
  assert.match(
    workflow,
    /Re-confirm approved pending migrations after human approval/
  );
  assert.match(
    workflow,
    /Dry-run approved pending migrations after human approval/
  );
  assert.match(workflow, /Apply approved pending migrations/);
});
