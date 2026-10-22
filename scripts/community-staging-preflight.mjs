// Community Plaza Phase 1 — preparation-only integrity check.
// No network, database connections, secrets, workflow dispatch or mutations.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const COMMUNITY_MIGRATION_VERSION = '20261014052000';
export const COMMUNITY_MIGRATION_STEM =
  COMMUNITY_MIGRATION_VERSION + '_community_plaza_phase1';
export const COMMUNITY_PREP_PATHS = Object.freeze([
  'supabase/migrations/' + COMMUNITY_MIGRATION_STEM + '.sql',
  'supabase/checks/' + COMMUNITY_MIGRATION_STEM + '_precheck.sql',
  'supabase/checks/' + COMMUNITY_MIGRATION_STEM + '_postcheck.sql',
  'supabase/checks/' + COMMUNITY_MIGRATION_STEM + '_postrollback.sql',
  'supabase/rollback/' + COMMUNITY_MIGRATION_STEM + '_rollback.sql',
  'tests/rls/community-plaza-phase1-security.sql',
  'tests/rls/community-plaza-phase1-behavior.sql',
]);

const SHA = /^[0-9a-f]{40}$/u;

function fail(reason) {
  throw new Error('COMMUNITY_STAGING_PREP_DENIED: ' + reason);
}

export function verifyCommunityStagingPreparation({
  mainSha,
  candidateSha,
  read = (path) => {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    return readFileSync(join(root, path), 'utf8');
  },
} = {}) {
  if (!SHA.test(mainSha ?? '') || !SHA.test(candidateSha ?? '')) {
    fail('current main and candidate must both be exact 40-character SHAs');
  }
  if (mainSha === candidateSha) {
    fail('a branch candidate must not be confused with deployed main');
  }
  const content = {};
  for (const path of COMMUNITY_PREP_PATHS) {
    let value;
    try {
      value = read(path);
    } catch {
      fail('missing required review artifact: ' + path);
    }
    if (!value || typeof value !== 'string') {
      fail('empty required review artifact: ' + path);
    }
    content[path] = value;
  }
  const migration = content[COMMUNITY_PREP_PATHS[0]];
  const precheck = content[COMMUNITY_PREP_PATHS[1]];
  const postcheck = content[COMMUNITY_PREP_PATHS[2]];
  const postrollback = content[COMMUNITY_PREP_PATHS[3]];
  const rollback = content[COMMUNITY_PREP_PATHS[4]];
  const security = content[COMMUNITY_PREP_PATHS[5]];
  const behavior = content[COMMUNITY_PREP_PATHS[6]];

  if (!migration.includes('CREATE TABLE IF NOT EXISTS public.community_runtime_control') ||
      !migration.includes('public_enabled boolean NOT NULL DEFAULT false') ||
      !migration.includes('REVOKE ALL ON public.community_runtime_control FROM PUBLIC,anon,authenticated')) {
    fail('database publication gate is not default-off and private');
  }
  if (/UPDATE\s+public\.community_runtime_control\s+SET\s+public_enabled\s*=\s*true/iu.test(migration)) {
    fail('migration must never enable the public community');
  }
  if (!precheck.includes('Canonical dependencies missing') ||
      !postcheck.includes('DB public gate must default disabled') ||
      !postrollback.includes('Rollback retained table') ||
      !rollback.includes('Destructive rollback prohibited') ||
      !rollback.includes('public.community_runtime_control') ||
      !security.includes('community_runtime_control') ||
      !behavior.includes('Public community RPC active before release')) {
    fail('required safety check, rollback, or offline behavior proof missing');
  }

  // This returns an inspection manifest only. It cannot authorize an action,
  // attest to ancestry/current-main freshness, or prove hosted environment state.
  return Object.freeze({
    result: 'PREPARATION_ONLY',
    repository: 'bingohooah888-ai/novelrise',
    prNumber: 2222,
    mainSha,
    candidateSha,
    migrationVersion: COMMUNITY_MIGRATION_VERSION,
    candidateArtifacts: [...COMMUNITY_PREP_PATHS],
    stagingTarget: 'unresolved: owner-scoped Issue #294 control required',
    approvalLedger: 'Issue #294',
    stagingExecutionApproved: false,
    environmentTouched: false,
    canExecuteStaging: false,
    canCreatePreview: false,
    canMergeOrDeployProduction: false,
    reason:
      'Current sync accepts migrations on current main only. A reviewed ' +
      'immutable candidate-bound owner approval route is not installed in main.',
  });
}

