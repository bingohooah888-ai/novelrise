import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  composeCommunityStagingForwardReconcile
} from '../scripts/community-staging-forward-reconcile.mjs';

const migration = readFileSync(
  'supabase/migrations/20261014052000_community_plaza_phase1.sql',
  'utf8'
);

test('compose guarded forward-only Staging SQL', () => {
  const sql = composeCommunityStagingForwardReconcile(migration);
  assert.match(sql, /^\\set ON_ERROR_STOP on$/m);
  assert.match(sql, /ADD COLUMN edited_at timestamptz/);
  const wrongDatabase = /Refusing different migration history or Production environment/;
  assert.match(sql, wrongDatabase);
  assert.match(sql, /Existing community content or consent; stop/);
  assert.match(sql, /Public gate changed during reconciliation/);
  assert.match(sql, /Required community RPC missing after replay/);
  assert.match(sql, /novelight_community_report_comment/);
  assert.match(sql, /novelight_admin_community_dismiss_report/);
  assert.match(sql, /ALTER TABLE public.community_runtime_control/);
  assert.equal(sql.match(/^BEGIN;$/gm)?.length, 1);
  assert.equal(sql.match(/^COMMIT;$/gm)?.length, 1);
  assert.doesNotMatch(sql, /INSERT INTO supabase_migrations/iu);
  assert.doesNotMatch(sql, /UPDATE supabase_migrations/iu);
  assert.doesNotMatch(sql, /DELETE FROM supabase_migrations/iu);
});

test('composer rejects malformed or unreviewed canonical SQL wrappers', () => {
  assert.throws(() => composeCommunityStagingForwardReconcile(''),
    /invalid canonical candidate migration/u);
  assert.throws(() => composeCommunityStagingForwardReconcile(
    migration.replace(/^BEGIN;$/m, '-- missing BEGIN')
  ), /wrapper\/version mismatch/u);
  assert.throws(() => composeCommunityStagingForwardReconcile(
    migration.replace(/^COMMIT;$/m, 'ROLLBACK;')
  ), /wrapper\/version mismatch/u);
  assert.throws(() => composeCommunityStagingForwardReconcile(
    migration.replace(/^COMMIT;$/m, 'COMMIT;\nCOMMIT;')
  ), /wrapper\/version mismatch/u);
});

test('composer refuses hidden ledger edits and psql metacommands', () => {
  assert.throws(() => composeCommunityStagingForwardReconcile(
    migration.replace(/^COMMIT;$/m,
      'UPDATE supabase_migrations.schema_migrations SET name=name;\nCOMMIT;')
  ), /ledger modification/u);
  assert.throws(() => composeCommunityStagingForwardReconcile(
    migration.replace(/^COMMIT;$/m, '\\i /tmp/unknown.sql\nCOMMIT;')
  ), /meta-command/u);
});
