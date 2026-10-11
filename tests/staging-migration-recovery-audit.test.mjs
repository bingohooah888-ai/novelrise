import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assessStagingMigrationRecovery,
  auditStagingMigrationRecovery
} from '../scripts/audit-staging-migration-recovery.mjs';

const safe = {
  name: '20261011160000_public_discovery_card_state.sql',
  sql: 'create function public.example() returns int language sql as $$ select 1 $$;'
};

test('read-only recovery audit reports exact parity without authorizing mutation', () => {
  const report = assessStagingMigrationRecovery({
    localMigrations: [safe],
    remoteVersions: ['20261011160000'],
    checkNames: [],
    rollbackNames: []
  });
  assert.equal(report.migrationParity, true);
  assert.equal(report.automaticRepairAllowed, false);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.pending, []);
});

test('reports all missing migration artifacts and never treats drift as permission to sync', () => {
  const report = assessStagingMigrationRecovery({
    localMigrations: [
      {
        name: '20260930153337_search_card_metadata.sql',
        sql: 'create function public.test() returns int language sql as $$ select 2 $$;'
      },
      {
        name: '20261001124000_inquiry_categories.sql',
        sql: 'update public.contact_inquiries set category = subject;'
      }
    ],
    remoteVersions: ['20260930210000'],
    checkNames: [],
    rollbackNames: []
  });

  assert.equal(report.migrationParity, false);
  assert.equal(report.automaticRepairAllowed, false);
  assert.deepEqual(report.missingOnStaging, [
    '20260930153337',
    '20261001124000'
  ]);
  assert.deepEqual(report.unexpectedOnStaging, ['20260930210000']);
  assert.ok(report.blockers.includes('MULTIPLE_PENDING_MIGRATIONS'));
  assert.ok(report.blockers.includes('UNEXPECTED_STAGING_MIGRATION_HISTORY'));
  assert.ok(report.blockers.includes('MISSING_OR_AMBIGUOUS_SAFETY_ARTIFACTS'));
  assert.ok(
    report.blockers.includes('POTENTIAL_DATA_MUTATION_REQUIRES_MANUAL_REVIEW')
  );
  assert.deepEqual(report.pending[1].advisorySqlMutationMarkers, ['UPDATE']);
});

test('a single pending version with complete artifacts still cannot be auto-applied', () => {
  const version = '20261011160000';
  const report = assessStagingMigrationRecovery({
    localMigrations: [safe],
    remoteVersions: [],
    checkNames: [
      version + '_public_discovery_card_state_precheck.sql',
      version + '_public_discovery_card_state_postcheck.sql'
    ],
    rollbackNames: [version + '_public_discovery_card_state_rollback.sql']
  });
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.pending[0].artifacts, {
    precheck: true,
    postcheck: true,
    rollback: true
  });
  assert.equal(report.automaticRepairAllowed, false);
  assert.equal(report.migrationParity, false);
});

test('rejects ambiguous duplicate artifact files and duplicate history', () => {
  const version = '20261011160000';
  const report = assessStagingMigrationRecovery({
    localMigrations: [safe],
    remoteVersions: [],
    checkNames: [
      version + '_first_precheck.sql',
      version + '_second_precheck.sql',
      version + '_only_postcheck.sql'
    ],
    rollbackNames: [version + '_rollback.sql']
  });
  assert.equal(report.pending[0].artifactCountConflict, true);
  assert.ok(report.blockers.includes('MISSING_OR_AMBIGUOUS_SAFETY_ARTIFACTS'));
  assert.throws(
    () => {
      assessStagingMigrationRecovery({
        localMigrations: [safe, safe],
        remoteVersions: [],
        checkNames: [],
        rollbackNames: []
      });
    },
    /duplicate migration history/
  );
  assert.throws(
    () => {
      assessStagingMigrationRecovery({
        localMigrations: [safe],
        remoteVersions: [version, version],
        checkNames: [],
        rollbackNames: []
      });
    },
    /duplicate migration history/
  );
});

test('refuses the Production Supabase URL before reading files or contacting a server', async () => {
  let called = false;
  await assert.rejects(
    auditStagingMigrationRecovery(
      {
        STAGING_SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co',
        SUPABASE_ACCESS_TOKEN: 'never-used'
      },
      {
        root: '/does-not-exist',
        remoteReader: async () => {
          called = true;
          return [];
        }
      }
    ),
    /refusing the Production Supabase project/
  );
  assert.equal(called, false);
});

test('uses read-only remote migration history and local artifacts only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'novelight-staging-recovery-'));
  try {
    await mkdir(join(root, 'supabase/migrations'), { recursive: true });
    await mkdir(join(root, 'supabase/checks'));
    await mkdir(join(root, 'supabase/rollback'));
    await writeFile(join(root, 'supabase/migrations', safe.name), safe.sql);
    await writeFile(
      join(
        root,
        'supabase/checks/20261011160000_public_discovery_card_state_precheck.sql'
      ),
      'do $$ begin end $$;'
    );
    await writeFile(
      join(
        root,
        'supabase/checks/20261011160000_public_discovery_card_state_postcheck.sql'
      ),
      'do $$ begin end $$;'
    );
    await writeFile(
      join(
        root,
        'supabase/rollback/20261011160000_public_discovery_card_state_rollback.sql'
      ),
      'begin; rollback;'
    );

    let observed;
    const result = await auditStagingMigrationRecovery(
      {
        STAGING_SUPABASE_URL: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
        SUPABASE_ACCESS_TOKEN: 'test-token'
      },
      {
        root,
        remoteReader: async (args) => {
          observed = args;
          return [];
        }
      }
    );

    assert.equal(observed.projectRef, 'wmlzjgvxgoyrovdhbqbg');
    assert.equal(observed.accessToken, 'test-token');
    assert.equal(result.stagingProjectRef, 'wmlzjgvxgoyrovdhbqbg');
    assert.equal(result.pending[0].artifactCountConflict, false);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.automaticRepairAllowed, false);
    assert.ok(!JSON.stringify(result).includes('test-token'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
