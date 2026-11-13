import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  CATALOG_RELATIONS,
  CATALOG_FUNCTIONS,
  CATALOG_ROLES,
  REQUIRED_CATALOG_SECTIONS,
  PROPOSED_CATALOG_SCOPE,
  PINNED_CATALOG_SQL_SHA256
} from '../scripts/scout-point10x-catalog-readonly-review.mjs';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import { REQUIRED_PRIVILEGED_PATHS } from '../scripts/scout-point10x-cas-fencing-handoff-model.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import {
  CATALOG_EXPECTED_TRIGGERS,
  REQUIRED_ROLE_DML,
  ALLOWED_SECTION_FIELDS,
  reconcilePoint10xCatalogSnapshot,
  newOfflineCatalogOwnerLedger,
  simulateOfflineCatalogOwnerCas
} from '../scripts/scout-point10x-catalog-result-reconciler.mjs';

const fix = () => ({
  'NL-CATALOG-01': [
    {
      evidence_id: 'NL-CATALOG-01',
      database_name: 'synthetic_database',
      current_role_name: 'synthetic_readonly',
      session_role_name: 'synthetic_readonly',
      pg_server_version_num: '150017',
      transaction_read_only: 'on',
      is_in_recovery: false
    }
  ],
  'NL-CATALOG-02': CATALOG_RELATIONS.map((expected_relation) => ({
    evidence_id: 'NL-CATALOG-02',
    expected_relation,
    found: true,
    relkind: 'r',
    table_owner: 'postgres',
    rls_enabled: true,
    force_rls: true,
    explicit_acl: null,
    tested_role: 'service_role',
    tested_role_bypassrls: false,
    tested_role_superuser: false,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    can_trigger: false
  })),
  'NL-CATALOG-03': CATALOG_EXPECTED_TRIGGERS.map((x) => ({
    evidence_id: 'NL-CATALOG-03',
    expected_relation: x.relation,
    relation_found: true,
    trigger_name: x.trigger,
    trigger_enabled_state: 'O',
    internal_trigger: false,
    invoked_function: 'public.synthetic_reader_trigger()',
    trigger_definition: 'CREATE TRIGGER synthetic_review_fixture'
  })),
  'NL-CATALOG-04': CATALOG_FUNCTIONS.map((signature) => ({
    evidence_id: 'NL-CATALOG-04',
    signature,
    found: true,
    deployed_identity: signature,
    function_owner: 'postgres',
    is_security_definer: true,
    function_session_settings: ['search_path=public'],
    explicit_execute_acl: null,
    function_definition_md5: 'a'.repeat(32),
    tested_role: 'service_role',
    role_can_execute: false
  })),
  'NL-CATALOG-05': CATALOG_ROLES.map((expected_role) => ({
    evidence_id: 'NL-CATALOG-05',
    expected_role,
    found: true,
    rolsuper: expected_role === 'postgres',
    rolbypassrls: expected_role === 'postgres',
    rolinherit: true,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true
  })),
  'NL-CATALOG-06': [],
  'NL-CATALOG-07': [
    {
      evidence_id: 'NL-CATALOG-07',
      schema_name: 'public',
      schema_owner: 'postgres',
      schema_acl: null,
      default_object_type: null,
      default_grant_owner: null,
      default_acl: null
    }
  ],
  'NL-CATALOG-08': [
    {
      evidence_id: 'NL-CATALOG-08',
      cron_job_relation_exists: false,
      pg_cron_extension_installed: false
    }
  ]
});
const request = () => ({
  issueNumber: 294,
  scope: PROPOSED_CATALOG_SCOPE,
  stagingRef: STAGING_PROJECT,
  mainSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  sqlSha256: PINNED_CATALOG_SQL_SHA256,
  operation: 'read-catalog-only',
  commentId: 1234001
});
const audit = (x) => reconcilePoint10xCatalogSnapshot(x);
const cas = (ledger, patch = {}, opts = {}) =>
  simulateOfflineCatalogOwnerCas({
    ledger,
    request: { ...request(), ...patch },
    expectedVersion: ledger.version,
    expectedEpoch: ledger.epoch,
    ...opts
  });
