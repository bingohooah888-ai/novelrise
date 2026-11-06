// NOVELIGHT Point10x additional catalog review: OFFLINE AND INERT ONLY.
// Synthetic source and catalog evidence are never proof of live Staging state.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PINNED_CATALOG_SQL_SHA256,
  PROPOSED_CATALOG_SCOPE
} from './scout-point10x-catalog-readonly-review.mjs';

export const ADDENDUM_SQL_PATH =
  'docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql';
export const ADDENDUM_SQL_SHA256 =
  '6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1';
export const UNCHANGED_ORIGINAL_SQL_SHA256 =
  '740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11';
export const ADDENDUM_IDS = Object.freeze([
  'NL-GAP-01',
  'NL-GAP-02',
  'NL-GAP-03'
]);
export const ADDENDUM_ROLE_NAMES = Object.freeze([
  'service_role',
  'anon',
  'authenticated'
]);
export const ADDENDUM_SCOPE_STATUS =
  'NEW_SQL_DIGEST_NEEDS_SEPARATE_OWNER_APPROVAL';
export const SOURCE_ANCHORS = Object.freeze([
  Object.freeze({
    path: 'supabase/migrations/20260920223049_scout_record_beta_core.sql',
    terms: Object.freeze([
      'create or replace function public.novelight_award_valid_read_scout_xp()',
      'create trigger scout_event_valid_read_xp',
      'execute function public.novelight_award_valid_read_scout_xp()'
    ])
  }),
  Object.freeze({
    path: 'supabase/migrations/20261005153000_scout_xp_daily_40_rules.sql',
    terms: Object.freeze([
      'create or replace function public.novelight_award_valid_read_scout_xp()',
      'security definer',
      'insert into public.scout_xp_ledger'
    ])
  }),
  Object.freeze({
    path: 'supabase/migrations/20260928061000_beta_rank_discovery_privacy.sql',
    terms: Object.freeze([
      'rename to novelight_process_seed_discovery_rank_internal_20260928',
      'rename to novelight_award_discovery_points_rank_internal_20260928',
      'rename to novelight_award_level_up_points_rank_internal_20260928'
    ])
  }),
  Object.freeze({
    path: 'supabase/migrations/20260909140000_chapter38_seed_discovery_exp.sql',
    terms: Object.freeze([
      'grant execute on function public.novelight_process_seed_discovery(uuid) to service_role'
    ])
  }),
  Object.freeze({
    path: 'supabase/migrations/20260921063000_badge_system_catalog.sql',
    terms: Object.freeze([
      'create trigger scout_xp_refresh_reader_badges',
      'create trigger scout_point_refresh_reader_badges',
      'create trigger scout_metric_state_refresh_badges',
      'execute function public.novelight_refresh_reader_badges_from_xp()',
      'execute function public.novelight_refresh_reader_badges_from_point()'
    ])
  })
]);
export const EXPECTED_GAP_TRIGGERS = Object.freeze([
  Object.freeze({
    trigger: 'scout_event_valid_read_xp',
    function: 'novelight_award_valid_read_scout_xp()'
  }),
  Object.freeze({
    trigger: 'scout_xp_refresh_reader_badges',
    function: 'novelight_refresh_reader_badges_from_xp()'
  }),
  Object.freeze({
    trigger: 'scout_point_refresh_reader_badges',
    function: 'novelight_refresh_reader_badges_from_point()'
  }),
  Object.freeze({
    trigger: 'scout_metric_state_refresh_badges',
    function: 'novelight_refresh_badges_from_metric_state()'
  })
]);
export const REQUIRED_ADDED_FUNCTIONS = Object.freeze([
  'novelight_award_valid_read_scout_xp()',
  'novelight_process_seed_discovery_rank_internal_20260928(uuid)',
  'novelight_award_discovery_points_rank_internal_20260928()',
  'novelight_refresh_reader_badges_from_xp()',
  'novelight_refresh_reader_badges_from_point()',
  'novelight_refresh_badges_from_metric_state()'
]);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const uniq = (x) => Object.freeze([...new Set(x)]);
const audit = (type, reasons, extra = {}) =>
  Object.freeze({
    status: type,
    blockers: uniq(reasons),
    ...extra,
    evidenceLevel: 'UNTRUSTED_OFFLINE_REVIEW_ONLY',
    originalSqlDigestUnchanged: true,
    addendumScopeApproved: false,
    ownerAuthenticated: false,
    spentLedgerCommitted: false,
    actualCatalogRead: false,
    realWriterStopped: false,
    actualDataPlaneFenced: false,
    mayConnectStaging: false,
    mayReadDb: false,
    mayRunSql: false,
    mayWriteDb: false,
    mayUseDocker: false,
    mayClaimOwner: false,
    mayMergeMain: false,
    mayDeploy: false,
    mayChangeProduction: false
  });
