import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/production-migration-preflight.yml',
  'utf8'
);

test('Production migration preflight is owner-only and chat-triggered', () => {
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 165/);
  assert.match(workflow, /github\.event\.issue\.pull_request == null/);
  assert.match(
    workflow,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(
    workflow,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(workflow, /NOVELIGHT_PRODUCTION_MIGRATION_PREFLIGHT/);
});

test(
  'Production migration preflight is bound to the requested current main SHA',
  () => {
    assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
    assert.match(workflow, /Checkout latest main/);
    assert.match(workflow, /git rev-parse HEAD/);
    assert.match(workflow, /main changed after the request was created/);
  }
);

test('Production migration preflight is read-only', () => {
  assert.match(workflow, /supabase migration list --linked/);
  assert.match(workflow, /extract-supabase-pending\.sh/);
  assert.match(workflow, /supabase db push --linked --dry-run/);
  assert.match(workflow, /mutation: none/);

  assert.doesNotMatch(workflow, /supabase db push --linked --yes/);
  assert.doesNotMatch(workflow, /supabase migration repair/);
  assert.doesNotMatch(workflow, /confirmation must be exactly DEPLOY/);
  assert.doesNotMatch(workflow, /confirmation must be exactly REPAIR/);
  assert.doesNotMatch(workflow, /environment: production-approval/);
});

test(
  'Production migration preflight shares the Production migration concurrency lock',
  () => {
    assert.match(workflow, /group: supabase-production-migration/);
    assert.match(workflow, /cancel-in-progress: false/);
  }
);