function assertOffline(x) {
  assert.equal(x.sourceOfLiveTruth, false);
  assert.equal(x.actualDbConnected, false);
  assert.equal(x.trustedMainOwnerVerified, false);
  assert.equal(x.actualApprovalConsumed, false);
  assert.equal(x.actualDurableCasCommitted, false);
  assert.equal(x.actualDataPlaneFenced, false);
  assert.equal(x.allRealWritersVerified, false);
  assert.equal(x.actualCatalogSqlExecuted, false);
  for (const field of [
    'mayReadDb',
    'mayRunSql',
    'mayWriteDb',
    'mayRunStaging',
    'mayUseDocker',
    'mayClaimOwner',
    'mayResumeWriters',
    'mayMergeMain',
    'mayDeploy',
    'mayChangeProduction'
  ])
    assert.equal(x[field], false, field);
  assert.ok(Object.isFrozen(x));
  assert.ok(Object.isFrozen(x.blockers));
}
function blocked(x, code) {
  assert.ok(
    x.blockers.includes(code),
    code + ' not in ' + x.blockers.join(',')
  );
  assertOffline(x);
}
test('eight catalog IDs and nine relations match exactly previous SQL pack', () => {
  assert.equal(REQUIRED_CATALOG_SECTIONS.length, 8);
  assert.equal(CATALOG_RELATIONS.length, 9);
  assert.equal(CATALOG_FUNCTIONS.length, 12);
  assert.equal(CATALOG_ROLES.length, 5);
  assert.equal(Object.keys(fix()).length, 8);
  assert.ok(Object.isFrozen(CATALOG_EXPECTED_TRIGGERS));
  assert.ok(Object.isFrozen(ALLOWED_SECTION_FIELDS));
});
test('synthetic fully populated catalog remains NO-GO, no DB evidence', () => {
  const r = audit(fix());
  assert.equal(r.status, 'NO_GO_FIXTURE_ONLY_CATALOG_RECONCILIATION');
  assert.equal(r.countedRelations, 9);
  assert.equal(r.countedFunctions, 12);
  assert.equal(r.countedRoles, 5);
  assert.equal(r.countedTriggers, 4);
  assert.deepEqual([...r.sectionsSeen], REQUIRED_CATALOG_SECTIONS);
  assert.equal(r.unknownPrivilegedRouteCannotBeExcluded, true);
  assert.equal(r.catalogEvenIfCompleteNeverApprovesCutover, true);
  assertOffline(r);
});
test('nine Writer taxonomy and five privileged classes stay unchanged', () => {
  const r = audit(fix());
  assert.deepEqual([...r.writerClasses], SCOUT_POINT_10X_WRITER_CLASSES);
  assert.deepEqual([...r.privilegedPathCategories], REQUIRED_PRIVILEGED_PATHS);
  assert.equal(r.writerClasses.length, 9);
  assert.equal(r.privilegedPathCategories.length, 5);
});
for (const permanent of [
  'NO_LIVE_STAGING_CATALOG_EVIDENCE',
  'NINE_WRITER_CLASSES_NOT_FULL_RUNTIME_CALL_GRAPH',
  'FIVE_PRIVILEGED_ROUTES_NOT_FENCED',
  'EXTERNAL_EDGE_CRON_QUEUE_RETRY_UNVERIFIED',
  'FUNCTION_BODY_HASH_NOT_BEHAVIOR_PROOF',
  'TRIGGER_AND_RLS_CANNOT_PROVE_PRIVILEGED_FENCE'
]) {
  test('even green-looking fixture cannot remove NO-GO: ' + permanent, () => {
    blocked(audit(fix()), permanent);
  });
}
test('wrong root and missing sections denied without exception', () => {
  blocked(audit(null), 'EIGHT_CATALOG_SECTIONS_REQUIRED');
  blocked(audit([]), 'EIGHT_CATALOG_SECTIONS_REQUIRED');
  blocked(audit({}), 'MISSING_OR_NONARRAY_SECTION:NL-CATALOG-01');
});
for (const id of REQUIRED_CATALOG_SECTIONS) {
  test('missing catalog section is a hard blocker: ' + id, () => {
    const a = fix();
    delete a[id];
    blocked(audit(a), 'MISSING_OR_NONARRAY_SECTION:' + id);
  });
  test('wrong evidence_id is detected: ' + id, () => {
    const a = fix();
    a[id].push({ evidence_id: 'NL-CATALOG-99' });
    blocked(audit(a), 'EVIDENCE_ID_MISMATCH:' + id);
  });
}
test('unexpected extra catalog section is not silently merged', () => {
  const a = fix();
  a['NL-CATALOG-99'] = [{ evidence_id: 'NL-CATALOG-99' }];
  blocked(audit(a), 'UNEXPECTED_CATALOG_SECTION');
});
test('unrecognized secret-like column is never accepted', () => {
  const a = fix();
  a['NL-CATALOG-01'][0].api_token = 'SECRET_DO_NOT_ECHO';
  const r = audit(a);
  blocked(r, 'UNEXPECTED_OUTPUT_FIELD:NL-CATALOG-01');
  assert.ok(!JSON.stringify(r).includes('SECRET_DO_NOT_ECHO'));
});
test('nonrecord section row is denied', () => {
  const a = fix();
  a['NL-CATALOG-02'].push(null);
  blocked(audit(a), 'MALFORMED_ROW:NL-CATALOG-02');
});
test('bounded output refuses oversized fake catalog', () => {
  const a = fix();
  a['NL-CATALOG-03'] = Array.from({ length: 513 }, () => ({}));
  blocked(audit(a), 'OVERSIZED_SECTION:NL-CATALOG-03');
});
test('database identity requires single card', () => {
  const a = fix();
  a['NL-CATALOG-01'].push({ ...a['NL-CATALOG-01'][0] });
  blocked(audit(a), 'INVALID_CATALOG_IDENTITY_CARDINALITY');
});
for (const [key, value] of [
  ['transaction_read_only', 'off'],
  ['database_name', null],
  ['current_role_name', null],
  ['pg_server_version_num', '140017']
]) {
  test('invalid read-only / database identity rejected: ' + key, () => {
    const a = fix();
    a['NL-CATALOG-01'][0][key] = value;
    blocked(audit(a), 'READONLY_DATABASE_IDENTITY_NOT_VERIFIED');
  });
}
test('unknown recovery state rejected', () => {
  const a = fix();
  a['NL-CATALOG-01'][0].is_in_recovery = null;
  blocked(audit(a), 'DATABASE_RECOVERY_STATE_UNKNOWN');
});
for (const relation of CATALOG_RELATIONS) {
  test('missing protected relation cannot disappear: ' + relation, () => {
    const a = fix();
    a['NL-CATALOG-02'] = a['NL-CATALOG-02'].filter(
      (x) => x.expected_relation !== relation
    );
    blocked(audit(a), 'MISSING_RELATION:' + relation);
  });
}
test('duplicate relation and extra relation rejected', () => {
  const a = fix();
  a['NL-CATALOG-02'].push({ ...a['NL-CATALOG-02'][0] });
  blocked(audit(a), 'DUPLICATE_RELATION:' + CATALOG_RELATIONS[0]);
  a['NL-CATALOG-02'][9].expected_relation = 'secret_other_ledger';
  blocked(audit(a), 'UNKNOWN_RELATION_IDENTITY');
});
test('relation absent, wrong type or missing owner is not reported safe', () => {
  for (const [key, value, reason] of [
    ['found', false, 'RELATION_NOT_FOUND:' + CATALOG_RELATIONS[0]],
    ['relkind', 'v', 'UNEXPECTED_RELATION_KIND:' + CATALOG_RELATIONS[0]],
    ['table_owner', null, 'RELATION_OWNER_UNKNOWN:' + CATALOG_RELATIONS[0]],
    ['rls_enabled', false, 'RLS_DISABLED_OR_UNKNOWN:' + CATALOG_RELATIONS[0]]
  ]) {
    const a = fix();
    a['NL-CATALOG-02'][0][key] = value;
    blocked(audit(a), reason);
  }
});
test('missing actual service_role is not equivalent to no rights', () => {
  const a = fix();
  a['NL-CATALOG-02'][0].tested_role = null;
  a['NL-CATALOG-05'][0].found = false;
  blocked(audit(a), 'SERVICE_ROLE_NOT_RESOLVED:' + CATALOG_RELATIONS[0]);
  blocked(audit(a), 'ROLE_ABSENT_OR_UNKNOWN:service_role');
});
test('RLS-bypassing service_role always requires a stronger fence', () => {
  const a = fix();
  a['NL-CATALOG-02'][0].tested_role_bypassrls = true;
  blocked(audit(a), 'SERVICE_ROLE_BYPASSES_RLS:' + CATALOG_RELATIONS[0]);
});
test('superuser authority is an explicit unsafe route', () => {
  const a = fix();
  a['NL-CATALOG-02'][0].tested_role_superuser = true;
  blocked(audit(a), 'SERVICE_ROLE_SUPERUSER:' + CATALOG_RELATIONS[0]);
});
for (const field of REQUIRED_ROLE_DML) {
  test('service_role has effective table privilege: ' + field, () => {
    const a = fix();
    a['NL-CATALOG-02'][0][field] = true;
    blocked(
      audit(a),
      'SERVICE_ROLE_EFFECTIVE_DML_OR_DDL_PRIVILEGE:' +
        CATALOG_RELATIONS[0] +
        ':' +
        field
    );
  });
  test('NULL is unknown and is not treated as false: ' + field, () => {
    const a = fix();
    a['NL-CATALOG-02'][0][field] = null;
    blocked(
      audit(a),
      'NO_PROVEN_DENIAL_OF_PRIVILEGE:' + CATALOG_RELATIONS[0] + ':' + field
    );
  });
}
for (const trigger of CATALOG_EXPECTED_TRIGGERS) {
  test('missing real expected trigger blocks: ' + trigger.trigger, () => {
    const a = fix();
    a['NL-CATALOG-03'] = a['NL-CATALOG-03'].filter(
      (x) => x.trigger_name !== trigger.trigger
    );
    blocked(audit(a), 'EXPECTED_TRIGGER_MISSING:' + trigger.trigger);
  });
}
for (const state of ['D', 'R', 'X', null]) {
  test(
    'trigger state is not automatically executable: ' + String(state),
    () => {
      const a = fix();
      a['NL-CATALOG-03'][0].trigger_enabled_state = state;
      const code =
        state === 'D' || state === 'R'
          ? 'EXPECTED_TRIGGER_NOT_ORIGIN_ENABLED'
          : 'TRIGGER_ENABLED_STATE_UNKNOWN';
      blocked(audit(a), code + ':scout_xp_ledger|scout_xp_level_up_points');
    }
  );
}
test('trigger function unknown or definition missing', () => {
  const a = fix();
  a['NL-CATALOG-03'][0].invoked_function = null;
  blocked(
    audit(a),
    'TRIGGER_FUNCTION_NOT_RESOLVED:scout_xp_ledger|scout_xp_level_up_points'
  );
  a['NL-CATALOG-03'][0].trigger_definition = null;
  blocked(
    audit(a),
    'TRIGGER_METADATA_NOT_VERIFIED:scout_xp_ledger|scout_xp_level_up_points'
  );
});
test('unregistered trigger may be a privileged bypass', () => {
  const a = fix();
  a['NL-CATALOG-03'].push({
    ...a['NL-CATALOG-03'][0],
    trigger_name: 'scout_hidden_writer'
  });
  blocked(audit(a), 'UNREGISTERED_TRIGGER_REQUIRES_REVIEW');
});
test('duplicate trigger never silently overwrites', () => {
  const a = fix();
  a['NL-CATALOG-03'].push({ ...a['NL-CATALOG-03'][0] });
  blocked(audit(a), 'DUPLICATE_TRIGGER_DEFINITION');
});
test('trigger attached to unknown relation causes hold', () => {
  const a = fix();
  a['NL-CATALOG-03'][0].expected_relation = 'unknown';
  blocked(audit(a), 'UNKNOWN_TRIGGER_RELATION');
});
for (const sig of CATALOG_FUNCTIONS) {
  test(
    'missing function/signature cannot be inferred safe: ' + sig.slice(0, 58),
    () => {
      const a = fix();
      a['NL-CATALOG-04'] = a['NL-CATALOG-04'].filter(
        (x) => x.signature !== sig
      );
      blocked(audit(a), 'MISSING_FUNCTION:' + sig);
    }
  );
}
test('old renamed legacy RPC present and executable is a blocker', () => {
  const a = fix();
  const name =
    'public.novelight_award_level_up_points_rank_internal_20260928()';
  const f = a['NL-CATALOG-04'].find((x) => x.signature === name);
  f.role_can_execute = true;
  blocked(audit(a), 'LEGACY_RENAMED_RPC_NOT_PROVEN_REVOKED:' + name);
  blocked(audit(a), 'SERVICE_ROLE_CAN_EXECUTE_FUNCTION:' + name);
});
test('definer function without search_path is unsafe', () => {
  const a = fix();
  a['NL-CATALOG-04'][0].function_session_settings = null;
  blocked(audit(a), 'SECDEF_SEARCH_PATH_NOT_FIXED:' + CATALOG_FUNCTIONS[0]);
});
test('definer owner unknown or outside checked role catalog is unsafe', () => {
  const a = fix();
  a['NL-CATALOG-04'][0].function_owner = null;
  blocked(audit(a), 'SECDEF_FUNCTION_OWNER_UNKNOWN:' + CATALOG_FUNCTIONS[0]);
  a['NL-CATALOG-04'][0].function_owner = 'undisclosed_owner';
  blocked(
    audit(a),
    'SECDEF_OWNER_ROLE_FLAGS_NOT_QUERIED:' + CATALOG_FUNCTIONS[0]
  );
});
test('unknown function execute and definition hash do not mean revocation', () => {
  const a = fix();
  a['NL-CATALOG-04'][0].role_can_execute = null;
  a['NL-CATALOG-04'][0].function_definition_md5 = null;
  blocked(
    audit(a),
    'FUNCTION_EXECUTE_PRIVILEGE_UNKNOWN:' + CATALOG_FUNCTIONS[0]
  );
  blocked(
    audit(a),
    'FUNCTION_DEFINITION_DIGEST_UNAVAILABLE:' + CATALOG_FUNCTIONS[0]
  );
});
test('unknown function security mode is a hold', () => {
  const a = fix();
  a['NL-CATALOG-04'][0].is_security_definer = null;
  blocked(audit(a), 'FUNCTION_SECURITY_MODE_UNKNOWN:' + CATALOG_FUNCTIONS[0]);
});
for (const role of CATALOG_ROLES) {
  test('missing privileged role is an evidence gap: ' + role, () => {
    const a = fix();
    a['NL-CATALOG-05'] = a['NL-CATALOG-05'].filter(
      (x) => x.expected_role !== role
    );
    blocked(audit(a), 'MISSING_ROLE:' + role);
  });
}
test('broken role flags never imply no bypass', () => {
  const a = fix();
  a['NL-CATALOG-05'][0].rolbypassrls = null;
  blocked(audit(a), 'ROLE_FLAG_UNKNOWN:service_role:rolbypassrls');
});
test('role membership to service_role always escalates scrutiny', () => {
  const a = fix();
  a['NL-CATALOG-06'].push({
    evidence_id: 'NL-CATALOG-06',
    granted_role: 'service_role',
    member_role: 'test_runner',
    grantor_role: 'postgres',
    admin_option: false
  });
  blocked(audit(a), 'SERVICE_ROLE_MEMBERSHIP_PATH_REQUIRES_MANUAL_REVIEW');
});
test('incomplete role membership metadata is not ignored', () => {
  const a = fix();
  a['NL-CATALOG-06'].push({
    evidence_id: 'NL-CATALOG-06',
    granted_role: null,
    member_role: null,
    grantor_role: null,
    admin_option: null
  });
  blocked(audit(a), 'ROLE_MEMBERSHIP_METADATA_INCOMPLETE');
});
test('missing public schema default ACL metadata is not safe', () => {
  const a = fix();
  a['NL-CATALOG-07'] = [];
  blocked(audit(a), 'PUBLIC_SCHEMA_ACL_NOT_IN_SNAPSHOT');
});
test('unknown default ACL field is not accepted', () => {
  const a = fix();
  a['NL-CATALOG-07'][0].default_acl = { raw: 'not a string' };
  blocked(audit(a), 'DEFAULT_ACL_METADATA_INVALID');
});
test('cron enabled means external jobs not proven stopped', () => {
  const a = fix();
  a['NL-CATALOG-08'][0].pg_cron_extension_installed = true;
  blocked(audit(a), 'CRON_PRESENT_JOBS_UNINSPECTED');
});
test('cron absent still does not close external Edge/queue writers', () => {
  blocked(audit(fix()), 'EXTERNAL_EDGE_CRON_QUEUE_RETRY_UNVERIFIED');
});
test('missing cron query is unknown, not false', () => {
  const a = fix();
  a['NL-CATALOG-08'] = [];
  blocked(audit(a), 'CRON_METADATA_UNKNOWN');
});
test('snapshot never reprints fixture database details or secrets', () => {
  const a = fix();
  a['NL-CATALOG-01'][0].database_name = 'SECRET_FIXTURE_NOT_EXPOSED';
  const result = audit(a);
  assert.ok(!JSON.stringify(result).includes('SECRET_FIXTURE_NOT_EXPOSED'));
});
test('offline CAS ledger starts empty in shared mutation domain', () => {
  const l = newOfflineCatalogOwnerLedger();
  assert.equal(l.domain, MUTATION_DOMAIN);
  assert.equal(l.version, 0);
  assert.equal(l.epoch, 0);
  assert.equal(l.spentCommentIds.length, 0);
  assert.ok(Object.isFrozen(l));
});
test('symbolic CAS succeeds only as hypothetical spent, never real approval', () => {
  const l = newOfflineCatalogOwnerLedger(),
    r = cas(l);
  assert.equal(r.status, 'MODEL_ONE_SHOT_SPENT_NOT_REAL');
  assert.equal(r.ledger.version, 1);
  assert.equal(r.ledger.epoch, 1);
  assert.deepEqual(r.ledger.spentCommentIds, [1234001]);
  assert.equal(r.ledger.active.scope, PROPOSED_CATALOG_SCOPE);
  assert.equal(l.version, 0);
  assertOffline(r);
});
test('one-use spent blocks approval replay on same ledger', () => {
  const r = cas(newOfflineCatalogOwnerLedger());
  blocked(cas(r.ledger), 'ONE_SHOT_COMMENT_ALREADY_SPENT');
  blocked(cas(r.ledger), 'SHARED_MUTATION_DOMAIN_ALREADY_CLAIMED');
});
test('same epoch concurrent contender must fail', () => {
  const l = newOfflineCatalogOwnerLedger();
  const winner = cas(l);
  const loser = simulateOfflineCatalogOwnerCas({
    ledger: winner.ledger,
    request: { ...request(), commentId: 1234002 },
    expectedVersion: 0,
    expectedEpoch: 0
  });
  blocked(loser, 'STALE_CAS_VERSION_OR_EPOCH');
});
test('a fresh comment cannot preempt occupied domain', () => {
  const claimed = cas(newOfflineCatalogOwnerLedger());
  blocked(
    cas(claimed.ledger, { commentId: 1234003 }),
    'SHARED_MUTATION_DOMAIN_ALREADY_CLAIMED'
  );
});
for (const ack of ['unknown', 'lost']) {
  test('unverified COMMIT acknowledgement remains HOLD: ' + ack, () => {
    const r = cas(newOfflineCatalogOwnerLedger(), {}, { ack });
    assert.equal(r.status, 'HOLD_MODEL_COMMIT_ACK_UNKNOWN');
    assert.equal(r.ledger.unknownCommit, true);
    assert.equal(r.noAutomaticReplay, true);
    assert.equal(r.ledger.spentCommentIds.length, 1);
    assertOffline(r);
    blocked(
      cas(r.ledger, { commentId: 999999 }),
      'UNKNOWN_COMMIT_MUST_BE_RECONCILED_READONLY'
    );
  });
}
for (const [name, patch, code] of [
  [
    'old_scope',
    { scope: 'reader-reward-beta-point-10x-staging' },
    'CATALOG_OWNER_TARGET_MISMATCH'
  ],
  [
    'rollback_proof',
    { scope: 'reader-reward-beta-point-10x-staging-atomic-rollback' },
    'CATALOG_OWNER_TARGET_MISMATCH'
  ],
  [
    'production',
    { stagingRef: PRODUCTION_PROJECT },
    'CATALOG_OWNER_TARGET_MISMATCH'
  ],
  ['wrong_issue', { issueNumber: 295 }, 'CATALOG_OWNER_TARGET_MISMATCH'],
  ['wrong_sql', { sqlSha256: 'a'.repeat(64) }, 'CATALOG_OWNER_TARGET_MISMATCH'],
  ['wrong_head', { headSha: 'unverified' }, 'CATALOG_OWNER_TARGET_MISMATCH'],
  [
    'wrong_operation',
    { operation: 'persist' },
    'CATALOG_OWNER_TARGET_MISMATCH'
  ],
  ['missing_comment', { commentId: 0 }, 'CATALOG_OWNER_TARGET_MISMATCH'],
  [
    'fake_owner',
    { ownerAuthEvidence: { owner: true } },
    'REQUEST_FAILS_PROPOSED_SCOPE_CONTRACT'
  ]
]) {
  test('scope-bound symbolic CAS denies ' + name, () => {
    blocked(cas(newOfflineCatalogOwnerLedger(), patch), code);
  });
}
test('wrong expected version & epoch denied', () => {
  const l = newOfflineCatalogOwnerLedger();
  blocked(
    simulateOfflineCatalogOwnerCas({
      ledger: l,
      request: request(),
      expectedVersion: 1,
      expectedEpoch: 0
    }),
    'STALE_CAS_VERSION_OR_EPOCH'
  );
  blocked(
    simulateOfflineCatalogOwnerCas({
      ledger: l,
      request: request(),
      expectedVersion: 0,
      expectedEpoch: 1
    }),
    'STALE_CAS_VERSION_OR_EPOCH'
  );
});
test('invalid request and ledger do not throw or mint authority', () => {
  const l = newOfflineCatalogOwnerLedger();
  blocked(
    simulateOfflineCatalogOwnerCas({
      ledger: l,
      request: null,
      expectedVersion: 0,
      expectedEpoch: 0
    }),
    'INVALID_REQUEST'
  );
  blocked(
    simulateOfflineCatalogOwnerCas({
      ledger: {},
      request: request(),
      expectedVersion: 0,
      expectedEpoch: 0
    }),
    'INVALID_LEDGER'
  );
});
test('invalid ACK status cannot be accepted', () => {
  const l = newOfflineCatalogOwnerLedger();
  blocked(cas(l, {}, { ack: 'definitely_real_commit' }), 'ACK_OUTCOME_INVALID');
});
test('four historic trigger function targets are pinned to migration sources', () => {
  assert.deepEqual(
    CATALOG_EXPECTED_TRIGGERS.map((x) => x.function),
    [
      'novelight_award_level_up_points()',
      'novelight_enforce_scout_point_control()',
      'novelight_award_discovery_points()',
      'novelight_award_valid_read_scout_xp()'
    ]
  );
});
for (const mapping of CATALOG_EXPECTED_TRIGGERS) {
  test(
    'wrong trigger function is an explicit blocker: ' + mapping.trigger,
    () => {
      const a = fix();
      const row = a['NL-CATALOG-03'].find(
        (x) => x.trigger_name === mapping.trigger
      );
      row.invoked_function = 'public.unreviewed_point_writer()';
      blocked(
        audit(a),
        'EXPECTED_TRIGGER_FUNCTION_MISMATCH:' + mapping.trigger
      );
    }
  );
}
test('matching all four trigger functions still is not a Data Plane fence', () => {
  const a = fix();
  for (const row of a['NL-CATALOG-03']) {
    const m = CATALOG_EXPECTED_TRIGGERS.find(
      (x) => x.trigger === row.trigger_name
    );
    row.invoked_function = 'public.' + m.function;
  }
  const r = audit(a);
  assert.equal(r.status, 'NO_GO_FIXTURE_ONLY_CATALOG_RECONCILIATION');
  assert.equal(r.actualDataPlaneFenced, false);
  blocked(r, 'TRIGGER_FUNCTION_ACLS_NOT_ALL_IN_FIXED_SQL_PACK');
});
test('old valid-read XP trigger target not contained in 12 fixed SQL signatures', () => {
  assert.ok(
    !CATALOG_FUNCTIONS.includes('public.novelight_award_valid_read_scout_xp()')
  );
  blocked(audit(fix()), 'TRIGGER_FUNCTION_ACLS_NOT_ALL_IN_FIXED_SQL_PACK');
});
test('role catalog BYPASSRLS is detected even if relation card falsely denies it', () => {
  const a = fix();
  a['NL-CATALOG-05'][0].rolbypassrls = true;
  blocked(audit(a), 'ROLE_CATALOG_SERVICE_ROLE_BYPASSRLS');
  blocked(
    audit(a),
    'RELATION_AND_ROLE_BYPASSRLS_CONTRADICTION:' + CATALOG_RELATIONS[0]
  );
});
test('service_role superuser role catalog is not hidden by table cards', () => {
  const a = fix();
  a['NL-CATALOG-05'][0].rolsuper = true;
  blocked(audit(a), 'ROLE_CATALOG_SERVICE_ROLE_SUPERUSER');
});
test('schema service_role grant needs privileged path review', () => {
  const a = fix();
  a['NL-CATALOG-07'][0].schema_acl = '{service_role=UC/postgres}';
  blocked(audit(a), 'SCHEMA_SERVICE_ROLE_GRANT_REQUIRES_REVIEW');
});
test('default ACL service_role grant needs future writer review', () => {
  const a = fix();
  a['NL-CATALOG-07'][0].default_acl = '{service_role=arwdDxt/postgres}';
  blocked(audit(a), 'DEFAULT_ACL_SERVICE_ROLE_GRANT_REQUIRES_REVIEW');
});
test('fixed SQL pack cannot prove arbitrary new privileged function safe', () => {
  blocked(audit(fix()), 'UNENUMERATED_PRIVILEGED_FUNCTIONS_NOT_EXCLUDED');
});

test('no API, DB, Docker, SQL or Issue mutation code in pure module', () => {
  const code = readFileSync(
    fileURLToPath(
      new URL(
        '../scripts/scout-point10x-catalog-result-reconciler.mjs',
        import.meta.url
      )
    ),
    'utf8'
  );
  assert.doesNotMatch(code, /spawnSync\s*\(/u);
  assert.doesNotMatch(code, /createClient\s*\(/u);
  assert.doesNotMatch(code, /execute_sql\s*\(/u);
  assert.doesNotMatch(code, /https?:\/\//u);
  assert.match(code, /mayRunSql:\s*false/u);
});
