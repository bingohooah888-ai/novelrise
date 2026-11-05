// NOVELIGHT Point10x: source-only catalog SQL and OWNER preflight.
// No database connection, no SQL execution, no live OWNER authentication.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import { REQUIRED_PRIVILEGED_PATHS } from './scout-point10x-cas-fencing-handoff-model.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from './scout-point10x-atomic-execution-contract.mjs';
import {
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE
} from './scout-point10x-atomic-staging-plan.mjs';

export const CATALOG_SQL_PATH =
  'docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql';
export const PINNED_CATALOG_SQL_SHA256 =
  '740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11';
export const PROPOSED_CATALOG_SCOPE =
  'reader-reward-beta-point-10x-staging-catalog-readonly';
export const OWNER_CONTROL_ISSUE = 294;
export const REQUIRED_CATALOG_SECTIONS = Object.freeze([
  'NL-CATALOG-01',
  'NL-CATALOG-02',
  'NL-CATALOG-03',
  'NL-CATALOG-04',
  'NL-CATALOG-05',
  'NL-CATALOG-06',
  'NL-CATALOG-07',
  'NL-CATALOG-08'
]);
export const CATALOG_RELATIONS = Object.freeze([
  'scout_xp_ledger',
  'scout_event_ledger',
  'scout_point_ledger',
  'scout_badge_definitions',
  'user_scout_badges',
  'scout_point_operator_actions',
  'scout_point_user_controls',
  'scout_badge_metric_events',
  'scout_badge_metric_state'
]);
export const CATALOG_FUNCTIONS = Object.freeze([
  'public.novelight_award_level_up_points()',
  'public.novelight_award_level_up_points_rank_internal_20260928()',
  'public.novelight_award_discovery_points()',
  'public.novelight_award_discovery_points_rank_internal_20260928()',
  'public.novelight_enforce_scout_point_control()',
  'public.novelight_apply_scout_badge_progress(uuid,text,bigint,jsonb)',
  'public.novelight_apply_scout_badge_evaluation(uuid,text,bigint,numeric,boolean,jsonb,boolean)',
  'public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)',
  'public.novelight_process_seed_discovery(uuid)',
  'public.novelight_scout_point_earning_allowed(uuid)',
  'public.novelight_refresh_my_scout_badges()',
  'public.novelight_record_scout_badge_metric(uuid,text,bigint,text,jsonb)'
]);
export const CATALOG_ROLES = Object.freeze([
  'service_role',
  'postgres',
  'anon',
  'authenticated',
  'supabase_admin'
]);
export const OWNER_READONLY_REVIEW_FIELDS = Object.freeze([
  'fresh_authenticated_owner_issue_event',
  'issue_294_comment_id_unique_and_not_spent',
  'exact_staging_project_identity_verified_independently',
  'exact_main_and_pr_head_reverified',
  'new_readonly_scope_proposed_not_existing_approval',
  'eight_fixed_sql_selects_pinned_to_sha256',
  'dedicated_least_privilege_readonly_db_login',
  'separate_unexpired_owner_approval_for_future_query',
  'one_use_durable_claim_and_audit_evidence_reviewed',
  'no_secret_value_or_full_function_body_in_evidence',
  'no_reuse_of_atomic_proof_or_persist_or_old_rollback_approval'
]);
const freeze = (x) => Object.freeze(x);
const sha = (x) => createHash('sha256').update(x, 'utf8').digest('hex');
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const sha40 = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/u.test(x);
function noAuthority(status, blockers, details = {}) {
  return freeze({
    status,
    blockers: freeze([...new Set(blockers)]),
    ...details,
    sourceOnly: true,
    ownerEventAuthenticated: false,
    catalogQueryExecuted: false,
    actualCatalogChecked: false,
    actualServiceRoleFenced: false,
    actualWriterDrainProven: false,
    mayReadDb: false,
    mayRunSql: false,
    mayWriteDb: false,
    mayRunStaging: false,
    mayUseDocker: false,
    mayClaimOwner: false,
    mayMergeMain: false,
    mayDeploy: false,
    mayModifyProduction: false
  });
}
export function readPinnedCatalogSql() {
  return readFileSync(
    fileURLToPath(new URL('../' + CATALOG_SQL_PATH, import.meta.url)),
    'utf8'
  );
}
// For a static proof the *entire* byte sequence is pinned. The limited
// lexical check is defense in depth, not an SQL parser nor runtime assurance.
function stripCommentsAndLiterals(input) {
  return input
    .replace(/--[^\r\n]*/gu, ' ')
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/'(?:''|[^'])*'/gu, "''");
}
export function auditPoint10xCatalogSql(source, path = CATALOG_SQL_PATH) {
  const errors = [];
  if (path !== CATALOG_SQL_PATH) errors.push('catalog_sql_outside_inert_plan');
  if (typeof source !== 'string')
    return noAuthority('HOLD_BAD_CATALOG_SQL', ['sql_source_not_text']);
  const actualSha = sha(source);
  if (actualSha !== PINNED_CATALOG_SQL_SHA256)
    errors.push('catalog_sql_sha256_drift');
  if (
    !source.startsWith(
      '-- NOVELIGHT Point10x / STAGING CATALOG READ-ONLY REVIEW CANDIDATE.'
    )
  )
    errors.push('readonly_header_missing');
  for (const id of REQUIRED_CATALOG_SECTIONS) {
    if ((source.match(new RegExp('-- ' + id + ':', 'gu')) || []).length !== 1)
      errors.push('missing_or_duplicated_section:' + id);
  }
  const lex = stripCommentsAndLiterals(source);
  const statements = lex
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length !== 10)
    errors.push('expected_eight_selects_one_begin_rollback');
  if (
    statements[0] !==
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
  )
    errors.push('transaction_must_be_repeatable_read_read_only');
  if (statements.at(-1) !== 'ROLLBACK')
    errors.push('must_rollback_after_catalog_selects');
  for (const [i, stmt] of statements.slice(1, -1).entries()) {
    if (!/^(?:SELECT|WITH)\s/iu.test(stmt))
      errors.push('nonselect_statement:' + i);
  }
  const hazardous =
    /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CALL|DO|EXECUTE|COPY|VACUUM|ANALYZE|REFRESH|SET|RESET|LOCK|LISTEN|NOTIFY)\b/iu;
  if (hazardous.test(lex)) errors.push('non_catalog_readonly_keyword_detected');
  const riskyCalls =
    /\b(?:pg_sleep|pg_advisory_lock|set_config|dblink_exec|pg_notify|nextval|lo_import|pg_read_file|pg_ls_dir|pg_terminate_backend)\s*\(/iu;
  if (riskyCalls.test(lex)) errors.push('potentially_mutating_select_function');
  const catalogNames = [
    'pg_proc',
    'pg_trigger',
    'pg_class',
    'pg_roles',
    'pg_auth_members',
    'pg_default_acl',
    'has_table_privilege',
    'has_function_privilege',
    'pg_get_functiondef',
    'TRUNCATE'
  ];
  for (const name of catalogNames) {
    if (!source.includes(name)) errors.push('missing_catalog_coverage:' + name);
  }
  if (
    !source.includes('WHERE rolname = ' + "'service_role'") &&
    !source.includes("WHERE rolname = 'service_role'")
  )
    errors.push('service_role_target_missing');
  if (!source.includes('pg_catalog.pg_is_in_recovery()'))
    errors.push('database_identity_not_pinned');
  for (const r of CATALOG_RELATIONS)
    if (!source.includes("'" + r + "'")) errors.push('missing_relation:' + r);
  for (const f of CATALOG_FUNCTIONS)
    if (!source.includes("'" + f + "'")) errors.push('missing_function:' + f);
  return noAuthority(
    errors.length
      ? 'HOLD_CATALOG_SQL_STATIC'
      : 'PINNED_INERT_SQL_STATIC_REVIEW_ONLY',
    errors,
    {
      sqlSha256: actualSha,
      statementCount: statements.length,
      readOnlyTransactionLexicallyConfirmed: errors.length === 0,
      sectionCount: REQUIRED_CATALOG_SECTIONS.length,
      catalogOnlyNotDataPlaneProof: true
    }
  );
}
export function reviewProposedCatalogOwnerGate(request = {}) {
  const errors = [
    'owner_approval_not_issued_or_authenticated',
    'no_deployed_trusted_main_readonly_claim_executor',
    'no_actual_staging_catalog_connection_allowed'
  ];
  if (!obj(request))
    return noAuthority('HOLD_CATALOG_OWNER_GATE', [
      ...errors,
      'request_invalid'
    ]);
  if (request.issueNumber !== OWNER_CONTROL_ISSUE)
    errors.push('wrong_owner_control_issue');
  if (request.scope !== PROPOSED_CATALOG_SCOPE)
    errors.push('new_readonly_scope_required');
  if (
    request.scope === ATOMIC_PROOF_SCOPE ||
    request.scope === ATOMIC_WRITE_SCOPE ||
    request.scope === 'reader-reward-beta-point-10x-staging'
  )
    errors.push('existing_scope_cannot_authorize_catalog_read');
  if (
    request.stagingRef !== STAGING_PROJECT ||
    request.stagingRef === PRODUCTION_PROJECT
  )
    errors.push('dedicated_staging_ref_required');
  if (!sha40(request.mainSha) || !sha40(request.headSha))
    errors.push('exact_main_and_head_sha_required');
  if (request.sqlSha256 !== PINNED_CATALOG_SQL_SHA256)
    errors.push('pinned_sql_digest_required');
  if (request.operation !== 'read-catalog-only')
    errors.push('read_only_operation_required');
  if (!Number.isSafeInteger(request.commentId) || request.commentId <= 0)
    errors.push('unique_future_issue_comment_required');
  if (
    request.ownerAuthEvidence !== null &&
    request.ownerAuthEvidence !== undefined
  )
    errors.push('caller_provided_owner_identity_is_not_trusted');
  if (
    request.expiryConfirmed !== false &&
    request.expiryConfirmed !== undefined
  )
    errors.push('caller_provided_expiry_not_trusted');
  return noAuthority('HOLD_CATALOG_OWNER_GATE', errors, {
    proposedScopeOnly: PROPOSED_CATALOG_SCOPE,
    ownerIssue: OWNER_CONTROL_ISSUE,
    exactSqlDigest: PINNED_CATALOG_SQL_SHA256,
    stagingRef: STAGING_PROJECT,
    requiredConditions: OWNER_READONLY_REVIEW_FIELDS,
    legacyScopesUnchanged: true,
    officialApprovalCreated: false,
    actualClaimCommitted: false
  });
}
export function reviewSyntheticCatalogSections(sections = {}) {
  const errs = ['synthetic_results_never_authorize_staging'];
  if (!obj(sections))
    return noAuthority('HOLD_SYNTHETIC_CATALOG', [...errs, 'sections_invalid']);
  for (const id of REQUIRED_CATALOG_SECTIONS) {
    if (!Array.isArray(sections[id]))
      errs.push('missing_catalog_section:' + id);
  }
  const identity = sections['NL-CATALOG-01'];
  if (
    !Array.isArray(identity) ||
    identity.length !== 1 ||
    identity[0]?.transaction_read_only !== 'on'
  )
    errs.push('readonly_transaction_not_proven_in_fixture');
  const relations = sections['NL-CATALOG-02'];
  if (
    !Array.isArray(relations) ||
    !CATALOG_RELATIONS.every((rel) =>
      relations.some((x) => x.expected_relation === rel && x.found === true)
    )
  )
    errs.push('protected_relation_inventory_incomplete');
  const roles = sections['NL-CATALOG-05'];
  if (
    !Array.isArray(roles) ||
    !CATALOG_ROLES.every((role) => roles.some((x) => x.expected_role === role))
  )
    errs.push('role_inventory_incomplete');
  const funcs = sections['NL-CATALOG-04'];
  if (
    !Array.isArray(funcs) ||
    !CATALOG_FUNCTIONS.every((sig) => funcs.some((x) => x.signature === sig))
  )
    errs.push('function_inventory_incomplete');
  const triggers = sections['NL-CATALOG-03'];
  if (
    !Array.isArray(triggers) ||
    !triggers.some((x) => x.trigger_name === 'scout_xp_level_up_points')
  )
    errs.push('level_up_trigger_unverified');
  return noAuthority('HOLD_SYNTHETIC_CATALOG', errs, {
    fixtureOnly: true,
    catalogCompleteInLiveDatabase: false,
    liveControlCasProven: false,
    writerClasses: freeze([...SCOUT_POINT_10X_WRITER_CLASSES]),
    privilegedPaths: freeze([...REQUIRED_PRIVILEGED_PATHS])
  });
}
