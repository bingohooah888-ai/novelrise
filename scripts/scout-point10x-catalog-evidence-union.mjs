// NOVELIGHT βScout Point10x — two-catalog evidence union, pure and OFFLINE.
// No database, Docker, network, GitHub Issue, Secrets or execution authority.
import { createHash } from 'node:crypto';
import {
  CATALOG_FUNCTIONS,
  CATALOG_RELATIONS,
  OWNER_CONTROL_ISSUE,
  PINNED_CATALOG_SQL_SHA256,
  PROPOSED_CATALOG_SCOPE,
  REQUIRED_CATALOG_SECTIONS
} from './scout-point10x-catalog-readonly-review.mjs';
import {
  ADDENDUM_IDS,
  ADDENDUM_SQL_SHA256,
  UNCHANGED_ORIGINAL_SQL_SHA256,
  EXPECTED_GAP_TRIGGERS,
  REQUIRED_ADDED_FUNCTIONS,
  ADDENDUM_ROLE_NAMES
} from './scout-point10x-privileged-catalog-addendum.mjs';
import { reconcilePoint10xCatalogSnapshot } from './scout-point10x-catalog-result-reconciler.mjs';
import { reconcileAddendumFixture } from './scout-point10x-privileged-catalog-addendum.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import { REQUIRED_PRIVILEGED_PATHS } from './scout-point10x-cas-fencing-handoff-model.mjs';

export const PROPOSED_BUNDLE_SCOPE =
  'reader-reward-beta-point-10x-staging-catalog-bundle-readonly';
export const BUNDLE_SQL_HASHES = Object.freeze({
  base: PINNED_CATALOG_SQL_SHA256,
  addendum: ADDENDUM_SQL_SHA256
});
export const BUNDLE_REVIEW_STEPS = Object.freeze([
  'verify_latest_main_and_master_and_draft_heads_from_trusted_source',
  'validate_exact_owner_issue294_event_and_owner_authentication',
  'bind_unique_comment_to_new_scope_two_sql_digests_and_target',
  'validate_expiry_and_dedicated_staging_identity_no_production_fallback',
  'atomic_unique_spent_cas_and_monotone_fencing_epoch',
  'share_mutation_domain_with_old_new_and_scheduler_writers',
  'use_only_dedicated_minimum_privilege_readonly_identity',
  'run_fixed_metadata_queries_in_one_consistent_readonly_snapshot',
  'sanitize_metadata_and_report_all_unknown_paths_as_holds',
  'hold_after_lost_commit_ack_and_requery_authoritative_ledger',
  'retain_spent_tombstone_and_auditable_no_replay_proof',
  'never_infer_rollback_or_persist_permission_from_readonly_scope'
]);
export const BUNDLE_REVIEW_BLOCKERS = Object.freeze([
  'TRUSTED_MAIN_EXECUTOR_NOT_INSTALLED',
  'REAL_OWNER_EVENT_UNAUTHENTICATED',
  'DURABLE_ATOMIC_SPENT_CAS_NOT_PROVEN',
  'SHARED_MUTATION_DOMAIN_EXCLUSION_NOT_PROVEN',
  'BOTH_SQL_RESULTS_SAME_SNAPSHOT_NOT_PROVEN',
  'DEDICATED_READONLY_STAGING_IDENTITY_NOT_PROVEN',
  'ACTUAL_PRIVILEGED_WRITER_FENCE_NOT_PROVEN',
  'EXTERNAL_EDGE_CRON_QUEUE_NOT_PROVEN_DRAINED',
  'LIVE_CATALOG_OWNERSHIP_AND_ACL_NOT_CHECKED',
  'NEW_BUNDLE_SCOPE_UNREGISTERED_AND_UNAPPROVED'
]);
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const sha40 = (s) => typeof s === 'string' && /^[a-f0-9]{40}$/u.test(s);
const unique = (x) => Object.freeze([...new Set(x)]);
const freeze = (x) => Object.freeze(x);
const output = (status, blockers, data = {}) =>
  freeze({
    status,
    blockers: unique(blockers),
    ...data,
    resultType: 'OFFLINE_UNTRUSTED_FIXTURE_ONLY',
    actualDbContacted: false,
    bothQueriesRunInSameRealSnapshot: false,
    actualOwnerAuthenticated: false,
    actualOwnerApprovalConsumed: false,
    actualSpentCasCommitted: false,
    actualAllWritersFenced: false,
    mayReadDb: false,
    mayRunSql: false,
    mayWriteDb: false,
    mayUseDocker: false,
    mayRunStaging: false,
    mayClaimOwner: false,
    mayMergeMain: false,
    mayDeploy: false,
    mayChangeProduction: false
  });
