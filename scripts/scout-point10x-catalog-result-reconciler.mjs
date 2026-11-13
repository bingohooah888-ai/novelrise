// NOVELIGHT βScout Point10x: pure offline reviewer of eight catalog sections.
// Never query databases, execute SQL, trust caller-supplied OWNER identity or
// claim that an observed trigger/ACL guarantees a fenced Data Plane.
import {
  CATALOG_RELATIONS,
  CATALOG_FUNCTIONS,
  CATALOG_ROLES,
  REQUIRED_CATALOG_SECTIONS,
  PROPOSED_CATALOG_SCOPE,
  PINNED_CATALOG_SQL_SHA256,
  OWNER_CONTROL_ISSUE,
  reviewProposedCatalogOwnerGate
} from './scout-point10x-catalog-readonly-review.mjs';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import { REQUIRED_PRIVILEGED_PATHS } from './scout-point10x-cas-fencing-handoff-model.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';

export const CATALOG_EXPECTED_TRIGGERS = Object.freeze([
  Object.freeze({
    relation: 'scout_xp_ledger',
    trigger: 'scout_xp_level_up_points',
    function: 'novelight_award_level_up_points()'
  }),
  Object.freeze({
    relation: 'scout_point_ledger',
    trigger: 'scout_point_earning_control',
    function: 'novelight_enforce_scout_point_control()'
  }),
  Object.freeze({
    relation: 'scout_event_ledger',
    trigger: 'scout_event_discovery_points',
    function: 'novelight_award_discovery_points()'
  }),
  Object.freeze({
    relation: 'scout_event_ledger',
    trigger: 'scout_event_valid_read_xp',
    function: 'novelight_award_valid_read_scout_xp()'
  })
]);
export const REQUIRED_ROLE_DML = Object.freeze([
  'can_insert',
  'can_update',
  'can_delete',
  'can_truncate',
  'can_trigger'
]);
export const ALLOWED_SECTION_FIELDS = Object.freeze({
  'NL-CATALOG-01': [
    'evidence_id',
    'database_name',
    'current_role_name',
    'session_role_name',
    'pg_server_version_num',
    'transaction_read_only',
    'is_in_recovery'
  ],
  'NL-CATALOG-02': [
    'evidence_id',
    'expected_relation',
    'found',
    'relkind',
    'table_owner',
    'rls_enabled',
    'force_rls',
    'explicit_acl',
    'tested_role',
    'tested_role_bypassrls',
    'tested_role_superuser',
    ...REQUIRED_ROLE_DML
  ],
  'NL-CATALOG-03': [
    'evidence_id',
    'expected_relation',
    'relation_found',
    'trigger_name',
    'trigger_enabled_state',
    'internal_trigger',
    'invoked_function',
    'trigger_definition'
  ],
  'NL-CATALOG-04': [
    'evidence_id',
    'signature',
    'found',
    'deployed_identity',
    'function_owner',
    'is_security_definer',
    'function_session_settings',
    'explicit_execute_acl',
    'function_definition_md5',
    'tested_role',
    'role_can_execute'
  ],
  'NL-CATALOG-05': [
    'evidence_id',
    'expected_role',
    'found',
    'rolsuper',
    'rolbypassrls',
    'rolinherit',
    'rolcreaterole',
    'rolcreatedb',
    'rolcanlogin'
  ],
  'NL-CATALOG-06': [
    'evidence_id',
    'granted_role',
    'member_role',
    'grantor_role',
    'admin_option'
  ],
  'NL-CATALOG-07': [
    'evidence_id',
    'schema_name',
    'schema_owner',
    'schema_acl',
    'default_object_type',
    'default_grant_owner',
    'default_acl'
  ],
  'NL-CATALOG-08': [
    'evidence_id',
    'cron_job_relation_exists',
    'pg_cron_extension_installed'
  ]
});
const rec = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const sha40 = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/u.test(x);
const freeze = (x) => Object.freeze(x);
const uniq = (x) => [...new Set(x)];
function report(status, blockers, extra = {}) {
  return freeze({
    status,
    blockers: freeze(uniq(blockers)),
    ...extra,
    evidenceLevel: 'OFFLINE_UNTRUSTED_CATALOG_FIXTURE',
    sourceOfLiveTruth: false,
    actualDbConnected: false,
    trustedMainOwnerVerified: false,
    actualApprovalConsumed: false,
    actualDurableCasCommitted: false,
    actualDataPlaneFenced: false,
    allRealWritersVerified: false,
    actualCatalogSqlExecuted: false,
    mayReadDb: false,
    mayRunSql: false,
    mayWriteDb: false,
    mayRunStaging: false,
    mayUseDocker: false,
    mayClaimOwner: false,
    mayResumeWriters: false,
    mayMergeMain: false,
    mayDeploy: false,
    mayChangeProduction: false
  });
}
function recordSectionError(s, id, errors) {
  if (!Array.isArray(s)) {
    errors.push('MISSING_OR_NONARRAY_SECTION:' + id);
    return [];
  }
  if (s.length > 512) {
    errors.push('OVERSIZED_SECTION:' + id);
    return [];
  }
  for (const x of s) {
    if (!rec(x)) {
      errors.push('MALFORMED_ROW:' + id);
      continue;
    }
    if (x.evidence_id !== id) errors.push('EVIDENCE_ID_MISMATCH:' + id);
    for (const field of Object.keys(x)) {
      if (!ALLOWED_SECTION_FIELDS[id].includes(field))
        errors.push('UNEXPECTED_OUTPUT_FIELD:' + id);
    }
  }
  return s.filter(rec);
}
function keyRows(rows, key, expected, id, errors) {
  const known = new Map();
  for (const x of rows) {
    if (typeof x[key] !== 'string' || !expected.includes(x[key])) {
      errors.push('UNKNOWN_' + id + '_IDENTITY');
      continue;
    }
    if (known.has(x[key])) errors.push('DUPLICATE_' + id + ':' + x[key]);
    else known.set(x[key], x);
  }
  for (const name of expected) {
    if (!known.has(name)) errors.push('MISSING_' + id + ':' + name);
  }
  return known;
}
const knownSafeFlag = (x) => x === false;
function readOnlyFlag(x) {
  return x === true || x === 't' || x === 'on';
}
export function reconcilePoint10xCatalogSnapshot(sections) {
  if (!rec(sections))
    return report('HOLD_BAD_CATALOG_FIXTURE', [
      'EIGHT_CATALOG_SECTIONS_REQUIRED'
    ]);
  const errors = [
    'NO_LIVE_STAGING_CATALOG_EVIDENCE',
    'NINE_WRITER_CLASSES_NOT_FULL_RUNTIME_CALL_GRAPH',
    'FIVE_PRIVILEGED_ROUTES_NOT_FENCED',
    'EXTERNAL_EDGE_CRON_QUEUE_RETRY_UNVERIFIED',
    'FUNCTION_BODY_HASH_NOT_BEHAVIOR_PROOF',
    'TRIGGER_AND_RLS_CANNOT_PROVE_PRIVILEGED_FENCE',
    'TRIGGER_FUNCTION_ACLS_NOT_ALL_IN_FIXED_SQL_PACK',
    'UNENUMERATED_PRIVILEGED_FUNCTIONS_NOT_EXCLUDED'
  ];
  for (const key of Object.keys(sections)) {
    if (!REQUIRED_CATALOG_SECTIONS.includes(key))
      errors.push('UNEXPECTED_CATALOG_SECTION');
  }
  const rows = {};
  for (const id of REQUIRED_CATALOG_SECTIONS)
    rows[id] = recordSectionError(sections[id], id, errors);
  const identity = rows['NL-CATALOG-01'];
  if (identity.length !== 1)
    errors.push('INVALID_CATALOG_IDENTITY_CARDINALITY');
  else {
    const i = identity[0];
    if (
      !readOnlyFlag(i.transaction_read_only) ||
      !positive(Number(i.pg_server_version_num)) ||
      Number(i.pg_server_version_num) < 150000 ||
      typeof i.database_name !== 'string' ||
      !i.database_name ||
      typeof i.current_role_name !== 'string' ||
      !i.current_role_name ||
      typeof i.session_role_name !== 'string' ||
      !i.session_role_name
    )
      errors.push('READONLY_DATABASE_IDENTITY_NOT_VERIFIED');
    if (i.is_in_recovery !== true && i.is_in_recovery !== false)
      errors.push('DATABASE_RECOVERY_STATE_UNKNOWN');
  }
  const relations = keyRows(
    rows['NL-CATALOG-02'],
    'expected_relation',
    CATALOG_RELATIONS,
    'RELATION',
    errors
  );
  for (const [name, r] of relations) {
    if (r.found !== true) errors.push('RELATION_NOT_FOUND:' + name);
    if (r.found === true) {
      if (!['r', 'p'].includes(r.relkind))
        errors.push('UNEXPECTED_RELATION_KIND:' + name);
      if (typeof r.table_owner !== 'string' || !r.table_owner)
        errors.push('RELATION_OWNER_UNKNOWN:' + name);
      if (r.rls_enabled !== true)
        errors.push('RLS_DISABLED_OR_UNKNOWN:' + name);
    }
    if (r.tested_role !== 'service_role')
      errors.push('SERVICE_ROLE_NOT_RESOLVED:' + name);
    if (r.tested_role_bypassrls !== true && r.tested_role_bypassrls !== false)
      errors.push('SERVICE_ROLE_BYPASSRLS_UNKNOWN:' + name);
    else if (r.tested_role_bypassrls === true)
      errors.push('SERVICE_ROLE_BYPASSES_RLS:' + name);
    if (r.tested_role_superuser === true)
      errors.push('SERVICE_ROLE_SUPERUSER:' + name);
    for (const field of REQUIRED_ROLE_DML) {
      if (r[field] === true)
        errors.push(
          'SERVICE_ROLE_EFFECTIVE_DML_OR_DDL_PRIVILEGE:' + name + ':' + field
        );
      if (!knownSafeFlag(r[field]))
        errors.push('NO_PROVEN_DENIAL_OF_PRIVILEGE:' + name + ':' + field);
    }
  }
  const roleRows = keyRows(
    rows['NL-CATALOG-05'],
    'expected_role',
    CATALOG_ROLES,
    'ROLE',
    errors
  );
  for (const [name, r] of roleRows) {
    if (r.found !== true) errors.push('ROLE_ABSENT_OR_UNKNOWN:' + name);
    for (const k of [
      'rolsuper',
      'rolbypassrls',
      'rolinherit',
      'rolcreaterole',
      'rolcreatedb',
      'rolcanlogin'
    ]) {
      if (r.found === true && typeof r[k] !== 'boolean')
        errors.push('ROLE_FLAG_UNKNOWN:' + name + ':' + k);
    }
  }
  const serviceRole = roleRows.get('service_role');
  if (serviceRole?.rolbypassrls === true)
    errors.push('ROLE_CATALOG_SERVICE_ROLE_BYPASSRLS');
  if (serviceRole?.rolsuper === true)
    errors.push('ROLE_CATALOG_SERVICE_ROLE_SUPERUSER');
  for (const [name, relation] of relations) {
    if (
      serviceRole?.found === true &&
      typeof serviceRole.rolbypassrls === 'boolean' &&
      typeof relation.tested_role_bypassrls === 'boolean' &&
      serviceRole.rolbypassrls !== relation.tested_role_bypassrls
    )
      errors.push('RELATION_AND_ROLE_BYPASSRLS_CONTRADICTION:' + name);
  }
  for (const r of rows['NL-CATALOG-06']) {
    if (
      typeof r.granted_role !== 'string' ||
      !r.granted_role ||
      typeof r.member_role !== 'string' ||
      !r.member_role ||
      typeof r.admin_option !== 'boolean'
    )
      errors.push('ROLE_MEMBERSHIP_METADATA_INCOMPLETE');
    if (r.member_role === 'service_role' || r.granted_role === 'service_role')
      errors.push('SERVICE_ROLE_MEMBERSHIP_PATH_REQUIRES_MANUAL_REVIEW');
  }
  const triggerRows = rows['NL-CATALOG-03'];
  const triggerKeys = new Set();
  for (const x of triggerRows) {
    if (!CATALOG_RELATIONS.includes(x.expected_relation))
      errors.push('UNKNOWN_TRIGGER_RELATION');
    if (x.trigger_name === null) {
      if (x.relation_found !== true) errors.push('TRIGGER_RELATION_MISSING');
      continue;
    }
    if (typeof x.trigger_name !== 'string' || !x.trigger_name) {
      errors.push('TRIGGER_NAME_INVALID');
      continue;
    }
    const key = x.expected_relation + '|' + x.trigger_name;
    if (triggerKeys.has(key)) errors.push('DUPLICATE_TRIGGER_DEFINITION');
    triggerKeys.add(key);
    if (x.trigger_enabled_state === 'D' || x.trigger_enabled_state === 'R')
      errors.push('EXPECTED_TRIGGER_NOT_ORIGIN_ENABLED:' + key);
    else if (!['A', 'O'].includes(x.trigger_enabled_state))
      errors.push('TRIGGER_ENABLED_STATE_UNKNOWN:' + key);
    if (typeof x.invoked_function !== 'string' || !x.invoked_function)
      errors.push('TRIGGER_FUNCTION_NOT_RESOLVED:' + key);
    if (typeof x.trigger_definition !== 'string' || !x.trigger_definition)
      errors.push('TRIGGER_METADATA_NOT_VERIFIED:' + key);
    if (x.internal_trigger !== true && x.internal_trigger !== false)
      errors.push('TRIGGER_INTERNAL_FLAG_UNKNOWN:' + key);
    const mapped = CATALOG_EXPECTED_TRIGGERS.find(
      (t) => t.relation === x.expected_relation && t.trigger === x.trigger_name
    );
    if (!mapped) errors.push('UNREGISTERED_TRIGGER_REQUIRES_REVIEW');
    else if (
      typeof x.invoked_function !== 'string' ||
      !x.invoked_function.endsWith(mapped.function)
    )
      errors.push('EXPECTED_TRIGGER_FUNCTION_MISMATCH:' + x.trigger_name);
  }
  for (const t of CATALOG_EXPECTED_TRIGGERS) {
    if (!triggerKeys.has(t.relation + '|' + t.trigger))
      errors.push('EXPECTED_TRIGGER_MISSING:' + t.trigger);
  }
  const functions = keyRows(
    rows['NL-CATALOG-04'],
    'signature',
    CATALOG_FUNCTIONS,
    'FUNCTION',
    errors
  );
  for (const [name, r] of functions) {
    if (r.found !== true) {
      errors.push('FUNCTION_ABSENT_OR_SIGNATURE_DRIFT:' + name);
      continue;
    }
    if (typeof r.function_owner !== 'string' || !r.function_owner)
      errors.push('SECDEF_FUNCTION_OWNER_UNKNOWN:' + name);
    else if (!roleRows.has(r.function_owner))
      errors.push('SECDEF_OWNER_ROLE_FLAGS_NOT_QUERIED:' + name);
    if (typeof r.is_security_definer !== 'boolean')
      errors.push('FUNCTION_SECURITY_MODE_UNKNOWN:' + name);
    if (r.is_security_definer === true) {
      errors.push('SECURITY_DEFINER_PRIVILEGED_EXECUTION_PATH:' + name);
      if (
        !/search_path\s*=/iu.test(
          Array.isArray(r.function_session_settings)
            ? r.function_session_settings.join(',')
            : String(r.function_session_settings ?? '')
        )
      )
        errors.push('SECDEF_SEARCH_PATH_NOT_FIXED:' + name);
    }
    if (
      r.tested_role !== 'service_role' ||
      r.role_can_execute === null ||
      typeof r.role_can_execute !== 'boolean'
    )
      errors.push('FUNCTION_EXECUTE_PRIVILEGE_UNKNOWN:' + name);
    if (r.role_can_execute === true)
      errors.push('SERVICE_ROLE_CAN_EXECUTE_FUNCTION:' + name);
    if (
      typeof r.function_definition_md5 !== 'string' ||
      !/^[a-f0-9]{32}$/u.test(r.function_definition_md5)
    )
      errors.push('FUNCTION_DEFINITION_DIGEST_UNAVAILABLE:' + name);
    if (name.includes('rank_internal_20260928') && r.role_can_execute !== false)
      errors.push('LEGACY_RENAMED_RPC_NOT_PROVEN_REVOKED:' + name);
  }
  if (!rows['NL-CATALOG-07'].some((x) => x.schema_name === 'public'))
    errors.push('PUBLIC_SCHEMA_ACL_NOT_IN_SNAPSHOT');
  for (const x of rows['NL-CATALOG-07']) {
    if (typeof x.schema_name !== 'string' || !x.schema_name)
      errors.push('UNKNOWN_SCHEMA_ACL_SCOPE');
    if (x.default_acl !== null && typeof x.default_acl !== 'string')
      errors.push('DEFAULT_ACL_METADATA_INVALID');
  }
  for (const s of rows['NL-CATALOG-07']) {
    if (
      typeof s.schema_acl === 'string' &&
      s.schema_acl.includes('service_role=')
    )
      errors.push('SCHEMA_SERVICE_ROLE_GRANT_REQUIRES_REVIEW');
    if (
      typeof s.default_acl === 'string' &&
      s.default_acl.includes('service_role=')
    )
      errors.push('DEFAULT_ACL_SERVICE_ROLE_GRANT_REQUIRES_REVIEW');
  }
  const cron = rows['NL-CATALOG-08'];
  if (
    cron.length !== 1 ||
    typeof cron[0]?.cron_job_relation_exists !== 'boolean' ||
    typeof cron[0]?.pg_cron_extension_installed !== 'boolean'
  )
    errors.push('CRON_METADATA_UNKNOWN');
  else if (
    cron[0].cron_job_relation_exists ||
    cron[0].pg_cron_extension_installed
  )
    errors.push('CRON_PRESENT_JOBS_UNINSPECTED');
  return report('NO_GO_FIXTURE_ONLY_CATALOG_RECONCILIATION', errors, {
    countedRelations: relations.size,
    countedFunctions: functions.size,
    countedRoles: roleRows.size,
    countedTriggers: triggerKeys.size,
    sectionsSeen: freeze(
      REQUIRED_CATALOG_SECTIONS.filter((x) => Array.isArray(sections[x]))
    ),
    writerClasses: freeze([...SCOUT_POINT_10X_WRITER_CLASSES]),
    privilegedPathCategories: freeze([...REQUIRED_PRIVILEGED_PATHS]),
    unknownPrivilegedRouteCannotBeExcluded: true,
    catalogEvenIfCompleteNeverApprovesCutover: true
  });
}

