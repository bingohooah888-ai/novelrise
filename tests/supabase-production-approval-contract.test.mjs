import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/supabase-production.yml',
  'utf8'
);

test('manual production mutations use exactly one production approval job', () => {
  assert.match(
    workflow,
    /approval:\n[\s\S]*?if: inputs\.mode == 'deploy' \|\| inputs\.mode == 'repair-history'[\s\S]*?environment: production-approval/
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
  assert.match(workflow, /needs: approval/);
  assert.match(workflow, /inputs\.mode == 'status'/);
  assert.match(workflow, /inputs\.mode == 'dry-run'/);
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
