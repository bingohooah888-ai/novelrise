import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20260926130000_scout_smoke_residue_cleanup.sql';
const fixturePath = 'scripts/production-auth-smoke-fixture.mjs';

const migration = readFileSync(migrationPath, 'utf8');
const fixture = readFileSync(fixturePath, 'utf8');

test('Production Auth Smoke cleanup is gated to internal_e2e identities', () => {
  assert.match(migration, /raw_app_meta_data\s*->>\s*'internal_e2e'/u);
  assert.match(migration, /before delete on public\.profiles/u);
  assert.match(
    migration,
    /novelight_cleanup_internal_e2e_scout_residue\(old\.id\)/u
  );

  const profileDelete = fixture.indexOf(
    "await deleteByIds('profiles', 'id', userIds);"
  );
  const authDelete = fixture.indexOf('admin.auth.admin.deleteUser(userId)');
  assert.ok(profileDelete >= 0, 'fixture must delete smoke profiles');
  assert.ok(authDelete >= 0, 'fixture must delete smoke auth users');
  assert.ok(
    profileDelete < authDelete,
    'profile cleanup must run while auth.users still retains internal_e2e metadata'
  );
});

test('SCOUT/read ledgers that can survive smoke cleanup are explicitly purged', () => {
  const expectedTables = [
    'scout_point_operator_actions',
    'scout_point_ledger',
    'scout_xp_ledger',
    'scout_event_ledger',
    'user_scout_badges',
    'scout_badge_metric_events',
    'scout_badge_metric_state',
    'scout_point_user_controls',
    'scout_record_usage_days',
    'light_seed_monthly_inventory',
    'seed_discovery_state',
    'valid_read_events',
    'valid_read_sessions',
    'scout_episode_badge_state'
  ];

  for (const table of expectedTables) {
    assert.match(
      migration,
      new RegExp(`delete from public\\.${table}\\b`, 'u'),
      `missing internal_e2e cleanup for ${table}`
    );
  }
});

test('one-time orphan cleanup is signature-based and never hardcodes generated user ids', () => {
  assert.match(migration, /novelight_scout_smoke_orphans/u);
  assert.match(migration, /event_type = 'light_seed_sent'/u);
  assert.match(migration, /event_type = 'valid_read'/u);
  assert.match(migration, /v_candidate_count > 50/u);
  assert.doesNotMatch(
    migration,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu
  );
});

test('reader_seed_001 point reconciliation is narrow and idempotent', () => {
  assert.match(migration, /b\.badge_id = 'reader_seed_001'/u);
  assert.match(migration, /d\.badge_category = 'reader'/u);
  assert.match(migration, /d\.point_reward > 0/u);
  assert.match(migration, /from public\.light_seeds s/u);
  assert.match(migration, /join public\.profiles profile/u);
  assert.match(migration, /join auth\.users auth_user/u);
  assert.match(
    migration,
    /'badge:' \|\| b\.user_id::text \|\| ':' \|\| b\.badge_id/u
  );
  assert.match(migration, /not exists \([\s\S]*public\.scout_point_ledger/u);
});
