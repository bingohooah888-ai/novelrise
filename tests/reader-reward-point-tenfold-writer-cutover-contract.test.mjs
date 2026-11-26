import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  SCOUT_POINT_10X_RPC_LEGACY_SHA256,
  SCOUT_POINT_10X_RPC_LEGACY_PG_MD5,
  SCOUT_POINT_10X_RPC_FUNCTION,
  SCOUT_POINT_10X_RPC_TRIGGER,
  SCOUT_POINT_10X_KNOWN_WRITERS,
  SCOUT_POINT_10X_WRITER_CLASSES,
  SCOUT_POINT_10X_DURABLE_RESOURCES,
  SCOUT_POINT_10X_DEPENDENCY_ORDER,
  SCOUT_POINT_10X_SCOPE,
  SCOUT_POINT_10X_STAGING_REF,
  quoteScoutLevelUp50ptDefinerCandidate,
  quoteScoutDefinerParity,
  quoteScoutOldUnitWriterStop,
  quoteScoutDurableMarker,
  quoteScoutPointTenfoldCutoverReadiness
} from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';

const baseline = readFileSync(
  new URL(
    './fixtures/reader-reward-levelup-trigger-legacy.sql',
    import.meta.url
  ),
  'utf8'
);
const h = (algorithm, source) =>
  createHash(algorithm).update(source, 'utf8').digest('hex');
const catalog = (patch = {}) => ({
  signature: SCOUT_POINT_10X_RPC_FUNCTION,
  owner: 'postgres',
  securityDefiner: true,
  config: ['search_path=""'],
  acl: ['postgres=X/postgres', 'service_role=X/postgres'],
  language: 'plpgsql',
  volatility: 'v',
  observedFunctionPgMd5: SCOUT_POINT_10X_RPC_LEGACY_PG_MD5,
  trigger: {
    name: SCOUT_POINT_10X_RPC_TRIGGER,
    table: 'public.scout_xp_ledger',
    enabled: true,
    event: 'AFTER INSERT',
    function: SCOUT_POINT_10X_RPC_FUNCTION
  },
  ...patch
});
const proposal = (custom = {}) =>
  quoteScoutLevelUp50ptDefinerCandidate({
    legacySql: baseline,
    catalog: catalog(),
    ...custom
  });
const forbidActions = (response) => {
  assert.equal(response.proposedOnly, true);
  for (const key of [
    'mayChangeStaging',
    'mayChangeProduction',
    'mayAlterFunction',
    'mayWriteDb',
    'mayAwardPoints',
    'mayDeploy',
    'mayMergeMain'
  ]) {
    assert.equal(response[key], false, key);
  }
  assert.equal(response.sourceWasExecuted, false);
  assert.equal(response.sourceCatalogWasIndependentlyVerified, false);
};
const writerInputs = () => ({
  paths: SCOUT_POINT_10X_KNOWN_WRITERS.map((name) => ({
    name,
    state: 'paused'
  })),
  classEvidence: Object.fromEntries(
    SCOUT_POINT_10X_WRITER_CLASSES.map((c) => [
      c,
      'independently_audited_paused'
    ])
  ),
  observedActiveTriggers: [SCOUT_POINT_10X_RPC_TRIGGER],
  unclassifiedDirectWrites: 0,
  inflightOperations: 0,
  durableFenceVerified: true
});
const markerInputs = () => ({
  scope: SCOUT_POINT_10X_SCOPE,
  fromUnit: '1pt_per_yen',
  toUnit: '10pt_per_yen',
  markerSchema: 'private_non_exposed',
  markerConstraint: 'unique_cutover_id_and_target_unit',
  writerUnitBarrier: true,
  atomicallyCommittedWithAllPointTablesAndRpc: true,
  immutableAuditPreserved: true,
  principalCanWriteMarker: false
});
const review = () =>
  quoteScoutDefinerParity({
    legacySql: baseline,
    candidateSql: proposal().candidateSql,
    catalog: catalog()
  });