function rows(bundle, section) {
  return Array.isArray(bundle?.[section]) ? bundle[section] : [];
}
function identity(x) {
  if (typeof x !== 'string') return null;
  const s = x.trim().replace(/^public\./u, '');
  // Reject quotation/qualified namespace/whitespace ambiguity rather
  // than treating two different function signatures as equal.
  return /^[a-z][a-z0-9_]*\([a-z0-9_, ]*\)$/u.test(s) ? s : null;
}
function itemKey(table, name) {
  if (typeof table !== 'string' || typeof name !== 'string') return null;
  if (!/^[a-z_][a-z0-9_]*$/u.test(table) || !/^[a-z_][a-z0-9_]*$/u.test(name))
    return null;
  return table + '|' + name;
}
function mapped(items, derive, prefix, errors) {
  const m = new Map();
  for (const row of items) {
    if (!record(row)) {
      errors.push(prefix + '_MALFORMED_ROW');
      continue;
    }
    const key = derive(row);
    if (!key) {
      errors.push(prefix + '_INVALID_KEY');
      continue;
    }
    if (m.has(key)) errors.push(prefix + '_DUPLICATE_KEY');
    else m.set(key, row);
  }
  return m;
}
const compare = (errors, label, left, right) => {
  if (left !== right) errors.push(label);
};
export function reviewTwoCatalogEvidence({ base, addendum, sqlDigests } = {}) {
  const errors = [...BUNDLE_REVIEW_BLOCKERS];
  if (!record(base) || !record(addendum))
    return output('HOLD_INCOMPLETE_EVIDENCE_BUNDLE', [
      ...errors,
      'BOTH_CATALOG_FIXTURES_REQUIRED'
    ]);
  const parentA = reconcilePoint10xCatalogSnapshot(base);
  const parentB = reconcileAddendumFixture(addendum);
  // Only static shape/contract review. Do not copy raw untrusted catalog data.
  if (
    parentA.status !== 'NO_GO_FIXTURE_ONLY_CATALOG_RECONCILIATION' ||
    parentB.status !== 'NO_GO_ADDENDUM_FIXTURE_ONLY'
  )
    errors.push('SINGLE_PACK_OFFLINE_REVIEW_REJECTED');
  if (
    !record(sqlDigests) ||
    sqlDigests.base !== PINNED_CATALOG_SQL_SHA256 ||
    sqlDigests.addendum !== ADDENDUM_SQL_SHA256 ||
    Object.keys(sqlDigests).length !== 2
  )
    errors.push('BOTH_PINNED_SQL_HASHES_REQUIRED');
  if (PINNED_CATALOG_SQL_SHA256 !== UNCHANGED_ORIGINAL_SQL_SHA256)
    errors.push('ORIGINAL_CATALOG_SHA_MUST_BE_INTACT');
  for (const section of REQUIRED_CATALOG_SECTIONS)
    if (!Array.isArray(base[section]))
      errors.push('BASE_SECTION_MISSING:' + section);
  for (const section of ADDENDUM_IDS)
    if (!Array.isArray(addendum[section]))
      errors.push('ADDENDUM_SECTION_MISSING:' + section);

  const bt = mapped(
    rows(base, 'NL-CATALOG-03').filter((x) => x?.trigger_name != null),
    (x) => itemKey(x.expected_relation, x.trigger_name),
    'BASE_TRIGGER',
    errors
  );
  const at = mapped(
    rows(addendum, 'NL-GAP-01'),
    (x) => itemKey(x.table_name, x.trigger_name),
    'GAP_TRIGGER',
    errors
  );
  for (const [key, a] of bt) {
    const b = at.get(key);
    if (!b) {
      errors.push('BASE_TRIGGER_NOT_IN_ADDENDUM');
      continue;
    }
    compare(
      errors,
      'TRIGGER_ENABLED_STATE_CONTRADICTION',
      a.trigger_enabled_state,
      b.trigger_enable_state
    );
    const af = identity(a.invoked_function),
      bf = identity(b.invoked_function_identity);
    if (!af || !bf) errors.push('TRIGGER_FUNCTION_IDENTITY_UNRESOLVED');
    else compare(errors, 'TRIGGER_FUNCTION_TARGET_CONTRADICTION', af, bf);
  }
  for (const [key, b] of at) {
    if (b.table_schema !== 'public')
      errors.push('TRIGGER_SCHEMA_NOT_PUBLIC_OR_UNKNOWN');
    if (bt.has(key)) continue;
    if (!EXPECTED_GAP_TRIGGERS.some((x) => x.trigger === b.trigger_name))
      errors.push('EXTRA_PRIVILEGED_TRIGGER_NOT_BASELINE_VERIFIED');
  }

  const bf = mapped(
    rows(base, 'NL-CATALOG-04'),
    (x) => identity(x.signature),
    'BASE_FUNCTION',
    errors
  );
  const gf = mapped(
    rows(addendum, 'NL-GAP-02'),
    (x) => {
      const fn = identity(x.function_identity);
      const role = x.target_role;
      return fn && ADDENDUM_ROLE_NAMES.includes(role) ? fn + '|' + role : null;
    },
    'GAP_FUNCTION_ROLE',
    errors
  );
  for (const b of at.values()) {
    const fn = identity(b.invoked_function_identity);
    if (!fn) {
      errors.push('TRIGGER_FUNCTION_SIGNATURE_NOT_RESOLVED');
      continue;
    }
    const invoked = gf.get(fn + '|service_role');
    if (!invoked) {
      errors.push('TRIGGER_FUNCTION_MISSING_FROM_PRIVILEGED_REGISTRY');
      continue;
    }
    compare(
      errors,
      'TRIGGER_FUNCTION_OWNER_CONTRADICTION',
      b.function_owner,
      invoked.function_owner
    );
    compare(
      errors,
      'TRIGGER_FUNCTION_SECDEF_CONTRADICTION',
      b.is_security_definer,
      invoked.is_security_definer
    );
    compare(
      errors,
      'TRIGGER_FUNCTION_EXECUTE_CONTRADICTION',
      b.service_role_can_execute,
      invoked.role_can_execute
    );
    compare(
      errors,
      'TRIGGER_FUNCTION_SEARCH_PATH_CONTRADICTION',
      b.function_has_fixed_search_path,
      invoked.function_has_fixed_search_path
    );
    compare(
      errors,
      'TRIGGER_FUNCTION_OWNER_BYPASS_CONTRADICTION',
      b.owner_bypassrls,
      invoked.owner_bypassrls
    );
    compare(
      errors,
      'TRIGGER_FUNCTION_OWNER_SUPERUSER_CONTRADICTION',
      b.owner_superuser,
      invoked.owner_superuser
    );
  }
  for (const [fn, a] of bf) {
    const b = gf.get(fn + '|service_role');
    if (!b) {
      if (a.found === true) errors.push('BASE_FUNCTION_NOT_IN_ADDENDUM');
      continue;
    }
    if (a.found !== true) errors.push('FUNCTION_PRESENCE_CONTRADICTION');
    if (b.role_found !== true) errors.push('SERVICE_ROLE_MISSING_FOR_FUNCTION');
    compare(
      errors,
      'FUNCTION_OWNER_CONTRADICTION',
      a.function_owner,
      b.function_owner
    );
    compare(
      errors,
      'FUNCTION_SECDEF_CONTRADICTION',
      a.is_security_definer,
      b.is_security_definer
    );
    compare(
      errors,
      'FUNCTION_EXECUTE_CONTRADICTION',
      a.role_can_execute,
      b.role_can_execute
    );
    if (a.role_can_execute === null || b.role_can_execute === null)
      errors.push('FUNCTION_EXECUTE_UNKNOWN_IN_ONE_PACK');
    if (
      typeof a.explicit_execute_acl === 'string' &&
      b.explicit_function_acl_present !== true
    )
      errors.push('FUNCTION_EXPLICIT_ACL_PRESENCE_CONTRADICTION');
    if (
      a.explicit_execute_acl === null &&
      b.explicit_function_acl_present === true
    )
      errors.push('FUNCTION_EXPLICIT_ACL_PRESENCE_CONTRADICTION');
  }
  for (const fn of REQUIRED_ADDED_FUNCTIONS) {
    const b = gf.get(fn + '|service_role');
    if (!b) errors.push('REQUIRED_NEW_FUNCTION_MISSING_FROM_UNION');
    if (!b || typeof b.role_can_execute !== 'boolean')
      errors.push('UNRESOLVED_NEW_FUNCTION_EXECUTE');
  }
  for (const [key, row] of gf) {
    const name = key.split('|')[0];
    if (!bf.has(name) && !REQUIRED_ADDED_FUNCTIONS.includes(name))
      errors.push('NEW_PRIVILEGED_FUNCTION_NOT_BASELINE_REVIEWED');
    if (row.is_security_definer === true)
      errors.push('PRIVILEGED_SECDEF_MUST_BE_REVIEWED');
    if (row.role_can_execute === true)
      errors.push('EFFECTIVE_ROLE_EXECUTE_PATH_PRESENT');
    if (row.role_found !== true) errors.push('FUNCTION_ROLE_NOT_RESOLVED');
    if (row.owner_superuser !== false || row.owner_bypassrls !== false)
      errors.push('FUNCTION_OWNER_PRIVILEGE_UNPROVEN');
  }

  const br = mapped(
    rows(base, 'NL-CATALOG-02'),
    (x) =>
      typeof x.expected_relation === 'string' ? x.expected_relation : null,
    'BASE_RELATION',
    errors
  );
  const gr = mapped(
    rows(addendum, 'NL-GAP-03'),
    (x) =>
      typeof x.relation_identity === 'string' &&
      ADDENDUM_ROLE_NAMES.includes(x.target_role)
        ? x.relation_identity.replace(/^public\./u, '') + '|' + x.target_role
        : null,
    'GAP_RELATION_ROLE',
    errors
  );
  for (const [relation, a] of br) {
    const b = gr.get(relation + '|service_role');
    if (!b) {
      // Not every base relation is a trigger host. Not proof of absence.
      errors.push('BASE_RELATION_NOT_IN_TRIGGER_ACL_ADDENDUM');
      continue;
    }
    compare(
      errors,
      'RELATION_OWNER_CONTRADICTION',
      a.table_owner,
      b.relation_owner
    );
    compare(errors, 'RELATION_RLS_CONTRADICTION', a.rls_enabled, b.rls_enabled);
    compare(
      errors,
      'RELATION_FORCE_RLS_CONTRADICTION',
      a.force_rls,
      b.rls_forced
    );
    for (const field of [
      'can_insert',
      'can_update',
      'can_delete',
      'can_truncate',
      'can_trigger'
    ]) {
      if (typeof a[field] !== 'boolean' || typeof b[field] !== 'boolean')
        errors.push('RELATION_EFFECTIVE_PRIVILEGE_UNKNOWN');
      else
        compare(
          errors,
          'RELATION_EFFECTIVE_PRIVILEGE_CONTRADICTION',
          a[field],
          b[field]
        );
    }
  }
  for (const [key, row] of gr) {
    if (!row.relation_identity?.startsWith('public.'))
      errors.push('TRIGGER_HOST_SCHEMA_NOT_PUBLIC_OR_UNKNOWN');
    const relation = key.split('|')[0];
    if (!br.has(relation)) errors.push('UNREVIEWED_TRIGGER_HOST_TABLE');
    if (row.owner_superuser !== false || row.owner_bypassrls !== false)
      errors.push('TABLE_OWNER_PRIVILEGE_UNPROVEN');
    if (row.role_found !== true) errors.push('TABLE_TARGET_ROLE_UNRESOLVED');
    for (const field of [
      'can_insert',
      'can_update',
      'can_delete',
      'can_truncate',
      'can_trigger'
    ]) {
      if (row[field] !== false)
        errors.push('TRIGGER_HOST_TABLE_DML_OR_TRUNCATE_NOT_DENIED');
    }
  }

  const baseService = rows(base, 'NL-CATALOG-05').find(
    (x) => x.expected_role === 'service_role'
  );
  if (!baseService || baseService.found !== true)
    errors.push('BASE_SERVICE_ROLE_CATALOG_MISSING');
  if (baseService?.rolbypassrls !== false)
    errors.push('SERVICE_ROLE_BYPASSRLS_MUST_BE_REVIEWED');
  if (baseService?.rolsuper !== false)
    errors.push('SERVICE_ROLE_SUPERUSER_MUST_BE_REVIEWED');
  return output('NO_GO_UNTRUSTED_CATALOG_UNION', errors, {
    baseReviewBlocked: parentA.blockers.length > 0,
    addendumReviewBlocked: parentB.blockers.length > 0,
    comparedTriggers: bt.size,
    comparedFunctionSignatures: bf.size,
    observedFunctionRoleKeys: gf.size,
    comparedRelations: br.size,
    observedRelationRoleKeys: gr.size,
    writerClassCount: SCOUT_POINT_10X_WRITER_CLASSES.length,
    privilegedPathCategoryCount: REQUIRED_PRIVILEGED_PATHS.length,
    unknownPrivilegedWritersRuledOut: false
  });
}
export function computeProposedBundleDigest({
  base = PINNED_CATALOG_SQL_SHA256,
  addendum = ADDENDUM_SQL_SHA256
} = {}) {
  // Canonical review-only fingerprint, not an existing OWNER grant.
  return createHash('sha256')
    .update(
      'NOVELIGHT-CATALOG-BUNDLE-V1\n' + base + '\n' + addendum + '\n',
      'utf8'
    )
    .digest('hex');
}
export function reviewTrustedMainCatalogBundleContract(request = {}) {
  const errors = [...BUNDLE_REVIEW_BLOCKERS];
  if (!record(request))
    return output('HOLD_INVALID_BUNDLE_CONTRACT', [
      ...errors,
      'BUNDLE_REQUEST_MUST_BE_RECORD'
    ]);
  if (
    request.scope !== PROPOSED_BUNDLE_SCOPE ||
    request.scope === PROPOSED_CATALOG_SCOPE
  )
    errors.push('NEW_INDEPENDENT_BUNDLE_SCOPE_REQUIRED');
  if (request.issueNumber !== OWNER_CONTROL_ISSUE)
    errors.push('OWNER_ISSUE_294_REQUIRED');
  if (request.operation !== 'read-catalog-bundle-only')
    errors.push('BUNDLE_READONLY_OPERATION_REQUIRED');
  if (
    request.stagingRef !== STAGING_PROJECT ||
    request.stagingRef === PRODUCTION_PROJECT
  )
    errors.push('EXACT_STAGING_PROJECT_IDENTITY_REQUIRED');
  if (!sha40(request.mainSha) || !sha40(request.headSha))
    errors.push('BUNDLE_MAIN_AND_PR_HEAD_REQUIRED');
  if (
    !record(request.sqlDigests) ||
    request.sqlDigests.base !== BUNDLE_SQL_HASHES.base ||
    request.sqlDigests.addendum !== BUNDLE_SQL_HASHES.addendum ||
    Object.keys(request.sqlDigests).length !== 2
  )
    errors.push('TWO_PINNED_SQL_DIGESTS_REQUIRED');
  if (request.bundleDigest !== computeProposedBundleDigest())
    errors.push('CANONICAL_BUNDLE_DIGEST_REQUIRED');
  if (!Number.isSafeInteger(request.commentId) || request.commentId <= 0)
    errors.push('UNSPENT_UNIQUE_OWNER_COMMENT_REQUIRED');
  if (
    request.ownerProof !== undefined ||
    request.claimed !== undefined ||
    request.ownerApproved !== undefined ||
    request.liveProof !== undefined
  )
    errors.push('CALLER_ASSERTED_AUTHORITY_UNTRUSTED');
  return output('HOLD_UNAPPROVED_BUNDLE_CONTRACT', errors, {
    proposedScope: PROPOSED_BUNDLE_SCOPE,
    reviewDomain: MUTATION_DOMAIN,
    proposedSqlDigests: BUNDLE_SQL_HASHES,
    proposedBundleDigest: computeProposedBundleDigest(),
    requiredTrustedMainSequence: BUNDLE_REVIEW_STEPS,
    freshScopedApprovalIssued: false,
    actualOneShotOwnerClaim: false,
    existingOwnerScopesReusable: false
  });
}
export function newOfflineBundleClaimState() {
  return freeze({
    domain: MUTATION_DOMAIN,
    epoch: 0,
    version: 0,
    active: null,
    spentIds: freeze([]),
    commitAckUnknown: false
  });
}
export function simulateBundleOneShotCas({
  state,
  request,
  expectedVersion,
  expectedEpoch,
  ack = 'received'
} = {}) {
  const c = reviewTrustedMainCatalogBundleContract(request);
  const errors = [...c.blockers];
  if (
    !record(state) ||
    state.domain !== MUTATION_DOMAIN ||
    !Number.isSafeInteger(state.version) ||
    state.version < 0 ||
    !Number.isSafeInteger(state.epoch) ||
    state.epoch < 0 ||
    !Array.isArray(state.spentIds)
  )
    return output('HOLD_BAD_CAS_STATE', [...errors, 'CAS_STATE_INVALID']);
  const invalid = c.blockers.some((x) => !BUNDLE_REVIEW_BLOCKERS.includes(x));
  if (invalid) errors.push('BUNDLE_TARGET_CONTRACT_REJECTED');
  if (state.version !== expectedVersion || state.epoch !== expectedEpoch)
    errors.push('CAS_EXPECTED_VERSION_OR_EPOCH_STALE');
  if (state.active !== null)
    errors.push('SHARED_MUTATION_DOMAIN_ALREADY_OCCUPIED');
  if (state.commitAckUnknown)
    errors.push('UNCERTAIN_COMMIT_REQUIRES_AUTHORITATIVE_READBACK');
  if (state.spentIds.includes(request?.commentId))
    errors.push('OWNER_COMMENT_ALREADY_SPENT_NO_REPLAY');
  if (!['received', 'lost', 'unknown'].includes(ack))
    errors.push('COMMIT_ACK_STATUS_INVALID');
  const denial = errors.filter((x) => !BUNDLE_REVIEW_BLOCKERS.includes(x));
  if (denial.length)
    return output('HOLD_SYNTHETIC_CAS_DENIED', errors, {
      syntheticStateOnly: state
    });
  const next = freeze({
    domain: MUTATION_DOMAIN,
    version: state.version + 1,
    epoch: state.epoch + 1,
    active: freeze({
      scope: PROPOSED_BUNDLE_SCOPE,
      commentId: request.commentId,
      bundleDigest: computeProposedBundleDigest()
    }),
    spentIds: freeze([...state.spentIds, request.commentId]),
    commitAckUnknown: ack !== 'received'
  });
  return output(
    ack === 'received'
      ? 'MODEL_BUNDLE_CAS_SPENT_NOT_REAL'
      : 'HOLD_UNKNOWN_COMMIT_ACK_NO_RETRY',
    errors,
    {
      syntheticStateOnly: next,
      modelSpentOnly: true,
      noAutomaticReplay: true,
      noAutomaticRelease: true
    }
  );
}
