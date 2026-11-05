import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import { REQUIRED_PRIVILEGED_PATHS } from '../scripts/scout-point10x-cas-fencing-handoff-model.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import {
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  CATALOG_SQL_PATH,
  PINNED_CATALOG_SQL_SHA256,
  PROPOSED_CATALOG_SCOPE,
  OWNER_CONTROL_ISSUE,
  REQUIRED_CATALOG_SECTIONS,
  CATALOG_RELATIONS,
  CATALOG_FUNCTIONS,
  CATALOG_ROLES,
  OWNER_READONLY_REVIEW_FIELDS,
  readPinnedCatalogSql,
  auditPoint10xCatalogSql,
  reviewProposedCatalogOwnerGate,
  reviewSyntheticCatalogSections
} from '../scripts/scout-point10x-catalog-readonly-review.mjs';
const sql = readPinnedCatalogSql();
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const noAuthority = (result) => {
  assert.equal(result.ownerEventAuthenticated, false);
  assert.equal(result.catalogQueryExecuted, false);
  assert.equal(result.actualCatalogChecked, false);
  for (const x of [
    'actualServiceRoleFenced',
    'actualWriterDrainProven',
    'mayReadDb',
    'mayRunSql',
    'mayWriteDb',
    'mayRunStaging',
    'mayUseDocker',
    'mayClaimOwner',
    'mayMergeMain',
    'mayDeploy',
    'mayModifyProduction'
  ])
    assert.equal(result[x], false, x);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.blockers));
};
const hold = (x, reason) => {
  assert.ok(
    x.blockers.includes(reason),
    'expected ' + reason + ', got ' + x.blockers.join(',')
  );
  noAuthority(x);
};
const request = () => ({
  issueNumber: 294,
  scope: PROPOSED_CATALOG_SCOPE,
  stagingRef: STAGING_PROJECT,
  mainSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  sqlSha256: PINNED_CATALOG_SQL_SHA256,
  operation: 'read-catalog-only',
  commentId: 456789
});
const completeFixture = () => ({
  'NL-CATALOG-01': [{ transaction_read_only: 'on' }],
  'NL-CATALOG-02': CATALOG_RELATIONS.map((expected_relation) => ({
    expected_relation,
    found: true
  })),
  'NL-CATALOG-03': [{ trigger_name: 'scout_xp_level_up_points' }],
  'NL-CATALOG-04': CATALOG_FUNCTIONS.map((signature) => ({
    signature,
    found: true
  })),
  'NL-CATALOG-05': CATALOG_ROLES.map((expected_role) => ({
    expected_role,
    found: true
  })),
  'NL-CATALOG-06': [],
  'NL-CATALOG-07': [],
  'NL-CATALOG-08': []
});
test('static SQL digest is pinned to exact inert local file', () => {
  assert.equal(PINNED_CATALOG_SQL_SHA256, sha(sql));
  assert.equal(
    CATALOG_SQL_PATH,
    'docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql'
  );
  assert.equal(
    sql,
    readFileSync(
      fileURLToPath(new URL('../' + CATALOG_SQL_PATH, import.meta.url)),
      'utf8'
    )
  );
});
test('exact catalog SQL is inert and has 8 SELECTs between read-only BEGIN and ROLLBACK', () => {
  const r = auditPoint10xCatalogSql(sql);
  assert.equal(
    r.status,
    'PINNED_INERT_SQL_STATIC_REVIEW_ONLY',
    r.blockers.join(',')
  );
  assert.equal(r.statementCount, 10);
  assert.equal(r.sectionCount, 8);
  assert.equal(r.readOnlyTransactionLexicallyConfirmed, true);
  assert.equal(r.catalogOnlyNotDataPlaneProof, true);
  assert.equal(r.sqlSha256, PINNED_CATALOG_SQL_SHA256);
  noAuthority(r);
});
test('exact SQL is not an active supabase migration', () => {
  hold(
    auditPoint10xCatalogSql(sql, 'supabase/migrations/20261105000000_live.sql'),
    'catalog_sql_outside_inert_plan'
  );
});
test('invalid or absent SQL cannot grant execution', () => {
  hold(auditPoint10xCatalogSql(null), 'sql_source_not_text');
  hold(auditPoint10xCatalogSql({}), 'sql_source_not_text');
});
test('unknown byte mutation fails digest pin', () => {
  hold(auditPoint10xCatalogSql(sql + ' '), 'catalog_sql_sha256_drift');
});
test('replacing BEGIN with write transaction fails', () => {
  const changed = sql.replace(
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    'BEGIN;'
  );
  hold(
    auditPoint10xCatalogSql(changed),
    'transaction_must_be_repeatable_read_read_only'
  );
});
test('missing ROLLBACK is rejected even with valid SELECTs', () => {
  hold(
    auditPoint10xCatalogSql(sql.replace('ROLLBACK;', '')),
    'must_rollback_after_catalog_selects'
  );
});
for (const action of [
  'UPDATE public.scout_point_ledger SET point_value=500;',
  'INSERT INTO public.scout_point_ledger VALUES (1);',
  'DELETE FROM public.scout_point_ledger;',
  'TRUNCATE public.scout_point_ledger;',
  "DO $$ BEGIN RAISE NOTICE 'unsafe'; END $$;",
  'GRANT ALL ON public.scout_point_ledger TO service_role;',
  'ALTER TABLE public.scout_point_ledger DISABLE TRIGGER USER;',
  'CALL public.an_admin_proc();',
  'COPY public.scout_point_ledger TO STDOUT;',
  'SET ROLE service_role;'
]) {
  test('injected SQL mutation refused: ' + action.slice(0, 25), () => {
    const injected = sql.replace('ROLLBACK;', action + '\nROLLBACK;');
    const r = auditPoint10xCatalogSql(injected);
    hold(r, 'catalog_sql_sha256_drift');
    assert.equal(r.mayWriteDb, false);
    assert.equal(r.mayRunSql, false);
  });
}
for (const fn of [
  'pg_sleep(10)',
  'pg_advisory_lock(123)',
  'set_config(' + "'session_replication_role','replica',false" + ')',
  'dblink_exec(' + "'remote','DROP TABLE t'" + ')',
  'pg_notify(' + "'change','1'" + ')',
  'nextval(' + "'seq'" + ')'
]) {
  test('unsafe SELECT function cannot be inserted: ' + fn.slice(0, 22), () => {
    const r = auditPoint10xCatalogSql(
      sql.replace('ROLLBACK;', 'SELECT ' + fn + ';\nROLLBACK;')
    );
    hold(r, 'potentially_mutating_select_function');
  });
}
for (const id of REQUIRED_CATALOG_SECTIONS) {
  test('one missing section fails-closed: ' + id, () => {
    const changed = sql.replace('-- ' + id + ':', '-- NL-MISSING:');
    hold(
      auditPoint10xCatalogSql(changed),
      'missing_or_duplicated_section:' + id
    );
  });
}
test('eight bounded sections are declared once and in order', () => {
  assert.equal(REQUIRED_CATALOG_SECTIONS.length, 8);
  let last = -1;
  for (const section of REQUIRED_CATALOG_SECTIONS) {
    const at = sql.indexOf('-- ' + section + ':');
    assert.ok(at > last);
    last = at;
  }
});
test('pg_catalog path covers required PostgreSQL catalog surfaces', () => {
  for (const term of [
    'pg_proc',
    'pg_trigger',
    'pg_class',
    'pg_roles',
    'pg_auth_members',
    'pg_default_acl',
    'pg_namespace',
    'pg_get_triggerdef',
    'pg_get_functiondef',
    'has_table_privilege',
    'has_function_privilege'
  ])
    assert.ok(sql.includes(term), term);
});
test('functions return hashes only, never reconstructed raw body text', () => {
  assert.match(sql, /md5\(pg_catalog\.pg_get_functiondef\(p\.oid\)\)/u);
  assert.doesNotMatch(
    sql,
    /ELSE\s+pg_catalog\.pg_get_functiondef\(p\.oid\)\s+END/u
  );
  assert.doesNotMatch(sql, /SELECT\s+.*\bp\.prosrc\b/iu);
});
test('role list includes privileged identities and makes unknown role explicit', () => {
  assert.deepEqual(
    [...CATALOG_ROLES],
    ['service_role', 'postgres', 'anon', 'authenticated', 'supabase_admin']
  );
  assert.match(sql, /WHERE rolname = 'service_role'/u);
  assert.match(sql, /r\.rolbypassrls/u);
});
test('includes INSERT UPDATE DELETE TRUNCATE and TRIGGER effective privileges', () => {
  for (const key of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER']) {
    assert.ok(sql.includes("c.oid, '" + key + "'"), key);
  }
});
test('source relation list covers point and event graphs', () => {
  assert.equal(CATALOG_RELATIONS.length, 9);
  for (const name of CATALOG_RELATIONS)
    assert.ok(sql.includes("'" + name + "'"));
});
test('exact signature list covers old and renamed functions', () => {
  assert.equal(CATALOG_FUNCTIONS.length, 12);
  for (const name of CATALOG_FUNCTIONS)
    assert.ok(sql.includes("'" + name + "'"));
});
test('pg_cron query does not access cron job payload', () => {
  assert.match(sql, /to_regclass\('cron\.job'\)/u);
  assert.doesNotMatch(sql, /FROM\s+cron\.job\b/iu);
});
test('SQL has no data-row reads of point/XP/badge ledgers', () => {
  assert.doesNotMatch(
    sql,
    /\bFROM\s+public\.(?:scout_point_ledger|scout_xp_ledger|user_scout_badges)/iu
  );
  assert.match(sql, /TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.ok(sql.trimEnd().endsWith('ROLLBACK;'));
});
test('approval scope is new proposal not existing write or rollback scopes', () => {
  assert.equal(
    PROPOSED_CATALOG_SCOPE,
    'reader-reward-beta-point-10x-staging-catalog-readonly'
  );
  assert.notEqual(PROPOSED_CATALOG_SCOPE, ATOMIC_PROOF_SCOPE);
  assert.notEqual(PROPOSED_CATALOG_SCOPE, ATOMIC_WRITE_SCOPE);
  assert.equal(OWNER_CONTROL_ISSUE, 294);
});
test('even well-shaped proposed approval does not authorize future SQL', () => {
  const r = reviewProposedCatalogOwnerGate(request());
  hold(r, 'owner_approval_not_issued_or_authenticated');
  hold(r, 'no_deployed_trusted_main_readonly_claim_executor');
  assert.equal(r.officialApprovalCreated, false);
  assert.equal(r.actualClaimCommitted, false);
  assert.equal(r.legacyScopesUnchanged, true);
});
for (const scope of [
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  'reader-reward-beta-point-10x-staging'
]) {
  test('older staging scope cannot authorize catalog read: ' + scope, () => {
    const r = reviewProposedCatalogOwnerGate({ ...request(), scope });
    hold(r, 'existing_scope_cannot_authorize_catalog_read');
    hold(r, 'new_readonly_scope_required');
  });
}
test('production project cannot authorize this audit', () => {
  hold(
    reviewProposedCatalogOwnerGate({
      ...request(),
      stagingRef: PRODUCTION_PROJECT
    }),
    'dedicated_staging_ref_required'
  );
});
test('wrong issue/comment cannot be used', () => {
  hold(
    reviewProposedCatalogOwnerGate({ ...request(), issueNumber: 295 }),
    'wrong_owner_control_issue'
  );
  hold(
    reviewProposedCatalogOwnerGate({ ...request(), commentId: -1 }),
    'unique_future_issue_comment_required'
  );
});
test('changed SQL digest, SHA, or operation refuses approval', () => {
  hold(
    reviewProposedCatalogOwnerGate({
      ...request(),
      sqlSha256: 'e'.repeat(64)
    }),
    'pinned_sql_digest_required'
  );
  hold(
    reviewProposedCatalogOwnerGate({
      ...request(),
      headSha: 'stale'
    }),
    'exact_main_and_head_sha_required'
  );
  hold(
    reviewProposedCatalogOwnerGate({
      ...request(),
      operation: 'atomic-persistent-staging-cutover'
    }),
    'read_only_operation_required'
  );
});
test('caller spoofing owner authentication and expiry are never trusted', () => {
  hold(
    reviewProposedCatalogOwnerGate({
      ...request(),
      ownerAuthEvidence: { isOwner: true },
      expiryConfirmed: true
    }),
    'caller_provided_owner_identity_is_not_trusted'
  );
  hold(
    reviewProposedCatalogOwnerGate({
      ...request(),
      expiryConfirmed: true
    }),
    'caller_provided_expiry_not_trusted'
  );
});
test('future separate OWNER approval requires 11 independent controls', () => {
  const r = reviewProposedCatalogOwnerGate(request());
  assert.equal(OWNER_READONLY_REVIEW_FIELDS.length, 11);
  assert.deepEqual(
    [...r.requiredConditions],
    [...OWNER_READONLY_REVIEW_FIELDS]
  );
});
test('null request never authenticates an OWNER', () => {
  hold(reviewProposedCatalogOwnerGate(null), 'request_invalid');
});
test('empty synthetic results never prove coverage', () => {
  const r = reviewSyntheticCatalogSections({});
  hold(r, 'missing_catalog_section:NL-CATALOG-01');
  hold(r, 'protected_relation_inventory_incomplete');
  hold(r, 'function_inventory_incomplete');
});
test('even perfect synthetic sections never authorize catalog access', () => {
  const r = reviewSyntheticCatalogSections(completeFixture());
  hold(r, 'synthetic_results_never_authorize_staging');
  assert.equal(r.fixtureOnly, true);
  assert.equal(r.catalogCompleteInLiveDatabase, false);
  assert.deepEqual([...r.writerClasses], [...SCOUT_POINT_10X_WRITER_CLASSES]);
  assert.deepEqual([...r.privilegedPaths], [...REQUIRED_PRIVILEGED_PATHS]);
});
for (const id of REQUIRED_CATALOG_SECTIONS) {
  test('missing synthetic section forces HOLD: ' + id, () => {
    const f = completeFixture();
    delete f[id];
    hold(reviewSyntheticCatalogSections(f), 'missing_catalog_section:' + id);
  });
}
test('mixed missing relation, function and role remain HOLD', () => {
  const f = completeFixture();
  f['NL-CATALOG-02'].pop();
  f['NL-CATALOG-04'].pop();
  f['NL-CATALOG-05'].pop();
  const r = reviewSyntheticCatalogSections(f);
  hold(r, 'protected_relation_inventory_incomplete');
  hold(r, 'function_inventory_incomplete');
  hold(r, 'role_inventory_incomplete');
});
test('synthetic read-write connection never passes read-only condition', () => {
  const f = completeFixture();
  f['NL-CATALOG-01'][0].transaction_read_only = 'off';
  hold(
    reviewSyntheticCatalogSections(f),
    'readonly_transaction_not_proven_in_fixture'
  );
});
test('missing synthetic level-up trigger cannot be inferred as safe', () => {
  const f = completeFixture();
  f['NL-CATALOG-03'] = [];
  hold(reviewSyntheticCatalogSections(f), 'level_up_trigger_unverified');
});
test('synthetic non-object rejected without throwing', () => {
  hold(reviewSyntheticCatalogSections(null), 'sections_invalid');
});
test('catalog adapter itself has no DB/Docker/approval mutation libraries', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        '../scripts/scout-point10x-catalog-readonly-review.mjs',
        import.meta.url
      )
    ),
    'utf8'
  );
  assert.doesNotMatch(source, /spawnSync\(\s*['"]docker/u);
  assert.doesNotMatch(source, /createClient\s*\(/u);
  assert.doesNotMatch(source, /execute_sql\s*\(/u);
  assert.match(source, /mayRunSql:\s*false/u);
});