test('fixture is the full official read-only observed function, not a hand-written approximation', () => {
  assert.ok(
    baseline.startsWith(
      'CREATE OR REPLACE FUNCTION public.novelight_award_level_up_points()'
    )
  );
  assert.equal(h('md5', baseline), SCOUT_POINT_10X_RPC_LEGACY_PG_MD5);
  assert.equal(h('sha256', baseline), SCOUT_POINT_10X_RPC_LEGACY_SHA256);
});
test('exact original 5pt candidate differs only by replacing the one award literal', () => {
  const x = proposal();
  assert.equal(x.status, 'source_diff_review_candidate_only');
  assert.equal(x.oldPointPerLevel, 5);
  assert.equal(x.newPointPerLevel, 50);
  assert.equal(x.changedTokenCount, 1);
  assert.equal(x.candidateSql.split('\n').length, baseline.split('\n').length);
  const replaced = x.candidateSql.replace(
    "\n      'level_up',\n      50,\n      'confirmed',",
    "\n      'level_up',\n      5,\n      'confirmed',"
  );
  assert.equal(replaced, baseline);
  forbidActions(x);
});
test('candidate SHA-256 is reproducible and differs from legacy', () => {
  const x = proposal();
  assert.equal(x.candidateSha256, h('sha256', x.candidateSql));
  assert.notEqual(x.candidateSha256, SCOUT_POINT_10X_RPC_LEGACY_SHA256);
});
test('SECURITY DEFINER language, empty search_path and signature remain unchanged', () => {
  const x = proposal();
  for (const text of [
    'SECURITY DEFINER',
    "SET search_path TO ''",
    'RETURNS trigger',
    'LANGUAGE plpgsql',
    'CREATE OR REPLACE FUNCTION public.novelight_award_level_up_points()'
  ]) {
    assert.ok(x.candidateSql.includes(text), text);
  }
});
test('function does not alter event key uniqueness, XP exclusion or reward metadata', () => {
  const x = proposal();
  for (const text of [
    "'light_seed_discovery'",
    'on conflict (event_key) do nothing',
    "'level_up:' || new.user_id::text || ':' || v_level::text",
    "'rule_version', 'chapter49-beta-rank-private-v1'"
  ]) {
    assert.ok(x.candidateSql.includes(text), text);
  }
});
test('source with extra newline fails content-addressed validation', () => {
  const x = proposal({ legacySql: baseline + '\n' });
  assert.equal(x.status, 'source_or_catalog_drift_hold');
  assert.ok(x.blockers.includes('legacy_source_exact_digest_mismatch'));
  forbidActions(x);
});
test('manually changed second code token invalidates content hash', () => {
  const x = proposal({
    legacySql: baseline.replace("'level_up:' ||", "'changed_level_up:' ||")
  });
  assert.equal(x.status, 'source_or_catalog_drift_hold');
});
test('already converted 50-point source cannot be converted again', () => {
  const x = proposal({
    legacySql: baseline.replace('\n      5,\n', '\n      50,\n')
  });
  assert.ok(x.blockers.includes('old_5pt_anchor_not_unique'));
});
test('unknown SQL source or no source always default denied', () => {
  for (const legacySql of [undefined, null, '', 123, {}]) {
    const x = proposal({ legacySql });
    assert.equal(x.status, 'source_or_catalog_drift_hold');
    forbidActions(x);
  }
});
test('wrong function signature blocked', () => {
  const x = proposal({ catalog: catalog({ signature: 'public.some_rpc()' }) });
  assert.ok(x.blockers.includes('unexpected_function_signature'));
});
test('SECURITY INVOKER is not a permitted silent mode change', () => {
  const x = proposal({ catalog: catalog({ securityDefiner: false }) });
  assert.ok(x.blockers.includes('security_definer_changed'));
});
test('unknown function owner blocked', () => {
  const x = proposal({ catalog: catalog({ owner: 'app_user' }) });
  assert.ok(x.blockers.includes('function_owner_drift'));
});
test('search_path change, or multiple config entries, blocked', () => {
  for (const c of [
    ['search_path=public'],
    ['search_path=""', 'statement_timeout=0'],
    []
  ]) {
    const x = proposal({ catalog: catalog({ config: c }) });
    assert.ok(x.blockers.includes('untrusted_search_path'));
  }
});
test('PUBLIC GRANT or a missing service_role GRANT blocks', () => {
  for (const acl of [
    ['PUBLIC=X/postgres', 'postgres=X/postgres'],
    ['postgres=X/postgres'],
    []
  ]) {
    const x = proposal({ catalog: catalog({ acl }) });
    assert.ok(x.blockers.includes('function_execute_acl_drift'));
  }
});
test('wrong volatility or function language blocked', () => {
  const a = proposal({ catalog: catalog({ volatility: 's' }) });
  const b = proposal({ catalog: catalog({ language: 'sql' }) });
  assert.ok(a.blockers.includes('unexpected_volatility'));
  assert.ok(b.blockers.includes('unexpected_language'));
});
test('trigger detached from XP ledger or disabled blocks', () => {
  for (const trigger of [
    { ...catalog().trigger, table: 'public.scout_point_ledger' },
    { ...catalog().trigger, enabled: false },
    { ...catalog().trigger, name: 'unknown' },
    { ...catalog().trigger, event: 'BEFORE UPDATE' }
  ]) {
    const x = proposal({ catalog: catalog({ trigger }) });
    assert.ok(x.blockers.includes('trigger_attachment_or_state_drift'));
  }
});
test('catalog digest must match observed Postgres definition', () => {
  const x = proposal({
    catalog: catalog({ observedFunctionPgMd5: '0'.repeat(32) })
  });
  assert.ok(x.blockers.includes('catalog_function_digest_drift'));
});
test('a missing catalog report cannot authorize candidate generation', () => {
  const x = quoteScoutLevelUp50ptDefinerCandidate({ legacySql: baseline });
  assert.ok(x.blockers.includes('missing_catalog_evidence'));
});
test('exact generated DDL parity is review-only and cannot deploy', () => {
  const x = review();
  assert.equal(x.status, 'exact_single_token_parity_only');
  assert.equal(x.matchesApprovedDiff, true);
  assert.equal(x.ownerAndGrantsRequirePostSqlAudit, true);
  forbidActions(x);
});
test('changing security definer to invoker in proposed source blocks', () => {
  const x = quoteScoutDefinerParity({
    legacySql: baseline,
    candidateSql: proposal().candidateSql.replace(
      'SECURITY DEFINER',
      'SECURITY INVOKER'
    ),
    catalog: catalog()
  });
  assert.equal(x.status, 'definer_candidate_drift_hold');
  assert.equal(x.matchesApprovedDiff, false);
});
test('changing 50 to 500 in proposed source blocks', () => {
  const x = quoteScoutDefinerParity({
    legacySql: baseline,
    candidateSql: proposal().candidateSql.replace(
      '\n      50,\n',
      '\n      500,\n'
    ),
    catalog: catalog()
  });
  assert.equal(x.status, 'definer_candidate_drift_hold');
});
test('unknown candidate does not qualify as reviewed source parity', () => {
  const x = quoteScoutDefinerParity({
    legacySql: baseline,
    catalog: catalog()
  });
  assert.equal(x.status, 'definer_candidate_drift_hold');
});
test('legacy catalog drift cascades to parity refusal', () => {
  const x = quoteScoutDefinerParity({
    legacySql: baseline,
    candidateSql: proposal().candidateSql,
    catalog: catalog({ owner: 'other' })
  });
  assert.equal(x.status, 'parity_unverified_hold');
});
test('inventory includes historical rank and discovery paths, not just one current trigger', () => {
  assert.ok(
    SCOUT_POINT_10X_KNOWN_WRITERS.some((s) =>
      s.includes('rank_internal_20260928')
    )
  );
  assert.ok(SCOUT_POINT_10X_KNOWN_WRITERS.some((s) => s.includes('discovery')));
  assert.ok(SCOUT_POINT_10X_KNOWN_WRITERS.some((s) => s.includes('badge')));
  assert.ok(SCOUT_POINT_10X_KNOWN_WRITERS.some((s) => s.includes('admin')));
});
test('missing inventory defaults to halt', () => {
  const x = quoteScoutOldUnitWriterStop();
  assert.equal(x.status, 'old_unit_writers_not_fully_fenced_hold');
  assert.ok(x.blockers.length >= 6);
  forbidActions(x);
});
test('even fully claimed fenced inventory never grants Staging write', () => {
  const x = quoteScoutOldUnitWriterStop(writerInputs());
  assert.equal(
    x.status,
    'all_caller_claims_complete_but_independent_proof_required'
  );
  assert.equal(x.safeToResume, false);
  assert.equal(x.cannotInferNoHiddenWriters, true);
  forbidActions(x);
});
test('every known old-unit writer is a required dependency', () => {
  for (const name of SCOUT_POINT_10X_KNOWN_WRITERS) {
    const args = writerInputs();
    args.paths = args.paths.filter((x) => x.name !== name);
    const x = quoteScoutOldUnitWriterStop(args);
    assert.ok(x.blockers.includes('unreviewed_known_writer:' + name), name);
  }
});
test('an unpaused writer blocks entire cutover', () => {
  const args = writerInputs();
  args.paths[0].state = 'active';
  const x = quoteScoutOldUnitWriterStop(args);
  assert.ok(x.blockers.some((s) => s.startsWith('writer_not_fenced:')));
});
test('invalid writer status and repeated paths block', () => {
  const args = writerInputs();
  args.paths[0].state = 'unrecognized';
  args.paths.push({ ...args.paths[0] });
  const x = quoteScoutOldUnitWriterStop(args);
  assert.ok(x.blockers.some((s) => s.startsWith('duplicate_writer:')));
  assert.ok(x.blockers.some((s) => s.startsWith('invalid_writer_status:')));
});
test('not all queue/cron/edge routes audited blocks cutover', () => {
  const args = writerInputs();
  delete args.classEvidence.scheduled_jobs_edge_and_queues;
  const x = quoteScoutOldUnitWriterStop(args);
  assert.ok(
    x.blockers.includes(
      'writer_class_not_proven:scheduled_jobs_edge_and_queues'
    )
  );
});
test('active XP trigger attachment cannot be assumed', () => {
  const args = writerInputs();
  args.observedActiveTriggers = [];
  const x = quoteScoutOldUnitWriterStop(args);
  assert.ok(x.blockers.includes('active_xp_trigger_not_accounted_for'));
});
test('unknown direct service role writer blocks', () => {
  const args = writerInputs();
  args.unclassifiedDirectWrites = 1;
  const x = quoteScoutOldUnitWriterStop(args);
  assert.ok(x.blockers.includes('unclassified_direct_db_writers'));
});
test('inflight points or retry operations block', () => {
  const args = writerInputs();
  args.inflightOperations = 2;
  const x = quoteScoutOldUnitWriterStop(args);
  assert.ok(x.blockers.includes('inflight_awards_or_retries'));
});
test('database enforced issuer fence is mandatory', () => {
  const args = writerInputs();
  args.durableFenceVerified = false;
  const x = quoteScoutOldUnitWriterStop(args);
  assert.ok(x.blockers.includes('database_enforced_writer_fence_unverified'));
});
test('bad writer inventory object types reject rather than infer', () => {
  assert.throws(() => quoteScoutOldUnitWriterStop({ paths: null }), TypeError);
  assert.throws(
    () => quoteScoutOldUnitWriterStop({ paths: [null] }),
    TypeError
  );
});
test('marker design blocks by default and creates nothing', () => {
  const x = quoteScoutDurableMarker();
  assert.equal(x.status, 'durable_marker_design_unverified_hold');
  assert.equal(x.markerCreated, false);
  assert.equal(x.migrationApplied, false);
  forbidActions(x);
});
test('all conceptual marker details still cannot create one or change DB', () => {
  const x = quoteScoutDurableMarker(markerInputs());
  assert.equal(x.status, 'durable_marker_designed_not_implemented');
  assert.equal(x.mayRerunConversion, false);
  assert.equal(x.markerCreated, false);
  forbidActions(x);
});
test('wrong scope or conversion direction blocks marker', () => {
  for (const change of [
    { scope: 'other' },
    { fromUnit: '10pt_per_yen' },
    { toUnit: '100pt_per_yen' }
  ]) {
    const x = quoteScoutDurableMarker({ ...markerInputs(), ...change });
    assert.ok(x.blockers.length > 0);
  }
});
test('marker must use a private non-exposed schema and uniqueness', () => {
  for (const change of [
    { markerSchema: 'public' },
    { markerConstraint: 'nonunique' }
  ]) {
    const x = quoteScoutDurableMarker({ ...markerInputs(), ...change });
    assert.equal(x.status, 'durable_marker_design_unverified_hold');
  }
});
test('marker must commit atomically with data AND writer function', () => {
  const x = quoteScoutDurableMarker({
    ...markerInputs(),
    atomicallyCommittedWithAllPointTablesAndRpc: false
  });
  assert.ok(x.blockers.includes('atomic_marker_and_rpc_commit_unverified'));
});
test('marker writable by client/user is unsafe', () => {
  const x = quoteScoutDurableMarker({
    ...markerInputs(),
    principalCanWriteMarker: true
  });
  assert.ok(x.blockers.includes('untrusted_principal_may_modify_marker'));
});
test('missing original event provenance blocks marker', () => {
  const x = quoteScoutDurableMarker({
    ...markerInputs(),
    immutableAuditPreserved: false
  });
  assert.ok(x.blockers.includes('original_event_provenance_not_preserved'));
});
test('untrusted all-green future requirements still cannot authorize DB writes', () => {
  const x = quoteScoutPointTenfoldCutoverReadiness({
    requirementStatus: Object.fromEntries(
      SCOUT_POINT_10X_DURABLE_RESOURCES.map((k) => [
        k,
        'independently_verified'
      ])
    ),
    priorRollbackOnlyProof: true,
    rpcParity: review(),
    writerStop: quoteScoutOldUnitWriterStop(writerInputs()),
    durableMarker: quoteScoutDurableMarker(markerInputs())
  });
  assert.deepEqual(x.missingOrUnverified, []);
  assert.equal(x.status, 'dependency_analysis_only_not_live_authority');
  assert.equal(x.stagingMigrationWasRun, false);
  assert.equal(x.productionMigrationWasRun, false);
  forbidActions(x);
});
test('current real-world state is all unresolved until approved SQL and Staging proof', () => {
  const x = quoteScoutPointTenfoldCutoverReadiness();
  assert.ok(
    x.missingOrUnverified.includes('owner_authorized_one_time_staging_scope')
  );
  assert.ok(
    x.missingOrUnverified.includes('rpc_source_parity_not_established')
  );
  assert.equal(x.insufficientWithoutNewStagingOwnerApproval, true);
});
test('dependency order puts backup and writer pause before transactional cutover', () => {
  const o = SCOUT_POINT_10X_DEPENDENCY_ORDER;
  const p = (needle) => o.findIndex((x) => x.includes(needle));
  assert.ok(p('independent_restore') < p('single_transaction'));
  assert.ok(p('writer_quiescence') < p('single_transaction'));
  assert.ok(p('unique_private_durable') < p('single_transaction'));
  assert.ok(p('single_transaction') < p('postcutover'));
  assert.ok(p('postcutover') < p('explicit_staging_reopen'));
  assert.ok(p('explicit_staging_reopen') < p('production_mutation'));
});
test('separate Production mutation gate cannot be absorbed into staging approval', () => {
  const x = quoteScoutPointTenfoldCutoverReadiness({ requirementStatus: {} });
  assert.ok(
    x.missingOrUnverified.includes(
      'separate_production_mutation_scope_and_approval'
    )
  );
  assert.equal(x.insufficientWithoutSeparateProductionOwnerApproval, true);
});
test('bad readiness requirement types rejected', () => {
  assert.throws(
    () => quoteScoutPointTenfoldCutoverReadiness({ requirementStatus: null }),
    TypeError
  );
});
test('all returned contracts and requirement arrays are immutable', () => {
  const a = proposal(),
    b = quoteScoutOldUnitWriterStop(writerInputs()),
    c = quoteScoutDurableMarker(markerInputs());
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(b.blockers));
  assert.ok(Object.isFrozen(c.requiredResources));
  assert.ok(Object.isFrozen(SCOUT_POINT_10X_DURABLE_RESOURCES));
});
test('Staging target is fixed and never presented as Production', () => {
  assert.equal(SCOUT_POINT_10X_STAGING_REF, 'wmlzjgvxgoyrovdhbqbg');
  assert.equal(SCOUT_POINT_10X_SCOPE, 'reader-reward-beta-point-10x-staging');
  assert.equal(proposal().mayChangeProduction, false);
});
