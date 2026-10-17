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
