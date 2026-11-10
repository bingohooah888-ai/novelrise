import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import { REQUIRED_PRIVILEGED_PATHS } from '../scripts/scout-point10x-cas-fencing-handoff-model.mjs';
import {
  SOURCE_INVENTORY_ROOTS,
  SOURCE_WRITER_RULES,
  SOURCE_PRIVILEGE_RULES,
  PROTECTED_POINT_TABLES,
  SOURCE_GAP_CODES,
  readSourceWriterInput,
  reviewPoint10xTrackedSources
} from '../scripts/scout-point10x-source-writer-inventory.mjs';

const original = readSourceWriterInput();
const review = reviewPoint10xTrackedSources(original);
const clone = () => new Map(original);
const missing = (r, code) => {
  assert.equal(r.status, 'NO_GO_SOURCE_CODE_ONLY');
  assert.ok(
    r.blockers.includes(code),
    'expected ' + code + ' but got ' + r.blockers.join(',')
  );
  assert.equal(r.actualWriterFenced, false);
  assert.equal(r.actualPostgresCatalogRead, false);
  assert.equal(r.mayReadDb, false);
  assert.equal(r.mayWriteDb, false);
  assert.equal(r.mayRunStaging, false);
  assert.equal(r.mayUseDocker, false);
  assert.equal(r.mayMergeMain, false);
};
test('only checked-out code roots scanned, never DB or Docker', () => {
  assert.deepEqual(
    [...SOURCE_INVENTORY_ROOTS],
    [
      'supabase/migrations',
      'supabase/functions',
      'api',
      'src',
      '.github/workflows'
    ]
  );
  assert.ok(original.size > 300);
  assert.ok(Object.isFrozen(SOURCE_INVENTORY_ROOTS));
});
test('nine symbolic writer classes are mapped exactly to existing contract', () => {
  assert.equal(SOURCE_WRITER_RULES.length, 9);
  assert.deepEqual(
    SOURCE_WRITER_RULES.map((x) => x.kind),
    SCOUT_POINT_10X_WRITER_CLASSES
  );
  assert.deepEqual(
    review.classes.map((x) => x.kind),
    SCOUT_POINT_10X_WRITER_CLASSES
  );
});
test('five privileged route classes preserve canonical inventory', () => {
  assert.equal(SOURCE_PRIVILEGE_RULES.length, 5);
  assert.deepEqual(
    SOURCE_PRIVILEGE_RULES.map((x) => x.kind),
    REQUIRED_PRIVILEGED_PATHS
  );
  assert.equal(review.privilegedRouteCount, 5);
  assert.deepEqual(
    review.privileges.map((x) => x.kind),
    REQUIRED_PRIVILEGED_PATHS
  );
});
test('five protected relations are spelled correctly', () => {
  assert.deepEqual(
    [...PROTECTED_POINT_TABLES],
    [
      'scout_xp_ledger',
      'scout_point_ledger',
      'scout_badge_definitions',
      'user_scout_badges',
      'scout_point_operator_actions'
    ]
  );
});
test('repo source-only review NEVER means a live proof', () => {
  assert.equal(review.status, 'NO_GO_SOURCE_CODE_ONLY');
  assert.equal(review.sourceOnly, true);
  assert.equal(review.actualPostgresCatalogRead, false);
  assert.equal(review.deployedFunctionBodyVerified, false);
  assert.equal(review.actualWriterFenced, false);
  assert.equal(review.mayReadDb, false);
  assert.equal(review.mayWriteDb, false);
  assert.equal(review.mayRunStaging, false);
  assert.equal(review.mayUseDocker, false);
  assert.equal(review.mayMergeMain, false);
  assert.equal(review.mayDeploy, false);
});
test('2026-11 repo snapshot: baseline source coverage and 51 SQL DML sites', () => {
  // Adding a new tracked source should not break writer classification coverage.
  // The unchanged 51 DML sites remain pinned below.
  assert.ok(review.trackedSourceFileCount >= 429);
  assert.equal(review.mutationSites.length, 51);
  assert.equal(new Set(review.mutationSites.map((x) => x.path)).size, 15);
});
test('historical migrations identified but not mistaken for deployed state', () => {
  const classes = review.classes.filter((x) => x.evidence.length > 0);
  assert.equal(classes.length, 7);
  assert.ok(classes.every((x) => x.activeInProductionVerified === false));
  assert.ok(classes.every((x) => x.actualWriterFenced === false));
});
test('empty classes are unverified, never called safe', () => {
  for (const kind of [
    'scheduled_jobs_edge_and_queues',
    'inflight_retry_and_outbox_workers'
  ]) {
    const row = review.classes.find((x) => x.kind === kind);
    assert.equal(row.evidence.length, 0);
    assert.equal(row.activeInProductionVerified, false);
    assert.match(row.classification, /no_point_specific/u);
  }
});
test('client read-only analytics must not be reclassified as DML', () => {
  assert.equal(
    review.mutationSites.some(
      (x) => x.path === 'api/_lib/admin-scout-analytics.js'
    ),
    false
  );
});
test('source explicitly confirms latest known level-up trigger definition', () => {
  const r = review.classes.find((x) => x.kind === 'xp_insert_level_trigger');
  assert.equal(r.evidence.length, 2);
  assert.ok(
    r.evidence.every((x) =>
      x.path.endsWith('20260928061000_beta_rank_discovery_privacy.sql')
    )
  );
  assert.ok(r.evidence.every((x) => x.line > 200));
});
test('historically renamed rank function remains an ACL review obligation', () => {
  const r = review.classes.find((x) => x.kind === 'legacy_rank_internal_xp');
  assert.equal(r.evidence.length, 1);
  assert.equal(
    r.evidence[0].path,
    'supabase/migrations/20260928061000_beta_rank_discovery_privacy.sql'
  );
  assert.equal(r.activeInProductionVerified, false);
});
test('old point earning guard checks eligibility but no fencing epoch', () => {
  assert.equal(review.staticPointControlFunctionFound, true);
  assert.equal(review.staticPointControlEpochGuardFound, false);
  missing(review, 'DB_FENCE_NOT_FOUND_IN_LEGACY_POINT_CONTROL_TRIGGER');
});
test('old table revoke only names public, anon, authenticated', () => {
  assert.equal(review.staticRevokeExcludesServiceRole, true);
  missing(review, 'SERVICE_ROLE_NOT_REVOKED_BY_ANON_AUTHENTICATED_ONLY_SQL');
});
test('source metadata cannot prove actual service_role or owner ACL', () => {
  missing(review, 'RUNTIME_ROLE_ACL_CATALOG_NOT_READ');
  missing(review, 'SUPERUSER_TRIGGER_DDL_BYPASS_UNRESOLVED');
});
test('nine classes are contract taxonomy, not nine active verified paths', () => {
  missing(review, 'NINE_WRITER_CLASSES_NOT_NINE_VERIFIED_LIVE_PATHS');
});
test('edge Cron queue retry and future writers are not closed by a grep', () => {
  missing(review, 'EDGE_CRON_QUEUES_RETRIES_NOT_CLOSED_BY_REPO_INVENTORY');
  missing(review, 'FUTURE_WRITER_UNKNOWN');
});
test('source migration history never proves live deployment', () => {
  missing(review, 'SQL_MIGRATION_TEXT_NOT_LIVE_DEPLOYMENT_EVIDENCE');
});
test('all documented gap codes remain explicit', () => {
  for (const code of SOURCE_GAP_CODES)
    assert.ok(review.blockers.includes(code), code);
});
test('migrations list file and line but no actual data content', () => {
  assert.ok(Object.isFrozen(review));
  assert.ok(Object.isFrozen(review.classes));
  assert.ok(Object.isFrozen(review.mutationSites));
  assert.ok(Object.isFrozen(review.privileges));
  for (const row of review.mutationSites) {
    assert.ok(row.path.startsWith('supabase/migrations/'));
    assert.ok(Number.isSafeInteger(row.line) && row.line > 0);
    assert.equal(row.type, 'source_sql_reference_not_runtime_call');
    assert.ok(PROTECTED_POINT_TABLES.includes(row.table));
  }
});
for (const rule of SOURCE_WRITER_RULES.filter((x) => x.terms.length)) {
  test('missing source for writer path is fail-closed: ' + rule.kind, () => {
    const files = clone();
    for (const path of rule.paths) files.delete(path);
    missing(
      reviewPoint10xTrackedSources(files),
      'MISSING_PINNED_WRITER_SOURCE:' + rule.kind
    );
  });
}
for (const rule of SOURCE_PRIVILEGE_RULES.filter((x) => x.path)) {
  test('missing ACL/privileged source is fail-closed: ' + rule.kind, () => {
    const files = clone();
    files.delete(rule.path);
    missing(
      reviewPoint10xTrackedSources(files),
      'MISSING_PINNED_PRIVILEGE_SOURCE:' + rule.kind
    );
  });
}
test('new unregistered SQL point writer in API is detected', () => {
  const files = clone();
  files.set(
    'api/unreviewed-writer.js',
    'INSERT INTO public.scout_point_ledger (point_value) VALUES (50);'
  );
  const r = reviewPoint10xTrackedSources(files);
  missing(r, 'UNREGISTERED_APPLICATION_POINT_WRITER_CANDIDATE');
  assert.ok(r.mutationSites.some((x) => x.path === 'api/unreviewed-writer.js'));
});
for (const op of ['insert', 'upsert', 'update', 'delete']) {
  test('new Supabase client direct write is detected: ' + op, () => {
    const files = clone();
    files.set(
      'src/hidden-points.ts',
      "supabase.from('scout_point_ledger')." + op + '([{point_value:50}]);'
    );
    const r = reviewPoint10xTrackedSources(files);
    missing(r, 'CLIENT_DIRECT_SCOUT_DML_REQUIRES_GATE_REVIEW');
    missing(r, 'UNREGISTERED_APPLICATION_POINT_WRITER_CANDIDATE');
    assert.ok(
      r.mutationSites.some((x) => x.operation === 'CLIENT_' + op.toUpperCase())
    );
  });
}
test('new Edge writer in SQL text triggers source gate', () => {
  const files = clone();
  files.set(
    'supabase/functions/secret/award.sql',
    'insert into public.scout_point_ledger(point_value) values(20);'
  );
  const r = reviewPoint10xTrackedSources(files);
  missing(r, 'UNREGISTERED_APPLICATION_POINT_WRITER_CANDIDATE');
});
test('synthetic corrected guard does not accidentally grant live permission', () => {
  const files = clone();
  const path =
    'supabase/migrations/20260921025328_scout_record_usage_controls.sql';
  files.set(
    path,
    files
      .get(path)
      .replace(
        'if not public.novelight_scout_point_earning_allowed(new.user_id) then',
        'if not public.novelight_scout_point_earning_allowed(new.user_id) or fencing_epoch = 0 then'
      )
  );
  const r = reviewPoint10xTrackedSources(files);
  assert.equal(r.staticPointControlEpochGuardFound, true);
  assert.equal(r.status, 'NO_GO_SOURCE_CODE_ONLY');
  assert.equal(r.actualWriterFenced, false);
  missing(r, 'RUNTIME_ROLE_ACL_CATALOG_NOT_READ');
});
test('missing known guard body never yields a GO result', () => {
  const files = clone();
  files.delete(
    'supabase/migrations/20260921025328_scout_record_usage_controls.sql'
  );
  const r = reviewPoint10xTrackedSources(files);
  missing(r, 'LEGACY_POINT_CONTROL_FUNCTION_NOT_LOCATED');
});
test('wrong source format is not accepted', () => {
  const r = reviewPoint10xTrackedSources([]);
  assert.equal(r.status, 'HOLD_INVALID_SOURCE_INVENTORY');
  assert.equal(r.mayReadDb, false);
  assert.equal(r.mayWriteDb, false);
});
test('source inventory does not connect to Docker/DB via its code', () => {
  const src = readFileSync(
    fileURLToPath(
      new URL(
        '../scripts/scout-point10x-source-writer-inventory.mjs',
        import.meta.url
      )
    ),
    'utf8'
  );
  assert.doesNotMatch(src, /spawnSync\(['"]docker['"]/u);
  assert.doesNotMatch(src, /execute_sql\s*\(/u);
  assert.doesNotMatch(src, /createClient\s*\(/u);
  assert.match(src, /execFileSync\(\s*'git'/u);
  assert.match(src, /mayRunStaging:\s*false/u);
});
