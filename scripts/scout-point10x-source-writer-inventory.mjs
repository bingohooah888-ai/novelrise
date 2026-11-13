// NOVELIGHT βScout Point10x — source-only audit. No DB, secrets, Docker,
// deployment, migration apply, claims, or proof of actual deployed catalog state.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import { REQUIRED_PRIVILEGED_PATHS } from './scout-point10x-cas-fencing-handoff-model.mjs';

export const SOURCE_INVENTORY_ROOTS = Object.freeze([
  'supabase/migrations',
  'supabase/functions',
  'api',
  'src',
  '.github/workflows'
]);
export const SOURCE_WRITER_RULES = Object.freeze([
  {
    kind: 'xp_insert_level_trigger',
    paths: [
      'supabase/migrations/20260928061000_beta_rank_discovery_privacy.sql'
    ],
    terms: [
      'create or replace function public.novelight_award_level_up_points()',
      'create trigger scout_xp_level_up_points'
    ],
    classification: 'confirmed_migration_definition_not_live_execution'
  },
  {
    kind: 'legacy_rank_internal_xp',
    paths: [
      'supabase/migrations/20260928061000_beta_rank_discovery_privacy.sql'
    ],
    terms: ['rename to novelight_award_level_up_points_rank_internal_20260928'],
    classification: 'historical_renamed_function_privilege_not_live_verified'
  },
  {
    kind: 'discovery_and_event_triggers',
    paths: ['supabase/migrations/20260920223049_scout_record_beta_core.sql'],
    terms: [
      'create trigger scout_event_discovery_points',
      'insert into public.scout_point_ledger'
    ],
    classification: 'confirmed_migration_trigger_not_live_execution'
  },
  {
    kind: 'badge_evaluation_and_progress',
    paths: [
      'supabase/migrations/20260921022608_scout_badge_foundation.sql',
      'supabase/migrations/20260921063000_badge_system_catalog.sql'
    ],
    terms: [
      'novelight_apply_scout_badge_progress',
      'novelight_apply_scout_badge_evaluation'
    ],
    classification: 'confirmed_migration_definitions_not_live_execution'
  },
  {
    kind: 'operator_adjustment_and_reversal',
    paths: [
      'supabase/migrations/20260921025328_scout_record_usage_controls.sql'
    ],
    terms: [
      'novelight_admin_scout_point_action',
      'insert into public.scout_point_operator_actions'
    ],
    classification: 'confirmed_migration_definition_not_live_execution'
  },
  {
    kind: 'direct_service_role_and_privileged_rpcs',
    paths: [
      'supabase/migrations/20260909140000_chapter38_seed_discovery_exp.sql'
    ],
    terms: [
      'grant execute on function public.novelight_process_seed_discovery(uuid) to service_role'
    ],
    classification: 'privileged_rpc_grant_source_only_direct_dml_unproven'
  },
  {
    kind: 'scheduled_jobs_edge_and_queues',
    paths: [],
    terms: [],
    classification: 'no_point_specific_active_worker_confirmed_from_source'
  },
  {
    kind: 'application_read_comment_award_routes',
    paths: [
      'supabase/migrations/20260910070000_chapter38_comment_scout_exp_foundation.sql',
      'supabase/migrations/20260920223049_scout_record_beta_core.sql'
    ],
    terms: [
      'insert into public.scout_xp_ledger',
      'create trigger scout_event_valid_read_xp'
    ],
    classification: 'database_event_producer_found_api_callchain_unverified'
  },
  {
    kind: 'inflight_retry_and_outbox_workers',
    paths: [],
    terms: [],
    classification: 'no_point_specific_runtime_retry_outbox_confirmed'
  }
]);
export const SOURCE_PRIVILEGE_RULES = Object.freeze([
  {
    kind: 'legacy_security_definer_rpc',
    path: 'supabase/migrations/20260928061000_beta_rank_discovery_privacy.sql',
    term: 'create or replace function public.novelight_award_level_up_points()'
  },
  {
    kind: 'direct_service_role_dml',
    path: 'supabase/migrations/20260909140000_chapter38_seed_discovery_exp.sql',
    term: 'grant execute on function public.novelight_process_seed_discovery(uuid) to service_role'
  },
  {
    kind: 'db_trigger_and_owner_roles',
    path: 'supabase/migrations/20260921025328_scout_record_usage_controls.sql',
    term: 'create trigger scout_point_earning_control'
  },
  { kind: 'edge_cron_queue_retry', path: null, term: null },
  { kind: 'unregistered_future_writer', path: null, term: null }
]);
export const PROTECTED_POINT_TABLES = Object.freeze([
  'scout_xp_ledger',
  'scout_point_ledger',
  'scout_badge_definitions',
  'user_scout_badges',
  'scout_point_operator_actions'
]);
export const SOURCE_GAP_CODES = Object.freeze([
  'DB_FENCE_NOT_FOUND_IN_LEGACY_POINT_CONTROL_TRIGGER',
  'SERVICE_ROLE_NOT_REVOKED_BY_ANON_AUTHENTICATED_ONLY_SQL',
  'RUNTIME_ROLE_ACL_CATALOG_NOT_READ',
  'NINE_WRITER_CLASSES_NOT_NINE_VERIFIED_LIVE_PATHS',
  'EDGE_CRON_QUEUES_RETRIES_NOT_CLOSED_BY_REPO_INVENTORY',
  'SUPERUSER_TRIGGER_DDL_BYPASS_UNRESOLVED',
  'FUTURE_WRITER_UNKNOWN',
  'SQL_MIGRATION_TEXT_NOT_LIVE_DEPLOYMENT_EVIDENCE'
]);
const frozen = (x) => Object.freeze(x);
const lineAt = (s, idx) => s.slice(0, idx).split('\n').length;
const norm = (x) => x.replace(/\r\n/gu, '\n');
const legalPath = (path) =>
  typeof path === 'string' &&
  SOURCE_INVENTORY_ROOTS.some((root) => path.startsWith(root + '/')) &&
  !path.includes('..') &&
  !path.includes('\\');