// Hypothetical Postgres CAS sequence only. No durable backend, identity read,
// GitHub Issue comment, actual owner approval or cross-workflow lock.
export function newOfflineCatalogOwnerLedger() {
  return freeze({
    domain: MUTATION_DOMAIN,
    version: 0,
    epoch: 0,
    active: null,
    spentCommentIds: freeze([]),
    unknownCommit: false
  });
}
export function simulateOfflineCatalogOwnerCas({
  ledger,
  request,
  expectedVersion,
  expectedEpoch,
  ack = 'received'
} = {}) {
  const blockers = [
    'REAL_OWNER_AUTHENTICATION_NOT_PERFORMED',
    'TRUSTED_MAIN_EXECUTOR_NOT_DEPLOYED',
    'DURABLE_POSTGRES_CAS_NOT_IMPLEMENTED',
    'ALL_MUTATION_DOMAIN_WORKFLOWS_NOT_LOCKED',
    'CATALOG_QUERY_REQUIRES_NEW_INDEPENDENT_OWNER_APPROVAL'
  ];
  if (
    !rec(ledger) ||
    !Array.isArray(ledger.spentCommentIds) ||
    ledger.domain !== MUTATION_DOMAIN ||
    !Number.isSafeInteger(ledger.version) ||
    !Number.isSafeInteger(ledger.epoch)
  )
    return report(
      'HOLD_INVALID_OFFLINE_LEDGER',
      [...blockers, 'INVALID_LEDGER'],
      {
        ledger: ledger ?? null
      }
    );
  if (!rec(request))
    return report(
      'HOLD_INVALID_CATALOG_REQUEST',
      [...blockers, 'INVALID_REQUEST'],
      { ledger }
    );
  const r = reviewProposedCatalogOwnerGate(request);
  if (
    r.blockers.some(
      (x) =>
        ![
          'owner_approval_not_issued_or_authenticated',
          'no_deployed_trusted_main_readonly_claim_executor',
          'no_actual_staging_catalog_connection_allowed'
        ].includes(x)
    )
  )
    blockers.push('REQUEST_FAILS_PROPOSED_SCOPE_CONTRACT');
  if (
    request.scope !== PROPOSED_CATALOG_SCOPE ||
    request.sqlSha256 !== PINNED_CATALOG_SQL_SHA256 ||
    request.stagingRef !== STAGING_PROJECT ||
    request.stagingRef === PRODUCTION_PROJECT ||
    request.issueNumber !== OWNER_CONTROL_ISSUE ||
    request.operation !== 'read-catalog-only' ||
    !sha40(request.mainSha) ||
    !sha40(request.headSha) ||
    !positive(request.commentId)
  )
    blockers.push('CATALOG_OWNER_TARGET_MISMATCH');
  if (ledger.version !== expectedVersion || ledger.epoch !== expectedEpoch)
    blockers.push('STALE_CAS_VERSION_OR_EPOCH');
  if (ledger.spentCommentIds.includes(request.commentId))
    blockers.push('ONE_SHOT_COMMENT_ALREADY_SPENT');
  if (ledger.active !== null)
    blockers.push('SHARED_MUTATION_DOMAIN_ALREADY_CLAIMED');
  if (ledger.unknownCommit)
    blockers.push('UNKNOWN_COMMIT_MUST_BE_RECONCILED_READONLY');
  if (!['received', 'unknown', 'lost'].includes(ack))
    blockers.push('ACK_OUTCOME_INVALID');
  const nonEvidence = blockers.slice(5);
  if (nonEvidence.length)
    return report('HOLD_SYMBOLIC_CAS_DENIED', blockers, {
      ledger,
      simulationOnly: true
    });
  const next = freeze({
    domain: MUTATION_DOMAIN,
    version: ledger.version + 1,
    epoch: ledger.epoch + 1,
    active: freeze({
      scope: PROPOSED_CATALOG_SCOPE,
      commentId: request.commentId,
      headSha: request.headSha,
      sqlSha256: request.sqlSha256
    }),
    spentCommentIds: freeze([...ledger.spentCommentIds, request.commentId]),
    unknownCommit: ack !== 'received'
  });
  return report(
    ack === 'received'
      ? 'MODEL_ONE_SHOT_SPENT_NOT_REAL'
      : 'HOLD_MODEL_COMMIT_ACK_UNKNOWN',
    blockers,
    {
      ledger: next,
      simulationOnly: true,
      hypotheticalSpent: true,
      noAutomaticReplay: ack !== 'received',
      noAutomaticReadOrRelease: true
    }
  );
}
