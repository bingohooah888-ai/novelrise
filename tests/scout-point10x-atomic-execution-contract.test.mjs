import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  ATOMIC_POINT10X_SCOPE,
  LEGACY_PROOF_SCOPE,
  ATOMIC_REVIEW_MODE,
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  ISSUE_NUMBER,
  MARKER_SQL_SHA256,
  NECESSARY_DDL_CLAUSES,
  WRITER_DB_RELATIONS,
  reviewScout10xAtomicApproval,
  reviewScoutPrivateMarkerDdl,
  reviewScoutSecDefinerReplacement,
  reviewScoutOldWriterFence,
  reviewScoutAtomicExecutorDependencies
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import {
  SCOUT_POINT_10X_WRITER_CLASSES,
  SCOUT_POINT_10X_KNOWN_WRITERS,
  SCOUT_POINT_10X_RPC_LEGACY_PG_MD5,
  quoteScoutLevelUp50ptDefinerCandidate
} from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';

const markerSql = readFileSync(
  new URL(
    '../docs/plans/READER-REWARD-POINT10X-PRIVATE-MARKER-REVIEW-20261105.sql',
    import.meta.url
  ),
  'utf8'
);
const legacySql = readFileSync(
  new URL(
    './fixtures/reader-reward-levelup-trigger-legacy.sql',
    import.meta.url
  ),
  'utf8'
);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const catalog = () => ({
  signature: 'public.novelight_award_level_up_points()',
  owner: 'postgres',
  securityDefiner: true,
  config: ['search_path=""'],
  acl: ['postgres=X/postgres', 'service_role=X/postgres'],
  language: 'plpgsql',
  volatility: 'v',
  observedFunctionPgMd5: SCOUT_POINT_10X_RPC_LEGACY_PG_MD5,
  trigger: {
    name: 'scout_xp_level_up_points',
    table: 'public.scout_xp_ledger',
    enabled: true,
    event: 'AFTER INSERT',
    function: 'public.novelight_award_level_up_points()'
  }
});
const proposed = () =>
  quoteScoutLevelUp50ptDefinerCandidate({ legacySql, catalog: catalog() })
    .candidateSql;