// Strictly read-only comparison of two independently retrieved migration lists.
// The caller must verify that each list is complete and source-authentic;
// this function cannot establish freshness or grant hosted execution.
export function inspectCommunityStagingLedger({
  productionRef,
  stagingRef,
  productionMigrations,
  stagingMigrations,
  productionLedgerComplete = false,
  stagingLedgerComplete = false,
  stagingManagementStatus
} = {}) {
  if (productionRef !== 'fiepaguycecrredwrcwx' ||
      stagingRef !== 'wmlzjgvxgoyrovdhbqbg' ||
      productionRef === stagingRef) {
    fail('production/staging resource identities are unverified');
  }
  if (productionLedgerComplete !== true || stagingLedgerComplete !== true) {
    fail('migration snapshots are incomplete; pagination/freshness must be checked');
  }

  const buildLedger = (rows, label) => {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) {
      fail(label + ' migration list missing or unbounded');
    }
    const result = new Map();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          !/^[0-9]{14}$/u.test(row.version ?? '') ||
          !/^[a-z0-9_]+$/u.test(row.name ?? '')) {
        fail(label + ' migration row is malformed');
      }
      if (result.has(row.version)) {
        fail(label + ' migration version repeated: ' + row.version);
      }
      result.set(row.version, row.name);
    }
    return result;
  };
  const production = buildLedger(productionMigrations, 'production');
  const staging = buildLedger(stagingMigrations, 'staging');
  const productionOnly = [...production.keys()]
    .filter((version) => !staging.has(version)).sort();
  const stagingOnly = [...staging.keys()]
    .filter((version) => !production.has(version)).sort();
  const nameConflicts = [...production.keys()]
    .filter((version) => staging.has(version) &&
      production.get(version) !== staging.get(version)).sort();
  const stageCommunity = staging.get(COMMUNITY_MIGRATION_VERSION) ===
    'community_plaza_phase1';
  const productionCommunity = production.has(COMMUNITY_MIGRATION_VERSION);
  const managementBlocked = stagingManagementStatus !== 'FUNCTIONS_DEPLOYED';
  const diverged = productionOnly.length > 0 || stagingOnly.length > 0 ||
    nameConflicts.length > 0;
  const blockers = [];
  if (diverged) blockers.push('migration history differs');
  if (!stageCommunity) blockers.push('expected staging community migration missing');
  if (productionCommunity) blockers.push('community already recorded in production');
  if (managementBlocked) blockers.push('staging management is not ready');
  // Even zero blockers would not establish OWNER authorization, browser tests,
  // immutable candidate provenance, safe disposable isolation or budget.
  return Object.freeze({
    verdict: 'READ_ONLY_LEDGER_AUDIT',
    productionMigrationCount: production.size,
    stagingMigrationCount: staging.size,
    productionOnly: Object.freeze(productionOnly),
    stagingOnly: Object.freeze(stagingOnly),
    nameConflicts: Object.freeze(nameConflicts),
    stagingManagementStatus,
    blockers: Object.freeze(blockers),
    stagingExecutionApproved: false,
    canSyncOrReset: false,
    canRunHostedAcceptance: false,
    canMergeOrDeployProduction: false
  });
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mainSha, candidateSha] = process.argv.slice(2);
  try {
    console.log(
      JSON.stringify(
        verifyCommunityStagingPreparation({ mainSha, candidateSha }),
        null,
        2
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
