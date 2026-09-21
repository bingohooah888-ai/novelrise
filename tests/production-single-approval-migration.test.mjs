import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalMigrationVersions,
  migrationVersionsFromPaths,
  sameVersions
} from '../scripts/resolve-production-migration-approval.mjs';

const workflow = await readFile(
  '.github/workflows/supabase-production-auto-deploy.yml',
  'utf8'
);
const resolver = await readFile(
  'scripts/resolve-production-migration-approval.mjs',
  'utf8'
);
const master = await readFile('docs/NOVELIGHT-MASTER.md', 'utf8');

test('normal Production migration route reuses the existing 本番承認', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /NOVELIGHT High-Risk PR Approval Relay/);
  assert.match(workflow, /Single-Approval Deploy/);
  assert.match(
    workflow,
    /node scripts\/resolve-production-migration-approval\.mjs/
  );
  assert.doesNotMatch(
    workflow,
    /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE/
  );
  assert.doesNotMatch(workflow, /environment: production-approval/);
  assert.match(workflow, /environment: production/);
});

test('resolver binds Production pending migrations to one approved source PR', () => {
  assert.match(resolver, /commits\/\$\{addingCommit\}\/pulls/);
  assert.match(
    resolver,
    /pending migrations do not originate from exactly one approved PR/
  );
  assert.match(
    resolver,
    /source PR migration set does not exactly match Production pending migrations/
  );
  assert.match(
    resolver,
    /Supabase migration files changed after the approved source PR merged/
  );
  assert.match(resolver, /highRiskApprovalChallenge/);
  assert.match(resolver, /highRiskApprovalCommentMatches/);
  assert.match(resolver, /author_association === 'OWNER'/);
  assert.match(resolver, /source migration PR lacks exact owner-authored 本番承認/);
});

test('single-approval workflow preserves Production safety rechecks', () => {
  assert.match(workflow, /Bind workflow to exact current main/);
  assert.match(workflow, /Require Production Readiness success for current main/);
  assert.match(workflow, /Require fresh Production backup/);
  assert.match(workflow, /Require Staging migration parity/);
  assert.match(
    workflow,
    /Require pending migrations to match the approved PR exactly/
  );
  assert.match(workflow, /Dry-run exact approved Production migrations/);
  assert.match(workflow, /Re-check current main before claim/);
  assert.match(workflow, /Re-confirm main and pending set after claim/);
  assert.match(workflow, /supabase db push --linked --dry-run --include-all/);
  assert.match(workflow, /supabase db push --linked --yes --include-all/);
  assert.match(workflow, /Verify Production migration status after mutation/);
  assert.match(workflow, /Verify Production beta observability/);
});

test('single-approval workflow records machine audit evidence without a second human approval', () => {
  assert.match(
    workflow,
    /NOVELIGHT_PRODUCTION_SINGLE_APPROVAL_MIGRATION_CLAIMED/
  );
  assert.match(
    workflow,
    /NOVELIGHT_PRODUCTION_SINGLE_APPROVAL_MIGRATION_EXECUTED/
  );
  assert.match(
    workflow,
    /NOVELIGHT_PRODUCTION_SINGLE_APPROVAL_MIGRATION_FAILED/
  );
  assert.match(
    workflow,
    /this single-approval migration scope was already claimed/
  );
  assert.match(workflow, /Production Approval Ledger exceeded the bounded comment contract/);
});

test('MASTER explicitly prohibits a second migration approval prompt', () => {
  assert.match(master, /Production DB \/ Supabase migration/);
  assert.match(master, /唯一の人間承認/);
  assert.match(master, /追加承認/);
  assert.match(master, /二回目の人間承認/);
});

test('migration version helpers stay canonical and exact', () => {
  assert.deepEqual(canonicalMigrationVersions('20260921120552,20260921130552'), [
    '20260921120552',
    '20260921130552'
  ]);
  assert.throws(
    () => canonicalMigrationVersions('20260921120552,20260921120552'),
    /duplicates/
  );
  assert.deepEqual(
    migrationVersionsFromPaths([
      'README.md',
      'supabase/migrations/20260921130552_second.sql',
      'supabase/migrations/20260921120552_first.sql'
    ]),
    ['20260921120552', '20260921130552']
  );
  assert.equal(
    sameVersions(
      ['20260921130552', '20260921120552'],
      ['20260921120552', '20260921130552']
    ),
    true
  );
  assert.equal(
    sameVersions(['20260921120552'], ['20260921130552']),
    false
  );
});