const approve = () => ({
  mainSha: 'a'.repeat(40),
  candidateSha: 'b'.repeat(40),
  prDraft: true,
  issueNumber: ISSUE_NUMBER,
  scope: ATOMIC_POINT10X_SCOPE,
  mode: ATOMIC_REVIEW_MODE,
  stagingProject: STAGING_PROJECT,
  owner: 'bingohooah888-ai',
  triggeringActor: 'bingohooah888-ai',
  authorAssociation: 'OWNER',
  trustedCodeOnMain: true,
  oneTimeClaimUnused: true,
  reviewedMarkerSqlSha256: MARKER_SQL_SHA256
});
const marker = () => ({
  sql: markerSql,
  reportedSchemaExposure: 'not_exposed_independently_verified',
  reportedActualSchemaExists: 'absent_independently_verified',
  reportedOwner: 'postgres_catalog_verified',
  reportedPublicGrants: 'none_independently_verified',
  reportedAnonGrants: 'none_independently_verified',
  reportedAuthenticatedGrants: 'none_independently_verified',
  reportedServiceRoleGrants: 'none_independently_verified'
});
const func = () => ({ legacySql, catalog: catalog(), proposedSql: proposed() });
const writers = () => ({
  writerClasses: SCOUT_POINT_10X_WRITER_CLASSES.map((name) => ({
    name,
    status: 'independently_fenced'
  })),
  knownFunctions: SCOUT_POINT_10X_KNOWN_WRITERS.map((name) => ({
    name,
    status: 'reachability_and_unit_fence_audited'
  })),
  relationLocks: WRITER_DB_RELATIONS.map((relation) => ({
    relation,
    lock: 'ACCESS EXCLUSIVE'
  })),
  directServiceRoleSql: 'independently_blocked',
  retries: 'independently_drained',
  cronAndEdge: 'independently_suspended',
  inflight: 0,
  dbEnforcedUnitBarrier: true,
  existingUnknownTriggers: 0
});
const full = () => ({
  approval: reviewScout10xAtomicApproval(approve()),
  marker: reviewScoutPrivateMarkerDdl(marker()),
  definer: reviewScoutSecDefinerReplacement(func()),
  writerFence: reviewScoutOldWriterFence(writers()),
  independentlyRestoredBackup: true,
  fullRowReconciliation: true,
  failureInjectionProof: true,
  postCommitRecoveryReviewed: true
});
const cannotExecute = (x) => {
  assert.equal(x.externallyVerified, false);
  assert.equal(x.liveProof, false);
  assert.equal(x.approvalConsumed, false);
  for (const field of [
    'mayRunStaging',
    'mayPersistStaging',
    'mayWriteProduction',
    'mayCreateSchema',
    'mayGrantPrivileges',
    'mayAlterSecurityDefiner',
    'mayStopWriters',
    'mayMergeMain',
    'mayDeploy',
    'mayTransferValue',
    'mayRunAI'
  ]) {
    assert.equal(x[field], false, field);
  }
  assert.ok(Object.isFrozen(x));
};
test('private marker source is SHA256-pinned without execution', () => {
  assert.equal(sha256(markerSql), MARKER_SQL_SHA256);
  assert.ok(markerSql.startsWith('-- REVIEW ONLY / DO NOT RUN'));
  assert.equal(
    markerSql.includes('CREATE SCHEMA novelight_reward_private;'),
    true
  );
});
test('all marker DDL clauses are present', () => {
  for (const clause of NECESSARY_DDL_CLAUSES)
    assert.ok(markerSql.includes(clause), clause);
});
test('marker uses one unique scope+version claim plus unique approval comment', () => {
  assert.ok(markerSql.includes('UNIQUE (cutover_scope, target_unit_version)'));
  assert.ok(markerSql.includes('UNIQUE (approval_comment_id)'));
});
test('marker does not grant anon, authenticated, service_role or PUBLIC', () => {
  assert.doesNotMatch(markerSql, /^\s*GRANT\s+/im);
  for (const who of ['PUBLIC', 'anon, authenticated, service_role'])
    assert.ok(markerSql.includes('FROM ' + who + ';'));
});
test('marker is in non-public schema with RLS enabled and forced', () => {
  assert.match(
    markerSql,
    /CREATE TABLE novelight_reward_private\.point_unit_cutovers/u
  );
  assert.match(markerSql, /ENABLE ROW LEVEL SECURITY;/u);
  assert.match(markerSql, /FORCE ROW LEVEL SECURITY;/u);
});
test('marker SQL does not create a SECURITY DEFINER or executable RPC', () => {
  assert.doesNotMatch(markerSql, /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/iu);
  assert.doesNotMatch(
    markerSql.replace(/^--.*$/gm, ''),
    /\bSECURITY\s+DEFINER\b/iu
  );
});
test('marker is not a real migration path, lives only in docs/plans', () => {
  assert.ok(!import.meta.url.includes('/supabase/migrations'));
  assert.match(markerSql, /NOT A SUPABASE MIGRATION/u);
});
test('new staging atomic scope is different from old rollback-only', () => {
  assert.notEqual(ATOMIC_POINT10X_SCOPE, LEGACY_PROOF_SCOPE);
  assert.equal(ATOMIC_REVIEW_MODE, 'contract-review-only');
});
test('production project reference is not staging project', () => {
  assert.notEqual(PRODUCTION_PROJECT, STAGING_PROJECT);
});
test('OWNER GitHub actor and issue scope are needed', () => {
  const x = reviewScout10xAtomicApproval(approve());
  assert.equal(x.status, 'self_asserted_review_contract_only');
  assert.equal(x.requiresGitHubIndependentEventAuthentication, true);
  cannotExecute(x);
});
test('default approval request fails closed', () => {
  const x = reviewScout10xAtomicApproval();
  assert.equal(x.status, 'approval_review_blocked');
  assert.ok(x.blockers.length > 3);
  cannotExecute(x);
});
test('old rollback-only scope cannot authorize atomic cutover', () => {
  const x = reviewScout10xAtomicApproval({
    ...approve(),
    scope: LEGACY_PROOF_SCOPE
  });
  assert.ok(x.blockers.includes('wrong_atomic_review_scope_or_mode'));
});
test('persistent modes cannot be smuggled into contract-review-only', () => {
  for (const mode of [
    'rollback-only',
    'atomic-persistent-staging-cutover',
    'persistent',
    null
  ]) {
    assert.ok(
      reviewScout10xAtomicApproval({ ...approve(), mode }).blockers.length > 0
    );
  }
});
test('wrong issue and non-owner actor are denied', () => {
  for (const mod of [
    { issueNumber: 188 },
    { owner: 'attacker' },
    { triggeringActor: 'github-actions[bot]' },
    { authorAssociation: 'MEMBER' }
  ]) {
    assert.ok(
      reviewScout10xAtomicApproval({ ...approve(), ...mod }).blockers.includes(
        'owner_issue_294_identity_unverified'
      )
    );
  }
});
test('wrong Staging ref or production ref are denied', () => {
  for (const stagingProject of [PRODUCTION_PROJECT, 'unknown', '']) {
    assert.ok(
      reviewScout10xAtomicApproval({
        ...approve(),
        stagingProject
      }).blockers.includes('wrong_staging_project')
    );
  }
});
test('wrong or identical main/head SHA rejected', () => {
  for (const mod of [
    { mainSha: 'oops' },
    { candidateSha: 'wrong' },
    { candidateSha: 'a'.repeat(40) }
  ]) {
    assert.ok(
      reviewScout10xAtomicApproval({ ...approve(), ...mod }).blockers.includes(
        'invalid_main_or_candidate_sha'
      )
    );
  }
});
test('Draft must stay open and trusted main code must already exist', () => {
  for (const mod of [
    { prDraft: false },
    { trustedCodeOnMain: false },
    { oneTimeClaimUnused: false }
  ]) {
    const x = reviewScout10xAtomicApproval({ ...approve(), ...mod });
    assert.equal(x.status, 'approval_review_blocked');
  }
});
test('marker SQL hash mismatch rejects approval', () => {
  const x = reviewScout10xAtomicApproval({
    ...approve(),
    reviewedMarkerSqlSha256: 'f'.repeat(64)
  });
  assert.ok(x.blockers.includes('private_marker_sql_digest_not_pinned'));
});
test('even all self reported OWNER checks never become an approval', () => {
  const x = reviewScout10xAtomicApproval(approve());
  assert.equal(x.approvalConsumed, false);
  assert.equal(x.persistentCutoverRequiresDistinctNewApproval, true);
  cannotExecute(x);
});
test('marker review requires independent exposure/privileges audit', () => {
  const x = reviewScoutPrivateMarkerDdl(marker());
  assert.equal(x.status, 'private_marker_review_candidate_only');
  assert.equal(x.markerCreated, false);
  cannotExecute(x);
});
test('marker missing schema exposure evidence blocks', () => {
  const x = reviewScoutPrivateMarkerDdl({
    ...marker(),
    reportedSchemaExposure: 'unknown'
  });
  assert.ok(x.blockers.includes('private_schema_data_api_exposure_unknown'));
});
test('marker pre-existing schema collision blocks', () => {
  const x = reviewScoutPrivateMarkerDdl({
    ...marker(),
    reportedActualSchemaExists: 'already_present'
  });
  assert.ok(x.blockers.includes('schema_collision_or_unproven_absence'));
});
test('unknown privileged schema owner blocks', () => {
  const x = reviewScoutPrivateMarkerDdl({
    ...marker(),
    reportedOwner: 'service_role'
  });
  assert.ok(x.blockers.includes('privileged_operator_owner_unreviewed'));
});
test('each unsafe role grant blocks reviewed marker', () => {
  for (const k of [
    'reportedPublicGrants',
    'reportedAnonGrants',
    'reportedAuthenticatedGrants',
    'reportedServiceRoleGrants'
  ]) {
    const x = reviewScoutPrivateMarkerDdl({ ...marker(), [k]: 'granted' });
    assert.equal(x.status, 'private_marker_ddl_review_blocked');
    assert.ok(x.blockers.some((v) => v.includes('role_access_not_verified')));
  }
});
test('marker DDL tampering and additional GRANT cannot pass digest check', () => {
  const x = reviewScoutPrivateMarkerDdl({
    ...marker(),
    sql: markerSql + '\nGRANT ALL TO PUBLIC;'
  });
  assert.equal(x.status, 'private_marker_ddl_review_blocked');
  assert.ok(x.blockers.includes('marker_source_sha256_not_exact'));
});
test('marker missing private schema revoke is held', () => {
  const x = reviewScoutPrivateMarkerDdl({
    ...marker(),
    sql: markerSql.replace(
      'REVOKE ALL ON SCHEMA novelight_reward_private FROM PUBLIC;',
      ''
    )
  });
  assert.ok(x.blockers.some((s) => s.includes('missing_expected_ddl_clause')));
});
test('invalid SQL input type is rejected', () => {
  for (const sql of [null, 12, {}, 'x'.repeat(30000)]) {
    assert.throws(
      () => reviewScoutPrivateMarkerDdl({ ...marker(), sql }),
      TypeError
    );
  }
});
test('reviewed SECURITY DEFINER proposal is exact literal 5 to 50', () => {
  const x = reviewScoutSecDefinerReplacement(func());
  assert.equal(x.status, 'secdefiner_exact_source_review_candidate_only');
  assert.equal(x.expectedOldReward, 5);
  assert.equal(x.proposedReward, 50);
  cannotExecute(x);
});
test('function candidate SHA comes from verified source', () => {
  const x = reviewScoutSecDefinerReplacement(func());
  assert.equal(x.candidateSha256, sha256(proposed()));
  assert.equal(x.functionReplaced, false);
});
test('changing any extra function statement fails source parity', () => {
  const c = func();
  c.proposedSql = c.proposedSql.replace('SECURITY DEFINER', 'SECURITY INVOKER');
  assert.equal(
    reviewScoutSecDefinerReplacement(c).status,
    'secdefiner_candidate_review_blocked'
  );
});
test('changing 50 to 500 is rejected', () => {
  const c = func();
  c.proposedSql = c.proposedSql.replace('\n      50,\n', '\n      500,\n');
  assert.ok(
    reviewScoutSecDefinerReplacement(c).blockers.includes(
      'candidate_not_exact_single_reward_token_diff'
    )
  );
});
test('wrong legacy catalog digest/ownership/ACL blocks', () => {
  for (const update of [
    { observedFunctionPgMd5: '0'.repeat(32) },
    { owner: 'other' },
    { acl: ['PUBLIC=X/postgres'] },
    { securityDefiner: false }
  ]) {
    const c = func();
    c.catalog = { ...c.catalog, ...update };
    assert.equal(
      reviewScoutSecDefinerReplacement(c).status,
      'secdefiner_candidate_review_blocked'
    );
  }
});
test('empty candidate cannot be auto-generated and applied', () => {
  const x = reviewScoutSecDefinerReplacement({ legacySql, catalog: catalog() });
  assert.equal(x.status, 'secdefiner_candidate_review_blocked');
  cannotExecute(x);
});
test('writer fence requires all nine classes and known legacy functions', () => {
  const x = reviewScoutOldWriterFence(writers());
  assert.equal(x.status, 'writer_fence_self_report_only');
  assert.equal(x.allWritersPausedInLiveSystem, false);
  cannotExecute(x);
});
test('no writer evidence blocks by default', () => {
  const x = reviewScoutOldWriterFence();
  assert.equal(x.status, 'writer_fence_unverified_hold');
  assert.ok(x.blockers.length > 10);
});
test('every known writer class must be explicitly fenced', () => {
  for (const name of SCOUT_POINT_10X_WRITER_CLASSES) {
    const s = writers();
    s.writerClasses = s.writerClasses.filter((e) => e.name !== name);
    assert.ok(
      reviewScoutOldWriterFence(s).blockers.includes(
        'writer_class_not_fenced:' + name
      )
    );
  }
});
test('duplicate writer class evidence fails closed', () => {
  const s = writers();
  s.writerClasses.push({ ...s.writerClasses[0] });
  assert.equal(
    reviewScoutOldWriterFence(s).status,
    'writer_fence_unverified_hold'
  );
});
test('old rank and badge RPCs cannot be skipped', () => {
  for (const fn of SCOUT_POINT_10X_KNOWN_WRITERS) {
    const s = writers();
    s.knownFunctions = s.knownFunctions.filter((e) => e.name !== fn);
    assert.ok(
      reviewScoutOldWriterFence(s).blockers.includes(
        'legacy_function_not_proven_unreachable:' + fn
      )
    );
  }
});
test('all five DB relations require exclusive lock review', () => {
  for (const relation of WRITER_DB_RELATIONS) {
    const s = writers();
    s.relationLocks = s.relationLocks.filter((e) => e.relation !== relation);
    assert.ok(
      reviewScoutOldWriterFence(s).blockers.includes(
        'db_lock_not_proven:' + relation
      )
    );
  }
});
test('READ lock is insufficient to fence a point writer', () => {
  const s = writers();
  s.relationLocks[0].lock = 'ACCESS SHARE';
  assert.equal(
    reviewScoutOldWriterFence(s).status,
    'writer_fence_unverified_hold'
  );
});
test('service_role bypassrls not assumed protected by RLS', () => {
  const s = writers();
  s.directServiceRoleSql = 'RLS_ON';
  const x = reviewScoutOldWriterFence(s);
  assert.ok(
    x.blockers.includes('service_role_bypass_rls_direct_sql_not_fenced')
  );
});
test('Cron / Edge routes require explicit isolation', () => {
  const s = writers();
  s.cronAndEdge = 'unknown';
  assert.ok(
    reviewScoutOldWriterFence(s).blockers.includes('cron_edge_not_suspended')
  );
});
test('retries, queue and inflight events must drain', () => {
  for (const m of [{ retries: 'active' }, { inflight: 3 }]) {
    assert.equal(
      reviewScoutOldWriterFence({ ...writers(), ...m }).status,
      'writer_fence_unverified_hold'
    );
  }
});
test('no unreviewed trigger is allowed', () => {
  const x = reviewScoutOldWriterFence({
    ...writers(),
    existingUnknownTriggers: 1
  });
  assert.ok(x.blockers.includes('unreviewed_trigger_or_function'));
});
test('writer fence must have DB-enforced durable unit barrier', () => {
  const x = reviewScoutOldWriterFence({
    ...writers(),
    dbEnforcedUnitBarrier: false
  });
  assert.ok(x.blockers.includes('db_enforced_unit_barrier_unverified'));
});
test('malformed writer inventory is not silently accepted', () => {
  assert.throws(
    () => reviewScoutOldWriterFence({ writerClasses: {} }),
    TypeError
  );
});
test('combined contract defaults to blocked and no authority', () => {
  const x = reviewScoutAtomicExecutorDependencies();
  assert.equal(x.status, 'atomic_executor_dependency_hold');
  cannotExecute(x);
});
test('combined all-good self-reported evidence is still never executable', () => {
  const x = reviewScoutAtomicExecutorDependencies(full());
  assert.equal(x.status, 'all_claimed_evidence_still_not_authorization');
  assert.equal(x.noTrustedMainAtomicRunnerImplemented, true);
  assert.equal(x.persistentStagingApprovalNotImplemented, true);
  assert.equal(x.realBackupNotRestored, true);
  cannotExecute(x);
});
test('combined contract fails if backup or recovery proof unverified', () => {
  for (const field of [
    'independentlyRestoredBackup',
    'fullRowReconciliation',
    'failureInjectionProof',
    'postCommitRecoveryReviewed'
  ]) {
    const x = reviewScoutAtomicExecutorDependencies({
      ...full(),
      [field]: false
    });
    assert.equal(x.status, 'atomic_executor_dependency_hold');
    assert.ok(x.blockers.length > 0);
  }
});
test('combined contract fails if definer or marker evidence withheld', () => {
  const data = full();
  data.definer = null;
  assert.equal(
    reviewScoutAtomicExecutorDependencies(data).status,
    'atomic_executor_dependency_hold'
  );
  const next = full();
  next.marker = null;
  assert.equal(
    reviewScoutAtomicExecutorDependencies(next).status,
    'atomic_executor_dependency_hold'
  );
});
