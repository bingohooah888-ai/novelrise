import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/production-migration-preflight.yml',
  'utf8'
);

const ownerLogin = /github\.event\.comment\.user\.login == 'bingohooah888-ai'/;
const ownerRole = /github\.event\.comment\.author_association == 'OWNER'/;

test('owner-only chat trigger', () => {
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.issue\.number == 165/);
  assert.match(workflow, /github\.event\.issue\.pull_request == null/);
  assert.match(workflow, ownerLogin);
  assert.match(workflow, ownerRole);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_MIGRATION_PREFLIGHT/);
});

test('current main SHA binding happens before cleanup and again before Supabase access', () => {
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /Checkout latest main for cleanup contract/);
  assert.match(workflow, /Bind cleanup request to current main/);
  assert.match(workflow, /main changed before stale-run cleanup/);
  assert.match(workflow, /Checkout latest main/);
  assert.match(workflow, /Bind preflight to current main/);
  assert.match(workflow, /main changed after the request was created/);
});

test('stale bridge cleanup runs outside the shared migration lock under narrow permissions', () => {
  const jobsIndex = workflow.indexOf('\njobs:');
  assert.ok(jobsIndex > 0);
  assert.doesNotMatch(workflow.slice(0, jobsIndex), /concurrency:/);

  assert.match(workflow, /cleanup_stale:/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /issues: read/);
  assert.match(workflow, /group: supabase-production-migration-stale-cleanup/);
  assert.match(
    workflow,
    /node scripts\/cleanup-stale-production-migration-run\.mjs/
  );
});

test('read-only Production operations remain behind cleanup and the shared migration lock', () => {
  assert.match(workflow, /needs: cleanup_stale/);
  assert.match(workflow, /group: supabase-production-migration/);
  assert.match(workflow, /cancel-in-progress: false/);
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