function occurrence(source, term) {
  const idx = source.indexOf(term);
  return idx < 0 ? null : lineAt(source, idx);
}
function evidenceFor(sources, path, term) {
  const source = sources.get(path);
  if (typeof source !== 'string') return null;
  const line = occurrence(source, term);
  return line === null
    ? null
    : frozen({ path, line, kind: 'tracked_source_text_only' });
}
function readFunctionBlock(src, name) {
  const start = src
    .toLowerCase()
    .indexOf(('create or replace function public.' + name + '(').toLowerCase());
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.indexOf('$$;');
  return end < 0 ? null : rest.slice(0, end + 3);
}
function trackedSourceFiles(repoRoot) {
  const out = execFileSync(
    'git',
    ['-C', repoRoot, 'ls-files', '-z', '--', ...SOURCE_INVENTORY_ROOTS],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  return out
    .split('\0')
    .filter(Boolean)
    .filter(
      (path) =>
        legalPath(path) && /\.(?:sql|js|mjs|ts|tsx|yaml|yml)$/u.test(path)
    );
}
export function readSourceWriterInput(
  repoRoot = fileURLToPath(new URL('../', import.meta.url))
) {
  const map = new Map();
  for (const path of trackedSourceFiles(repoRoot)) {
    // Every path is a tracked relative source path inside repoRoot.
    map.set(path, norm(readFileSync(join(repoRoot, path), 'utf8')));
  }
  return map;
}
export function reviewPoint10xTrackedSources(sources) {
  if (!(sources instanceof Map))
    return frozen({
      status: 'HOLD_INVALID_SOURCE_INVENTORY',
      blockers: frozen(['source_map_required']),
      mayReadDb: false,
      mayWriteDb: false,
      mayRunStaging: false,
      mayMergeMain: false
    });
  const blockers = [...SOURCE_GAP_CODES];
  const classes = SOURCE_WRITER_RULES.map((rule) => {
    const evidence = rule.terms
      .map((term) => {
        for (const path of rule.paths) {
          const proof = evidenceFor(sources, path, term);
          if (proof) return proof;
        }
        return null;
      })
      .filter(Boolean);
    if (evidence.length !== rule.terms.length && rule.terms.length > 0)
      blockers.push('MISSING_PINNED_WRITER_SOURCE:' + rule.kind);
    return frozen({
      kind: rule.kind,
      classification: rule.classification,
      evidence: frozen(evidence),
      allPinnedTermsFound: evidence.length === rule.terms.length,
      actualWriterFenced: false,
      activeInProductionVerified: false
    });
  });
  const privileges = SOURCE_PRIVILEGE_RULES.map((rule) => {
    const evidence = rule.path
      ? evidenceFor(sources, rule.path, rule.term)
      : null;
    if (rule.path && !evidence)
      blockers.push('MISSING_PINNED_PRIVILEGE_SOURCE:' + rule.kind);
    return frozen({
      kind: rule.kind,
      evidence,
      catalogAclVerified: false,
      ownerRoleVerified: false,
      dbFenceEnforced: false
    });
  });
  const mutation =
    /\b(insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:public\.)?(scout_xp_ledger|scout_point_ledger|scout_badge_definitions|user_scout_badges|scout_point_operator_actions)\b/giu;
  const mutationSites = [];
  for (const [path, src] of sources) {
    if (!legalPath(path) || !/\.(sql|js|mjs|ts|tsx)$/u.test(path)) continue;
    const seen = new Set();
    for (const match of src.matchAll(mutation)) {
      const line = lineAt(src, match.index);
      const id = path + ':' + line;
      if (seen.has(id)) continue;
      seen.add(id);
      mutationSites.push(
        frozen({
          path,
          line,
          table: match[2].toLowerCase(),
          operation: match[1].toUpperCase().replace(/\s+/gu, ' '),
          type: 'source_sql_reference_not_runtime_call'
        })
      );
    }
  }
  const jsMutation =
    /\.from\(\s*['"](scout_xp_ledger|scout_point_ledger|scout_badge_definitions|user_scout_badges|scout_point_operator_actions)['"]\s*\)\s*\.\s*(insert|upsert|update|delete)\s*\(/giu;
  for (const [path, src] of sources) {
    if (!/^(?:api|src|supabase\/functions)\//u.test(path)) continue;
    for (const match of src.matchAll(jsMutation)) {
      mutationSites.push(
        frozen({
          path,
          line: lineAt(src, match.index),
          table: match[1].toLowerCase(),
          operation: 'CLIENT_' + match[2].toUpperCase(),
          type: 'potential_client_dml_source_not_real_db'
        })
      );
      blockers.push('CLIENT_DIRECT_SCOUT_DML_REQUIRES_GATE_REVIEW');
    }
  }
  for (const site of mutationSites) {
    if (/^(api|src|supabase\/functions)\//u.test(site.path))
      blockers.push('UNREGISTERED_APPLICATION_POINT_WRITER_CANDIDATE');
  }
  mutationSites.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const guardPath =
    'supabase/migrations/20260921025328_scout_record_usage_controls.sql';
  const legacyGuard = readFunctionBlock(
    sources.get(guardPath) || '',
    'novelight_enforce_scout_point_control'
  );
  const knownPointControl = Boolean(legacyGuard);
  const hasEpochGuard = Boolean(
    legacyGuard &&
    /fencing_epoch|point10x_writer_fence|POINT10X_FENCE_DENY/iu.test(
      legacyGuard
    )
  );
  if (!knownPointControl)
    blockers.push('LEGACY_POINT_CONTROL_FUNCTION_NOT_LOCATED');
  // Historical DDL is not runtime SQL catalog evidence.
  const baselineRevokes =
    sources.get(
      'supabase/migrations/20260920223049_scout_record_beta_core.sql'
    ) || '';
  const anonOnly = baselineRevokes.includes(
    'revoke all on table public.scout_point_ledger from public, anon, authenticated;'
  );
  if (!anonOnly) blockers.push('PINNED_POINT_LEDGER_REVOKE_NOT_FOUND');
  if (hasEpochGuard)
    blockers.splice(
      blockers.indexOf('DB_FENCE_NOT_FOUND_IN_LEGACY_POINT_CONTROL_TRIGGER'),
      1
    );
  const allPaths = [...sources.keys()];
  return frozen({
    status: 'NO_GO_SOURCE_CODE_ONLY',
    blockers: frozen([...new Set(blockers)]),
    trackedSourceFileCount: allPaths.length,
    categoryCount: classes.length,
    classes: frozen(classes),
    privilegedRouteCount: privileges.length,
    privileges: frozen(privileges),
    mutationSites: frozen(mutationSites),
    staticPointControlFunctionFound: knownPointControl,
    staticPointControlEpochGuardFound: hasEpochGuard,
    staticRevokeExcludesServiceRole: anonOnly,
    sourceOnly: true,
    actualPostgresCatalogRead: false,
    deployedFunctionBodyVerified: false,
    actualWriterFenced: false,
    mayReadDb: false,
    mayWriteDb: false,
    mayRunStaging: false,
    mayUseDocker: false,
    mayMergeMain: false,
    mayDeploy: false
  });
}