export function readSourceAnchors() {
  const map = new Map();
  for (const entry of SOURCE_ANCHORS) {
    const url = new URL('../' + entry.path, import.meta.url);
    map.set(entry.path, readFileSync(fileURLToPath(url), 'utf8'));
  }
  return map;
}
export function reviewSourcePrivilegeGaps(sources) {
  if (!(sources instanceof Map))
    return audit('HOLD_SOURCE_INPUT', ['SOURCE_MAP_REQUIRED']);
  const blockers = [
    'SOURCE_IS_NOT_LIVE_FUNCTION_OR_ACL_PROOF',
    'SECDEF_AND_SERVICE_ROLE_REAL_CATALOG_STILL_UNKNOWN'
  ];
  const found = [];
  for (const anchor of SOURCE_ANCHORS) {
    const src = sources.get(anchor.path);
    if (typeof src !== 'string') {
      blockers.push('SOURCE_MISSING:' + anchor.path);
      continue;
    }
    for (const term of anchor.terms) {
      const at = src.indexOf(term);
      if (at < 0) blockers.push('SOURCE_TERM_MISSING:' + anchor.path);
      else
        found.push(
          Object.freeze({
            path: anchor.path,
            line: src.slice(0, at).split(/\r?\n/u).length,
            kind: 'historical_source_only'
          })
        );
    }
  }
  return audit('NO_GO_SOURCE_GAP_REVIEW_ONLY', blockers, {
    foundCount: found.length,
    sourceAnchors: Object.freeze(found),
    redefinedReadXpFunctionSourceOnly: true,
    knownRenamedLegacyFunctionsSourceOnly: true
  });
}
export function readAddendumSql() {
  return readFileSync(
    fileURLToPath(new URL('../' + ADDENDUM_SQL_PATH, import.meta.url))
  );
}
export function reviewAddendumSql(bytes, relativePath = ADDENDUM_SQL_PATH) {
  const blockers = [
    'NO_OWNER_APPROVAL_FOR_NEW_SQL_DIGEST',
    'SQL_IS_NOT_EXECUTED_OR_POSTGRES_VALIDATED'
  ];
  if (relativePath !== ADDENDUM_SQL_PATH)
    blockers.push('ADDENDUM_MUST_STAY_OUTSIDE_ACTIVE_MIGRATIONS');
  if (!Buffer.isBuffer(bytes) && typeof bytes !== 'string')
    return audit('HOLD_BAD_SQL_INPUT', [...blockers, 'SQL_BYTES_REQUIRED']);
  const digest = sha256(bytes);
  if (digest !== ADDENDUM_SQL_SHA256)
    blockers.push('ADDENDUM_SQL_BYTES_CHANGED');
  if (PINNED_CATALOG_SQL_SHA256 !== UNCHANGED_ORIGINAL_SQL_SHA256)
    blockers.push('ORIGINAL_EIGHT_QUERY_DIGEST_CHANGED');
  const source = bytes.toString('utf8');
  const clean = source
    .replace(/--[^\r\n]*/gu, ' ')
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/'(?:''|[^'])*'/gu, "''");
  const statements = clean
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  if (statements.length !== 5) blockers.push('THREE_READONLY_SELECTS_REQUIRED');
  if (
    statements[0] !==
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
  )
    blockers.push('READONLY_TRANSACTION_REQUIRED');
  if (statements.at(-1) !== 'ROLLBACK')
    blockers.push('EXPLICIT_ROLLBACK_REQUIRED');
  for (const stmt of statements.slice(1, -1)) {
    if (!/^(SELECT|WITH)\s/iu.test(stmt))
      blockers.push('ADDITIONAL_NON_SELECT_STATEMENT');
  }
  if (
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|COPY|SET|RESET|VACUUM|LOCK)\b/iu.test(
      clean
    )
  )
    blockers.push('DANGEROUS_KEYWORD_IN_SQL_CANDIDATE');
  for (const id of ADDENDUM_IDS) {
    if ((source.match(new RegExp('-- ' + id + ':', 'gu')) || []).length !== 1)
      blockers.push('MISSING_OR_DUPLICATE_SQL_SECTION:' + id);
  }
  for (const name of [
    'pg_catalog.pg_proc',
    'pg_catalog.pg_trigger',
    'pg_catalog.pg_roles',
    'has_function_privilege',
    'has_table_privilege',
    'prosecdef',
    'rolbypassrls'
  ]) {
    if (!source.includes(name))
      blockers.push('MISSING_CATALOG_COVERAGE:' + name);
  }
  return audit('HOLD_ADDENDUM_SQL_REVIEW_ONLY', blockers, {
    digest,
    statementCount: statements.length,
    sectionCount: ADDENDUM_IDS.length,
    authorizedByOriginalScope: false
  });
}
const ALLOWED_FIELDS = Object.freeze({
  'NL-GAP-01': Object.freeze([
    'evidence_id',
    'table_schema',
    'table_name',
    'table_owner',
    'trigger_name',
    'trigger_enable_state',
    'internal_trigger',
    'invoked_function_identity',
    'function_owner',
    'owner_superuser',
    'owner_bypassrls',
    'is_security_definer',
    'function_has_fixed_search_path',
    'service_role_can_execute',
    'trigger_type_mask'
  ]),
  'NL-GAP-02': Object.freeze([
    'evidence_id',
    'function_identity',
    'function_owner',
    'owner_superuser',
    'owner_bypassrls',
    'is_security_definer',
    'function_has_fixed_search_path',
    'explicit_function_acl_present',
    'target_role',
    'role_found',
    'role_can_execute',
    'referenced_by_trigger'
  ]),
  'NL-GAP-03': Object.freeze([
    'evidence_id',
    'relation_identity',
    'relation_owner',
    'owner_superuser',
    'owner_bypassrls',
    'rls_enabled',
    'rls_forced',
    'target_role',
    'role_found',
    'can_insert',
    'can_update',
    'can_delete',
    'can_truncate',
    'can_trigger'
  ])
});
export function reconcileAddendumFixture(sections) {
  if (!obj(sections))
    return audit('HOLD_BAD_ADDENDUM_FIXTURE', [
      'THREE_CATALOG_SECTIONS_REQUIRED'
    ]);
  const blockers = [
    'ADDENDUM_FIXTURE_NOT_LIVE_STAGING',
    'TRIGGER_FUNCTIONS_AND_EVERY_OWNER_NOT_PROVEN_FENCED',
    'UNKNOWN_FUNCTION_AND_OUTSIDE_DATABASE_WRITERS_UNEXCLUDED',
    'ORIGINAL_CATALOG_SCOPE_NOT_AUTHORITY_FOR_ADDENDUM'
  ];
  for (const key of Object.keys(sections)) {
    if (!ADDENDUM_IDS.includes(key)) blockers.push('EXTRA_SECTION_DENIED');
  }
  const scanned = {};
  for (const id of ADDENDUM_IDS) {
    if (!Array.isArray(sections[id])) {
      blockers.push('MISSING_SECTION:' + id);
      scanned[id] = [];
      continue;
    }
    if (sections[id].length > 1000) {
      blockers.push('UNBOUNDED_SECTION:' + id);
      scanned[id] = [];
      continue;
    }
    scanned[id] = [];
    for (const row of sections[id]) {
      if (!obj(row)) {
        blockers.push('MALFORMED_ROW:' + id);
        continue;
      }
      scanned[id].push(row);
      if (row.evidence_id !== id) blockers.push('MISMATCH_EVIDENCE_ID:' + id);
      if (Object.keys(row).some((key) => !ALLOWED_FIELDS[id].includes(key)))
        blockers.push('UNKNOWN_OUTPUT_FIELD:' + id);
    }
  }
  const triggers = scanned['NL-GAP-01'];
  for (const expected of EXPECTED_GAP_TRIGGERS) {
    const matches = triggers.filter((x) => x.trigger_name === expected.trigger);
    if (matches.length !== 1) {
      blockers.push('TRIGGER_CARDINALITY_UNVERIFIED:' + expected.trigger);
      continue;
    }
    const row = matches[0];
    if (
      typeof row.invoked_function_identity !== 'string' ||
      !row.invoked_function_identity.endsWith(expected.function)
    )
      blockers.push('TRIGGER_TARGET_MISMATCH:' + expected.trigger);
    if (!['O', 'A'].includes(row.trigger_enable_state))
      blockers.push('TRIGGER_NOT_ORIGIN_ENABLED:' + expected.trigger);
    if (row.is_security_definer === true)
      blockers.push('PRIVILEGED_TRIGGER_FUNCTION:' + expected.trigger);
    if (row.function_has_fixed_search_path !== true)
      blockers.push('TRIGGER_SEARCH_PATH_UNKNOWN:' + expected.trigger);
    if (row.service_role_can_execute !== false)
      blockers.push(
        'TRIGGER_SERVICE_ROLE_EXECUTE_NOT_REVOKED:' + expected.trigger
      );
    if (row.owner_superuser !== false || row.owner_bypassrls !== false)
      blockers.push('TRIGGER_OWNER_BYPASS_NOT_DISPROVEN:' + expected.trigger);
  }
  for (const row of triggers) {
    if (
      typeof row.trigger_name === 'string' &&
      !EXPECTED_GAP_TRIGGERS.some((x) => x.trigger === row.trigger_name)
    )
      blockers.push('UNREGISTERED_TRIGGER_REQUIRES_REVIEW');
  }
  const funcs = scanned['NL-GAP-02'];
  for (const identity of REQUIRED_ADDED_FUNCTIONS) {
    const matches = funcs.filter(
      (x) =>
        typeof x.function_identity === 'string' &&
        x.function_identity.endsWith(identity)
    );
    const roles = new Set(matches.map((x) => x.target_role));
    if (!ADDENDUM_ROLE_NAMES.every((x) => roles.has(x))) {
      blockers.push('FUNCTION_ROLE_COVERAGE_MISSING:' + identity);
      continue;
    }
    if (matches.length !== 3)
      blockers.push('DUPLICATE_FUNCTION_ROLE_EVIDENCE:' + identity);
    for (const row of matches) {
      if (row.role_found !== true || typeof row.role_can_execute !== 'boolean')
        blockers.push('FUNCTION_EFFECTIVE_EXECUTE_UNKNOWN:' + identity);
      if (row.role_can_execute === true)
        blockers.push(
          'FUNCTION_CALLABLE_BY_ROLE:' + identity + ':' + row.target_role
        );
      if (typeof row.function_owner !== 'string' || !row.function_owner)
        blockers.push('FUNCTION_OWNER_UNKNOWN:' + identity);
      if (row.owner_superuser !== false || row.owner_bypassrls !== false)
        blockers.push('FUNCTION_OWNER_PRIVILEGE_UNCLOSED:' + identity);
      if (row.is_security_definer === true)
        blockers.push('UNFENCED_SECURITY_DEFINER_CANDIDATE:' + identity);
      if (
        row.is_security_definer === true &&
        row.function_has_fixed_search_path !== true
      )
        blockers.push('SECDEF_SEARCH_PATH_MISSING:' + identity);
    }
  }
  for (const row of funcs) {
    if (typeof row.function_identity !== 'string' || !row.function_identity)
      blockers.push('FUNCTION_IDENTITY_UNKNOWN');
    else if (
      !REQUIRED_ADDED_FUNCTIONS.some((x) => row.function_identity.endsWith(x))
    )
      blockers.push('UNKNOWN_PRIVILEGED_FUNCTION_REQUIRES_REVIEW');
    if (!ADDENDUM_ROLE_NAMES.includes(row.target_role))
      blockers.push('UNEXPECTED_FUNCTION_ROLE');
  }
  const tableKeys = new Set();
  for (const row of scanned['NL-GAP-03']) {
    const key = row.relation_identity + '|' + row.target_role;
    if (tableKeys.has(key)) blockers.push('DUPLICATE_TABLE_ROLE_PRIVILEGE');
    tableKeys.add(key);
    if (!ADDENDUM_ROLE_NAMES.includes(row.target_role))
      blockers.push('UNEXPECTED_TABLE_ROLE');
    if (row.role_found !== true) blockers.push('TABLE_ROLE_NOT_FOUND');
    for (const op of [
      'can_insert',
      'can_update',
      'can_delete',
      'can_truncate',
      'can_trigger'
    ]) {
      if (row[op] !== false)
        blockers.push('TABLE_PRIVILEGE_UNPROVEN:' + key + ':' + op);
    }
    if (row.owner_superuser !== false || row.owner_bypassrls !== false)
      blockers.push('TABLE_OWNER_BYPASS_NOT_DISPROVEN:' + key);
  }
  if (!scanned['NL-GAP-03'].length)
    blockers.push('TRIGGER_TABLE_ACLS_NOT_ENUMERATED');
  return audit('NO_GO_ADDENDUM_FIXTURE_ONLY', blockers, {
    triggerRowsSeen: triggers.length,
    functionRoleRowsSeen: funcs.length,
    tableRoleRowsSeen: scanned['NL-GAP-03'].length,
    sourceOnly: true,
    originalScope: PROPOSED_CATALOG_SCOPE,
    newSqlRequiresDistinctPinnedApproval: true
  });
}
